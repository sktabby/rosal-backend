import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';
/**
 * Restrict a controller/route to specific roles, e.g.
 *   @Roles(UserRole.ADMIN)
 *   @Roles(UserRole.DISPATCHER) // shared identically between web + app
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
