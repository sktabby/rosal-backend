import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTransportDto } from './dto/create-transport.dto';
import { OrderEventsService } from '../order-events/order-events.service';

@Injectable()
export class TransportService {
  constructor(private prisma: PrismaService, private orderEvents: OrderEventsService) {}

  async create(dto: CreateTransportDto, actorId: string) {
    const transport = await this.prisma.transport.create({ data: dto });
    await this.orderEvents.log({
      entityType: 'Transport',
      entityId: transport.id,
      action: 'created',
      actorId,
    });
    return transport;
  }

  async findMany(params: { search?: string; page?: number }) {
    const { search, page = 1 } = params;
    const pageSize = 10;
    const where: any = { deletedAt: null };
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const [items, total] = await Promise.all([
      this.prisma.transport.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.transport.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  findOne(id: string) {
    return this.prisma.transport.findUniqueOrThrow({ where: { id } });
  }

  async update(id: string, dto: Partial<CreateTransportDto>, actorId: string) {
    const transport = await this.prisma.transport.update({ where: { id }, data: dto });
    await this.orderEvents.log({ entityType: 'Transport', entityId: id, action: 'edited', actorId });
    return transport;
  }

  async softDelete(id: string, actorId: string) {
    await this.prisma.transport.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.orderEvents.log({ entityType: 'Transport', entityId: id, action: 'deleted', actorId });
    return { message: 'Transport option deleted' };
  }
}
