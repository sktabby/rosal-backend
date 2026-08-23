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

  /** Global, paginated feed for the Admin History page — all entities, most recent first. */
  async listAll(params: { page?: number; entityType?: string }) {
    const { page = 1, entityType } = params;
    const pageSize = 10;
    const where: any = {};
    if (entityType) where.entityType = entityType;

    const [items, total] = await Promise.all([
      this.prisma.orderEvent.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { timestamp: 'desc' },
        include: { actor: { select: { firstName: true, lastName: true, role: true } } },
      }),
      this.prisma.orderEvent.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }
}