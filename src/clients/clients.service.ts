import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { OrderEventsService } from '../order-events/order-events.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService, private orderEvents: OrderEventsService) {}

  async checkGstAvailable(gstin: string) {
    const existing = await this.prisma.client.findUnique({ where: { gstin } });
    return { available: !existing };
  }

  async create(dto: CreateClientDto, actorId: string) {
    const existing = await this.prisma.client.findUnique({ where: { gstin: dto.gstin } });
    if (existing) {
      throw new BadRequestException('This GST number is already registered');
    }

    const client = await this.prisma.client.create({ data: dto });

    await this.orderEvents.log({
      entityType: 'Client',
      entityId: client.id,
      action: 'created',
      actorId,
    });

    return client;
  }

  /**
   * Sellers only ever see clients assigned to them (server-enforced, per
   * §1 Ownership Model — never trust the client to only request "their" data).
   */
  async findMany(currentUser: AuthenticatedUser, params: { search?: string; page?: number }) {
    const { search, page = 1 } = params;
    const pageSize = 10;

    const where: any = { deletedAt: null };
    if (currentUser.role === 'SELLER') {
      where.assignedSellerId = currentUser.id;
    }
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { gstin: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.client.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.client.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(id: string, currentUser: AuthenticatedUser) {
    const client = await this.prisma.client.findUniqueOrThrow({ where: { id } });
    if (currentUser.role === 'SELLER' && client.assignedSellerId !== currentUser.id) {
      throw new ForbiddenException();
    }
    return client;
  }

  async update(id: string, dto: Partial<CreateClientDto>, actorId: string) {
    const client = await this.prisma.client.update({ where: { id }, data: dto });
    await this.orderEvents.log({ entityType: 'Client', entityId: id, action: 'edited', actorId });
    return client;
  }

  async softDelete(id: string, actorId: string) {
    await this.prisma.client.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.orderEvents.log({ entityType: 'Client', entityId: id, action: 'deleted', actorId });
    return { message: 'Client deleted' };
  }
}
