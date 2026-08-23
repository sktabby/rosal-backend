import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { OrderEventsService } from '../order-events/order-events.service';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService, private orderEvents: OrderEventsService) {}

  async create(dto: CreateProductDto, actorId: string) {
    const product = await this.prisma.product.create({ data: dto });
    await this.orderEvents.log({ entityType: 'Product', entityId: product.id, action: 'created', actorId });
    return product;
  }

  async findMany(params: { search?: string; page?: number }) {
    const { search, page = 1 } = params;
    const pageSize = 10;
    const where: any = { deletedAt: null };
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { name: 'asc' } }),
      this.prisma.product.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  findOne(id: string) {
    return this.prisma.product.findUniqueOrThrow({ where: { id } });
  }

  async update(id: string, dto: Partial<CreateProductDto>, actorId: string) {
    const product = await this.prisma.product.update({ where: { id }, data: dto });
    await this.orderEvents.log({ entityType: 'Product', entityId: id, action: 'edited', actorId });
    return product;
  }

  async softDelete(id: string, actorId: string) {
    await this.prisma.product.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.orderEvents.log({ entityType: 'Product', entityId: id, action: 'deleted', actorId });
    return { message: 'Product deleted' };
  }
}
