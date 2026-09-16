import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OtpDeliveryService } from './otp-delivery.service';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

/**
 * The single canonical shape of a "user account" returned to clients.
 *
 * Both GET /account/me and POST /auth/verify-otp return this exact shape.
 * They used to build it independently, which let them drift: verify-otp was
 * missing `role` (breaking the Android client, whose user model requires it)
 * and /account/me returned only a nested `assignedFactoryUnit` object while
 * both clients actually read the flat `assignedFactoryUnitId`.
 *
 * Anything user-account-shaped should reuse USER_ACCOUNT_SELECT + toUserAccount
 * rather than hand-rolling another select/object literal.
 */
export const USER_ACCOUNT_SELECT = {
  id: true,
  role: true,
  employeeCode: true,
  generatedId: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  lastLoginAt: true,
  lastLoginDevice: true,
  pushNotificationsEnabled: true,
  emailNotificationsEnabled: true,
  assignedFactoryUnit: { select: { id: true, name: true } },
} as const;

type UserAccountRow = {
  assignedFactoryUnit?: { id: string; name: string } | null;
  [key: string]: unknown;
};

/**
 * Flattens the Prisma row into the wire shape. `assignedFactoryUnitId` is what
 * both the Android app and the web portal actually read; the nested
 * `assignedFactoryUnit` is kept alongside it so the unit's name stays
 * available without a second request.
 */
export function toUserAccount<T extends UserAccountRow>(user: T) {
  const { assignedFactoryUnit, ...rest } = user;
  return {
    ...rest,
    assignedFactoryUnitId: assignedFactoryUnit?.id ?? null,
    assignedFactoryUnit: assignedFactoryUnit ?? null,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private otpDelivery: OtpDeliveryService,
  ) {}

  /** Step 1: employeeCode + password -> triggers one shared OTP to email + phone. */
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { employeeCode: dto.employeeCode },
    });

    if (!user || user.deletedAt || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid employee code or password');
    }

    const passwordOk = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordOk) {
      throw new UnauthorizedException('Invalid employee code or password');
    }

    await this.issueOtp(user);

    return {
      message: 'OTP sent to your registered email and phone.',
      expiresInMinutes: Number(this.config.get('OTP_EXPIRES_IN_MINUTES') ?? 5),
    };
  }

  /**
   * Re-sends a fresh OTP without re-entering the password — powers the "Resend
   * OTP" link on the OTP screen. Rate-limited at the route level (max 1/30s)
   * via @Throttle on the controller; also enforces a max-resends-per-login-
   * attempt ceiling here so a stuck OTP flow can't be resent indefinitely.
   */
  async resendOtp(employeeCode: string) {
    // Same generic message on every path below (missing account, inactive account,
    // AND rate-limited account) — a distinct message/status on any one of them would
    // let a caller distinguish "this employee code exists" from "it doesn't" by
    // spamming resend until they get the rate-limit response instead of the
    // not-found one. The client doesn't need to tell these apart: a rate-limited
    // user still has a valid unexpired OTP from their last real send.
    const genericResponse = { message: 'If this account exists, a new OTP has been sent.' };

    const user = await this.prisma.user.findUnique({ where: { employeeCode } });
    if (!user || user.deletedAt || user.status !== 'ACTIVE') {
      return genericResponse;
    }

    const resendWindowStart = new Date(Date.now() - 15 * 60_000); // last 15 min
    const recentCount = await this.prisma.otpCode.count({
      where: { userId: user.id, createdAt: { gte: resendWindowStart } },
    });
    if (recentCount >= 5) {
      return genericResponse;
    }

    await this.issueOtp(user);
    return genericResponse;
  }

  private async issueOtp(user: {
    id: string;
    email: string;
    phone: string;
    firstName: string;
    employeeCode: string;
  }) {
    const otp = this.generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresInMinutes = Number(this.config.get('OTP_EXPIRES_IN_MINUTES') ?? 5);

    // Invalidate any still-active OTPs for this user so only the newest is valid.
    await this.prisma.otpCode.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    await this.prisma.otpCode.create({
      data: {
        userId: user.id,
        codeHash: otpHash,
        expiresAt: new Date(Date.now() + expiresInMinutes * 60_000),
      },
    });

    await this.otpDelivery.sendOtp({
      email: user.email,
      phone: user.phone,
      otp,
      firstName: user.firstName,
      employeeCode: user.employeeCode,
    });
  }

  /** Step 2: OTP entry -> JWT + resolved role. */
  async verifyOtp(dto: VerifyOtpDto) {
    const user = await this.prisma.user.findUnique({
      where: { employeeCode: dto.employeeCode },
      include: { assignedFactoryUnit: true },
    });
    if (!user) throw new UnauthorizedException('Invalid request');

    const latestOtp = await this.prisma.otpCode.findFirst({
      where: { userId: user.id, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!latestOtp) {
      throw new BadRequestException('No active OTP — please log in again');
    }
    if (latestOtp.expiresAt < new Date()) {
      throw new BadRequestException('OTP expired — please log in again');
    }
    if (latestOtp.attemptCount >= 5) {
      throw new BadRequestException('Too many attempts — please log in again');
    }

    const otpOk = await bcrypt.compare(dto.otp, latestOtp.codeHash);
    if (!otpOk) {
      await this.prisma.otpCode.update({
        where: { id: latestOtp.id },
        data: { attemptCount: { increment: 1 } },
      });
      throw new BadRequestException('Incorrect OTP');
    }

    await this.prisma.otpCode.update({
      where: { id: latestOtp.id },
      data: { consumedAt: new Date() },
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        // A real client should pass device info; kept simple here.
        lastLoginDevice: 'Unknown device',
      },
    });

    const token = this.jwt.sign({
      sub: user.id,
      role: user.role,
      employeeCode: user.employeeCode,
    });

    return {
      accessToken: token,
      role: user.role,
      user: toUserAccount(
        await this.prisma.user.findUniqueOrThrow({
          where: { id: user.id },
          select: USER_ACCOUNT_SELECT,
        }),
      ),
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const currentOk = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!currentOk) {
      throw new BadRequestException('Current password is incorrect');
    }

    const newHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });

    return { message: 'Password updated' };
  }

  async me(userId: string) {
    return toUserAccount(
      await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: USER_ACCOUNT_SELECT,
      }),
    );
  }

  async updateNotificationPrefs(
    userId: string,
    prefs: { push?: boolean; email?: boolean },
  ) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(prefs.push !== undefined && { pushNotificationsEnabled: prefs.push }),
        ...(prefs.email !== undefined && { emailNotificationsEnabled: prefs.email }),
      },
      select: { pushNotificationsEnabled: true, emailNotificationsEnabled: true },
    });
  }

  private generateOtp(): string {
    const length = Number(this.config.get('OTP_LENGTH') ?? 6);
    const min = 10 ** (length - 1);
    const max = 10 ** length - 1;
    return String(randomInt(min, max));
  }
}
