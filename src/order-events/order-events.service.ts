import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class OrderEventsService {
  constructor(private prisma: PrismaService) {}

  /** Writes one audit row. Call this from every status transition / management edit-delete. */
  async log(params: {
    entityType: string;
    entityId: string;
    action: string;
    actorId: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    return this.prisma.orderEvent.create({
      data: {
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        actorId: params.actorId,
        metadata: params.metadata,
      },
    });
  }

  /** Backs an Admin audit-trail view — e.g. "who changed this order/PI and when." */
  async listForEntity(entityType: string, entityId: string) {
    return this.prisma.orderEvent.findMany({
      where: { entityType, entityId },
      orderBy: { timestamp: 'desc' },
      include: { actor: { select: { firstName: true, lastName: true, role: true } } },
    });
  }
}
