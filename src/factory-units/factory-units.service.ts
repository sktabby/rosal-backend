import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFactoryUnitDto } from './dto/create-factory-unit.dto';
import { OrderEventsService } from '../order-events/order-events.service';
import { UserRole } from '@prisma/client';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Injectable()
export class FactoryUnitsService {
  constructor(
    private prisma: PrismaService,
    private orderEvents: OrderEventsService,
    private realtime: RealtimeGateway,
  ) {}

  /** Dropdown source: only Dispatchers not already assigned to a Factory Unit. */
  async findUnassignedDispatchers() {
    return this.prisma.user.findMany({
      where: { role: UserRole.DISPATCHER, deletedAt: null, assignedFactoryUnit: null },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, generatedId: true },
    });
  }

  async create(dto: CreateFactoryUnitDto, actorId: string) {
    // Unique constraint on assignedDispatcherId enforces 1:1 at the DB level too,
    // but we pre-check for a friendlier error message.
    const existing = await this.prisma.factoryUnit.findUnique({
      where: { assignedDispatcherId: dto.assignedDispatcherId },
    });
    if (existing) {
      throw new BadRequestException('This dispatcher is already assigned to another Factory Unit');
    }

    const unit = await this.prisma.factoryUnit.create({
      data: dto,
      include: { assignedDispatcher: { select: { id: true, firstName: true, lastName: true, employeeCode: true, deletedAt: true } } },
    });

    await this.orderEvents.log({
      entityType: 'FactoryUnit',
      entityId: unit.id,
      action: 'created',
      actorId,
    });

    return unit;
  }

  async findMany(params: { search?: string; page?: number }) {
    const { search, page = 1 } = params;
    const pageSize = 10;
    const where: any = { deletedAt: null };
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const [items, total] = await Promise.all([
      this.prisma.factoryUnit.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: { assignedDispatcher: { select: { id: true, firstName: true, lastName: true, employeeCode: true, deletedAt: true } } },
      }),
      this.prisma.factoryUnit.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  findOne(id: string) {
    return this.prisma.factoryUnit.findUniqueOrThrow({
      where: { id },
      include: { assignedDispatcher: { select: { id: true, firstName: true, lastName: true, employeeCode: true, deletedAt: true } } },
    });
  }

  async update(id: string, dto: Partial<CreateFactoryUnitDto>, actorId: string) {
    if (dto.assignedDispatcherId) {
      const existing = await this.prisma.factoryUnit.findUnique({
        where: { assignedDispatcherId: dto.assignedDispatcherId },
      });
      if (existing && existing.id !== id) {
        throw new BadRequestException('This dispatcher is already assigned to another Factory Unit');
      }
    }
    const unit = await this.prisma.factoryUnit.update({ where: { id }, data: dto });
    // Reassigned: the previous dispatcher must stop receiving this unit's orders live,
    // and the new one reconnects into the unit's room.
    if (dto.assignedDispatcherId !== undefined) {
      this.realtime.disconnectFactoryUnit(id);
      this.realtime.disconnectUsers(dto.assignedDispatcherId);
    }
    await this.orderEvents.log({ entityType: 'FactoryUnit', entityId: id, action: 'edited', actorId });
    return unit;
  }

  async softDelete(id: string, actorId: string) {
    await this.prisma.factoryUnit.update({ where: { id }, data: { deletedAt: new Date() } });
    this.realtime.disconnectFactoryUnit(id);
    await this.orderEvents.log({ entityType: 'FactoryUnit', entityId: id, action: 'deleted', actorId });
    return { message: 'Factory unit deleted' };
  }
}
