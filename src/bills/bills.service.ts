import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SalesOrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { OrderEventsService } from '../order-events/order-events.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class BillsService {
  constructor(
    private prisma: PrismaService,
    private orderEvents: OrderEventsService,
    private realtime: RealtimeGateway,
  ) {}

  /**
   * Everything here is derived from the frozen order snapshot + live product
   * tax rates — nothing hand-typed, minimizing billing errors. Bill is
   * simple/internal (NOT the legal GST document — that's the Invoice, made
   * later by Accounts).
   */
  async create(dto: CreateBillDto, seller: AuthenticatedUser) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: dto.orderId },
      include: { proformaInvoice: { include: { client: true } }, bill: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.sellerId !== seller.id) throw new ForbiddenException();
    if (order.status !== SalesOrderStatus.DISPATCHED) {
      throw new BadRequestException('Only a Dispatched order can be billed');
    }
    if (order.bill) {
      throw new BadRequestException('A bill already exists for this order');
    }

    const snapshot = order.lineItemsSnapshot as Array<{
      productId: string;
      brand: string;
      qty: number;
      price: number;
      hsnCode: string;
      taxPercent: number;
      discountPercent?: number;
    }>;

    // v1.1: discount is applied to each line before tax is computed.
    let taxableValue = 0;
    let taxTotal = 0;
    for (const li of snapshot) {
      const discount = li.discountPercent ?? 0;
      const lineGross = li.qty * li.price;
      const lineTotal = lineGross * (1 - discount / 100);
      taxableValue += lineTotal;
      taxTotal += lineTotal * (li.taxPercent / 100);
    }
    const amount = taxableValue + taxTotal;

    const bill = await this.prisma.$transaction(async (tx) => {
      const created = await tx.bill.create({
        data: {
          orderId: order.id,
          clientId: order.proformaInvoice.clientId,
          amount,
          createdBySellerId: seller.id,
          lineItems: {
            create: snapshot.map((li) => ({
              productId: li.productId,
              brand: li.brand,
              qty: li.qty,
              price: li.price,
              hsnCode: li.hsnCode,
              taxPercent: li.taxPercent,
              discountPercent: li.discountPercent ?? 0,
            })),
          },
        },
        include: { lineItems: true, client: true },
      });
      return created;
    });

    await this.orderEvents.log({
      entityType: 'Bill',
      entityId: bill.id,
      action: 'created',
      actorId: seller.id,
    });

    this.realtime.emitBillCreated({
      billId: bill.id,
      orderId: order.id,
      clientName: `${order.proformaInvoice.client.firstName} ${order.proformaInvoice.client.lastName}`,
      amount: bill.amount,
    });

    return bill;
  }

  /** Accounts: shared inbox, ALL sellers' bills together, no per-seller filter. */
  async findMany(user: AuthenticatedUser, params: { search?: string; page?: number }) {
    const { search, page = 1 } = params;
    const pageSize = 10;

    const where: any = {};
    if (user.role === 'SELLER') {
      where.createdBySellerId = user.id;
    }
    // ACCOUNTS/ADMIN: no filter — shared inbox across all sellers
    if (search) {
      where.OR = [
        { client: { firstName: { contains: search, mode: 'insensitive' } } },
        { client: { lastName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.bill.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          client: true,
          order: { select: { orderNumber: true, sellerId: true } },
          createdBySeller: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.bill.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /**
   * Accounts/Admin: unrestricted (shared inbox, per spec). Seller: only their
   * own bills — must not be able to read another seller's bill by guessing/
   * incrementing the ID (IDOR).
   */
  async findOne(id: string, user: AuthenticatedUser) {
    const bill = await this.prisma.bill.findUnique({
      where: { id },
      include: {
        client: true,
        lineItems: { include: { product: true } },
        order: true,
        createdBySeller: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true },
        },
      },
    });
    if (!bill) throw new NotFoundException('Bill not found');
    if (user.role === 'SELLER' && bill.createdBySellerId !== user.id) {
      throw new ForbiddenException();
    }
    return bill;
  }
}
