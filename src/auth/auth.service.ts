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
    const user = await this.prisma.user.findUnique({ where: { employeeCode } });
    if (!user || user.deletedAt || user.status !== 'ACTIVE') {
      // Same generic response either way — don't leak whether the code exists.
      return { message: 'If this account exists, a new OTP has been sent.' };
    }

    const resendWindowStart = new Date(Date.now() - 15 * 60_000); // last 15 min
    const recentCount = await this.prisma.otpCode.count({
      where: { userId: user.id, createdAt: { gte: resendWindowStart } },
    });
    if (recentCount >= 5) {
      throw new BadRequestException('Too many OTP requests — please log in again shortly');
    }

    await this.issueOtp(user);
    return { message: 'A new OTP has been sent to your registered email and phone.' };
  }

  private async issueOtp(user: { id: string; email: string; phone: string; firstName: string }) {
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
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        generatedId: user.generatedId,
        employeeCode: user.employeeCode,
        assignedFactoryUnitId: user.assignedFactoryUnit?.id ?? null,
      },
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
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
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
      },
    });
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
