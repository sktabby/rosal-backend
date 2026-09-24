import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BillStatus, SalesOrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { SubmitLrDto } from './dto/submit-lr.dto';
import { SaveTcDto } from './dto/save-tc.dto';
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
  async findMany(user: AuthenticatedUser, params: { search?: string; page?: number; status?: BillStatus }) {
    const { search, page = 1, status } = params;
    const pageSize = 10;

    const where: any = {};
    if (user.role === 'SELLER') {
      where.createdBySellerId = user.id;
    }
    // ACCOUNTS/ADMIN: no seller filter — shared inbox across all sellers.
    // PENDING = still waiting for an invoice; INVOICED = done.
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { client: { firstName: { contains: search, mode: 'insensitive' } } },
        { client: { lastName: { contains: search, mode: 'insensitive' } } },
        { order: { orderNumber: { contains: search, mode: 'insensitive' } } },
        { createdBySeller: { firstName: { contains: search, mode: 'insensitive' } } },
        { createdBySeller: { lastName: { contains: search, mode: 'insensitive' } } },
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
          invoice: { select: { id: true, invoiceNumber: true, createdAt: true } },
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
        // The PI carries transport type (Terms of Delivery default) and ship-to.
        order: { include: { proformaInvoice: { include: { transport: true } } } },
        createdBySeller: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true },
        },
        // Present once Accounts has invoiced this bill — the UI must not offer a second one.
        invoice: { select: { id: true, invoiceNumber: true, createdAt: true, grandTotal: true } },
      },
    });
    if (!bill) throw new NotFoundException('Bill not found');
    if (user.role === 'SELLER' && bill.createdBySellerId !== user.id) {
      throw new ForbiddenException();
    }
    return bill;
  }

  private async ownBill(id: string, seller: AuthenticatedUser) {
    const bill = await this.prisma.bill.findUnique({ where: { id }, include: { order: true } });
    if (!bill) throw new NotFoundException('Bill not found');
    if (bill.createdBySellerId !== seller.id) throw new ForbiddenException();
    return bill;
  }

  /**
   * Seller: record the Lorry Receipt once Accounts has invoiced the bill. This is what moves
   * the order to Completed on the dispatcher's screen. Final: it can be submitted only once.
   */
  async submitLr(id: string, dto: SubmitLrDto, seller: AuthenticatedUser) {
    const bill = await this.ownBill(id, seller);
    if (bill.status !== BillStatus.INVOICED) {
      throw new BadRequestException('The LR can be added once Accounts has raised the invoice.');
    }
    if (bill.lrSubmittedAt) throw new BadRequestException('The LR has already been submitted.');
    const lrNumber = dto.lrNumber.trim();
    if (!lrNumber) throw new BadRequestException('Enter the LR number.');

    await this.prisma.bill.update({ where: { id }, data: { lrNumber, lrSubmittedAt: new Date() } });
    await this.orderEvents.log({ entityType: 'Bill', entityId: id, action: 'lr_submitted', actorId: seller.id });
    this.realtime.emitOrderUpdated(bill.order.factoryUnitId, {
      orderId: bill.orderId,
      orderNumber: bill.order.orderNumber,
      status: bill.order.status,
    });
    return this.findOne(id, seller);
  }

  /** Seller: save serial + batch numbers per product for the Test Certificate. Repeatable. */
  async saveTc(id: string, dto: SaveTcDto, seller: AuthenticatedUser) {
    const bill = await this.ownBill(id, seller);
    if (!bill.lrSubmittedAt) throw new BadRequestException('Submit the LR before generating the TC.');
    const lineItems = await this.prisma.billLineItem.findMany({ where: { billId: id }, select: { id: true } });
    const valid = new Set(lineItems.map((l) => l.id));
    if (dto.items.some((i) => !valid.has(i.lineItemId))) {
      throw new BadRequestException('One or more items do not belong to this bill.');
    }
    await this.prisma.$transaction(
      dto.items.map((i) =>
        this.prisma.billLineItem.update({
          where: { id: i.lineItemId },
          data: { serialNumber: i.serialNumber?.trim() || null, batchNumber: i.batchNumber?.trim() || null },
        }),
      ),
    );
    await this.orderEvents.log({ entityType: 'Bill', entityId: id, action: 'tc_saved', actorId: seller.id });
    return this.findOne(id, seller);
  }
}
