import { BadRequestException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { generateDisplayId } from '../common/utils/id-generator.util';
import { OtpDeliveryService } from '../auth/otp-delivery.service';
import { OrderEventsService } from '../order-events/order-events.service';
import { UserRole } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private otpDelivery: OtpDeliveryService,
    private orderEvents: OrderEventsService,
  ) {}

  /** Uniqueness must be checked against FULL history, incl. soft-deleted users — codes are never reused. */
  async checkCodeAvailable(code: string) {
    const existing = await this.prisma.user.findUnique({ where: { employeeCode: code } });
    return { available: !existing };
  }

  /**
   * Google's siteverify answers 200 with { success: false, 'error-codes': [...] }
   * for a bad or already-used token, so the JSON body — not the HTTP status —
   * is what decides. A network or parse failure is treated as a failed check
   * rather than a pass, so an outage can't wave user creation through.
   */
  private async verifyCaptcha(captchaToken: string) {
    let result: { success?: boolean };
    try {
      const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          // Presence is guaranteed by assertRequiredEnvVars() in main.ts.
          secret: process.env.RECAPTCHA_SECRET_KEY as string,
          response: captchaToken,
        }),
      });
      result = await res.json();
    } catch {
      throw new BadRequestException('Captcha verification failed');
    }

    if (result?.success !== true) {
      throw new BadRequestException('Captcha verification failed');
    }
  }

  async create(dto: CreateUserDto, actorId: string) {
    await this.verifyCaptcha(dto.captchaToken);

    const existing = await this.prisma.user.findUnique({
      where: { employeeCode: dto.employeeCode },
    });
    if (existing) {
      throw new BadRequestException('Employee Code is already in use (or was previously used)');
    }

    const generatedId = generateDisplayId(dto.firstName, dto.employeeCode);
    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        role: dto.role,
        employeeCode: dto.employeeCode,
        generatedId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        email: dto.email,
        passwordHash,
        createdById: actorId,
      },
    });

    await this.orderEvents.log({
      entityType: 'User',
      entityId: user.id,
      action: 'created',
      actorId,
    });

    await this.otpDelivery.sendNewUserCredentials({
      email: user.email,
      firstName: user.firstName,
      employeeCode: user.employeeCode,
      generatedId: user.generatedId,
      temporaryPassword: dto.password,
    });

    return this.toSafeUser(user);
  }

  async findMany(params: { role?: UserRole; unassigned?: boolean; page?: number; search?: string }) {
    const { role, unassigned, page = 1, search } = params;
    const pageSize = 10;

    const where: any = { deletedAt: null };
    if (role) where.role = role;
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { employeeCode: { contains: search, mode: 'insensitive' } },
        { generatedId: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (unassigned && role === UserRole.DISPATCHER) {
      where.assignedFactoryUnit = null;
    }

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: items.map((u) => this.toSafeUser(u)),
      total,
      page,
      pageSize,
    };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    return this.toSafeUser(user);
  }

  async update(id: string, dto: Partial<CreateUserDto>, actorId: string) {
    const data: any = { ...dto };
    delete data.password;
    delete data.employeeCode; // employeeCode is permanent, never editable
    delete data.captchaToken; // not a column; only meaningful on create

    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, 10);
    }

    const user = await this.prisma.user.update({ where: { id }, data });

    await this.orderEvents.log({
      entityType: 'User',
      entityId: id,
      action: 'edited',
      actorId,
    });

    return this.toSafeUser(user);
  }

  async softDelete(id: string, actorId: string) {
    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'DEACTIVATED' },
    });

    await this.orderEvents.log({
      entityType: 'User',
      entityId: id,
      action: 'deleted',
      actorId,
    });

    return { message: 'User deactivated' };
  }

  private toSafeUser(user: any) {
    const { passwordHash, ...safe } = user;
    return safe;
  }
}
