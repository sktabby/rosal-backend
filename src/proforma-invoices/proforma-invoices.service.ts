import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PiStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePiDto } from './dto/create-pi.dto';
import { UpdatePiDto } from './dto/update-pi.dto';
import { OrderEventsService } from '../order-events/order-events.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { buildPiNumber, currentFinancialYearLabel } from '../common/utils/id-generator.util';

@Injectable()
export class ProformaInvoicesService {
  constructor(private prisma: PrismaService, private orderEvents: OrderEventsService) {}

  async create(dto: CreatePiDto, seller: AuthenticatedUser) {
    // Ownership check: seller may only create PIs for clients assigned to them
    const client = await this.prisma.client.findUniqueOrThrow({ where: { id: dto.clientId } });
    if (client.assignedSellerId !== seller.id) {
      throw new ForbiddenException('This client is not assigned to you');
    }

    const fy = currentFinancialYearLabel();
    const seriesCount = await this.prisma.proformaInvoice.count({
      where: { piNumber: { startsWith: `RSPL/${fy}/` } },
    });
    const piNumber = buildPiNumber(seriesCount);

    const pi = await this.prisma.proformaInvoice.create({
      data: {
        piNumber,
        clientId: dto.clientId,
        sellerId: seller.id,
        shipToAddress: dto.shipToAddress,
        modeOfPayment: dto.modeOfPayment,
        transportId: dto.transportId,
        transportType: dto.transportType,
        status: PiStatus.DRAFT,
        lineItems: {
          create: dto.lineItems.map((li) => ({
            productId: li.productId,
            brand: li.brand,
            qty: li.qty,
            price: li.price,
            discountPercent: li.discountPercent ?? 0,
          })),
        },
      },
      include: { lineItems: true, client: true },
    });

    await this.orderEvents.log({
      entityType: 'ProformaInvoice',
      entityId: pi.id,
      action: 'created',
      actorId: seller.id,
    });

    return pi;
  }

  /** Sellers see only their own PIs. */
  async findMany(
    seller: AuthenticatedUser,
    params: { search?: string; status?: PiStatus | PiStatus[]; page?: number },
  ) {
    const { search, status, page = 1 } = params;
    const pageSize = 10;

    const where: any = { sellerId: seller.id };
    if (status) where.status = Array.isArray(status) ? { in: status } : status;
    if (search) {
      where.OR = [
        { piNumber: { contains: search, mode: 'insensitive' } },
        { client: { firstName: { contains: search, mode: 'insensitive' } } },
        { client: { lastName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.proformaInvoice.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { updatedAt: 'desc' },
        include: { client: true, lineItems: { include: { product: true } }, salesOrders: true },
      }),
      this.prisma.proformaInvoice.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(id: string, seller: AuthenticatedUser) {
    const pi = await this.prisma.proformaInvoice.findUnique({
      where: { id },
      include: { client: true, lineItems: { include: { product: true } }, transport: true, salesOrders: true },
    });
    if (!pi) throw new NotFoundException('PI not found');
    if (pi.sellerId !== seller.id) throw new ForbiddenException();
    return pi;
  }

  /**
   * v1.1: backs the Create-Order fetch step — `GET /pi?clientId=&sellerId=me`.
   * Returns only PIs a NEW order could actually be generated from: not
   * editLocked (no live order already referencing it), not
   * Cancelled/Archived, and created within the last 30 days (matches the
   * existing PI auto-archive window, made explicit here too).
   *
   * Deliberately includes both DRAFT (the common case) and CONFIRMED-but-
   * unlocked PIs (the cancel-then-recreate case — see PI.editLocked docs) —
   * the patch note says "still Draft/unconfirmed," but excluding the
   * recreate case here would silently break that existing flow, so this
   * reconciles both rules. Flagging this interpretation in case it's not
   * what was intended.
   */
  async findOrderableForClient(seller: AuthenticatedUser, clientId: string) {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return this.prisma.proformaInvoice.findMany({
      where: {
        sellerId: seller.id,
        clientId,
        editLocked: false,
        status: { notIn: [PiStatus.CANCELLED, PiStatus.ARCHIVED] },
        createdAt: { gte: cutoff },
      },
      orderBy: { updatedAt: 'desc' },
      include: { lineItems: { include: { product: true } }, transport: true },
    });
  }

  /**
   * Blocked server-side whenever editLocked=true (a live order references this PI).
   * No PI versioning — this mutates the SAME record in place, any number of times,
   * as long as it's unlocked.
   */
  async update(id: string, dto: UpdatePiDto, seller: AuthenticatedUser) {
    const pi = await this.prisma.proformaInvoice.findUniqueOrThrow({ where: { id } });

    if (pi.sellerId !== seller.id) throw new ForbiddenException();
    if (pi.editLocked) {
      throw new BadRequestException(
        'This PI has an active order. Cancel the current order first to edit.',
      );
    }
    if (pi.status === PiStatus.CANCELLED || pi.status === PiStatus.ARCHIVED) {
      throw new BadRequestException('This PI can no longer be edited');
    }

    const { lineItems, ...rest } = dto;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (lineItems) {
        await tx.piLineItem.deleteMany({ where: { proformaInvoiceId: id } });
      }
      return tx.proformaInvoice.update({
        where: { id },
        data: {
          ...rest,
          ...(lineItems && {
            lineItems: {
              create: lineItems.map((li) => ({
                productId: li.productId,
                brand: li.brand,
                qty: li.qty,
                price: li.price,
                discountPercent: li.discountPercent ?? 0,
              })),
            },
          }),
        },
        include: { lineItems: true, client: true },
      });
    });

    await this.orderEvents.log({
      entityType: 'ProformaInvoice',
      entityId: id,
      action: 'edited',
      actorId: seller.id,
    });

    return updated;
  }

  async cancel(id: string, seller: AuthenticatedUser) {
    const pi = await this.prisma.proformaInvoice.findUniqueOrThrow({ where: { id } });
    if (pi.sellerId !== seller.id) throw new ForbiddenException();
    if (pi.status !== PiStatus.DRAFT) {
      throw new BadRequestException('Only a Draft PI can be cancelled');
    }

    const updated = await this.prisma.proformaInvoice.update({
      where: { id },
      data: { status: PiStatus.CANCELLED },
    });

    await this.orderEvents.log({
      entityType: 'ProformaInvoice',
      entityId: id,
      action: 'cancelled',
      actorId: seller.id,
    });

    return updated;
  }

  /** Used by cron/scheduled task: auto-archive Draft PIs unconfirmed after 30 days. */
  async archiveStaleDrafts() {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await this.prisma.proformaInvoice.updateMany({
      where: { status: PiStatus.DRAFT, createdAt: { lt: cutoff } },
      data: { status: PiStatus.ARCHIVED },
    });
    return { archivedCount: result.count };
  }
}
