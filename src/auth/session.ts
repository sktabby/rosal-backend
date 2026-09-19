import { createHash } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface JwtPayload {
  sub: string; // userId
  role: string;
  employeeCode: string;
  /** Password stamp — see passwordStamp(). Missing on tokens issued before it existed. */
  pv?: string;
}

/**
 * A short fingerprint of the user's current password hash, carried in every token.
 * Changing or resetting the password changes the hash, so every token issued before
 * that stops matching and is refused — a stolen or forgotten session can be ended by
 * changing the password, without a sessions table or a migration.
 */
export function passwordStamp(passwordHash: string): string {
  return createHash('sha256').update(passwordHash).digest('base64url').slice(0, 16);
}

/**
 * The one check every authenticated entry point shares (REST guard and the realtime
 * socket): the user still exists, is ACTIVE, isn't soft-deleted, and the token was
 * issued for their current password.
 */
export async function loadActiveSessionUser(prisma: PrismaService, payload: JwtPayload) {
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      role: true,
      employeeCode: true,
      status: true,
      deletedAt: true,
      passwordHash: true,
      assignedFactoryUnit: { select: { id: true } },
    },
  });

  if (!user || user.status !== 'ACTIVE' || user.deletedAt) {
    throw new UnauthorizedException('Account is inactive or no longer exists');
  }
  if (payload.pv !== passwordStamp(user.passwordHash)) {
    throw new UnauthorizedException('Session expired — please sign in again');
  }

  return {
    id: user.id,
    role: user.role,
    employeeCode: user.employeeCode,
    assignedFactoryUnitId: user.assignedFactoryUnit?.id ?? null,
  };
}
