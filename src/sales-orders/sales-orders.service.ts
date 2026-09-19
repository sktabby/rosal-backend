import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PiStatus, SalesOrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderEventsService } from '../order-events/order-events.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { buildOrderNumber } from '../common/utils/id-generator.util';
import { dispatchedActiveWindowCutoff } from '../common/utils/order-visibility.util';

@Injectable()
export class SalesOrdersService {
  constructor(
    private prisma: PrismaService,
    private orderEvents: OrderEventsService,
    private realtime: RealtimeGateway,
  ) {}

  /**
   * Generates a SalesOrder from a confirmed-eligible Draft PI:
   *  1. Freezes/snapshots the PI's current line items into lineItemsSnapshot (JSON)
   *  2. Sets PI.status = CONFIRMED, PI.editLocked = true
   *  3. Pushes order:created to the assigned Dispatcher's factoryUnit room (Socket + would-be FCM)
   */
  async create(dto: CreateOrderDto, seller: AuthenticatedUser) {
    const pi = await this.prisma.proformaInvoice.findUnique({
      where: { id: dto.piId },
      include: { lineItems: { include: { product: true } }, client: true },
    });
    if (!pi) throw new NotFoundException('PI not found');
    if (pi.sellerId !== seller.id) throw new ForbiddenException();
    if (pi.editLocked) {
      throw new BadRequestException('This PI already has an active order');
    }
    if (pi.status !== PiStatus.DRAFT && pi.status !== PiStatus.CONFIRMED) {
      // CONFIRMED case covers cancel-then-recreate: PI stays CONFIRMED conceptually
      // once it's had an order; what matters is editLocked, checked above.
      if (pi.status === PiStatus.CANCELLED || pi.status === PiStatus.ARCHIVED) {
        throw new BadRequestException('This PI can no longer be ordered');
      }
    }

    const factoryUnit = await this.prisma.factoryUnit.findUniqueOrThrow({
      where: { id: dto.factoryUnitId },
      include: { assignedDispatcher: { select: { id: true } } },
    });

    const lineItemsSnapshot = pi.lineItems.map((li) => ({
      productId: li.productId,
      productName: li.product.name,
      hsnCode: li.product.hsnCode,
      unit: li.product.unit,
      taxPercent: li.product.taxPercent,
      brand: li.brand,
      qty: li.qty,
      price: li.price,
      discountPercent: li.discountPercent,
    }));

    const orderCount = await this.prisma.salesOrder.count();
    const orderNumber = buildOrderNumber(orderCount);

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.salesOrder.create({
        data: {
          orderNumber,
          piId: pi.id,
          lineItemsSnapshot,
          factoryUnitId: dto.factoryUnitId,
          sellerId: seller.id,
          status: SalesOrderStatus.PENDING,
        },
      });

      await tx.proformaInvoice.update({
        where: { id: pi.id },
        data: { status: PiStatus.CONFIRMED, editLocked: true },
      });

      return created;
    });

    await this.orderEvents.log({
      entityType: 'SalesOrder',
      entityId: order.id,
      action: 'created',
      actorId: seller.id,
    });

    this.realtime.emitOrderCreated(dto.factoryUnitId, {
      orderId: order.id,
      orderNumber: order.orderNumber,
      clientName: `${pi.client.firstName} ${pi.client.lastName}`,
      status: order.status,
    });
    // FCM push to factoryUnit.assignedDispatcher would fire here in production.

    return order;
  }

  /**
   * Seller: own orders. Dispatcher: orders for their assigned factory unit only.
   *
   * v1.1: `history` controls the 48-hour Dispatched visibility window. When
   * false/omitted (the default — "active" list semantics), DISPATCHED orders
   * whose completedAt is older than 48h are excluded, as if they'd already
   * moved to History. When true, no time-based filtering is applied — used
   * by History-style screens (Dispatcher Order History, Seller Order
   * History) that must keep showing dispatched orders regardless of age.
   * REJECTED/CANCELLED/BILLED/PENDING/PROCESSING are never time-filtered —
   * only DISPATCHED is affected, since that's the only status this rule
   * applies to per spec.
   */
  async findMany(
    user: AuthenticatedUser,
    params: {
      search?: string;
      status?: SalesOrderStatus | SalesOrderStatus[];
      page?: number;
      history?: boolean;
    },
  ) {
    const { search, status, page = 1, history = false } = params;
    const pageSize = 10;

    const where: any = {};
    if (user.role === 'SELLER') {
      where.sellerId = user.id;
    } else if (user.role === 'DISPATCHER') {
      if (!user.assignedFactoryUnitId) {
        return { items: [], total: 0, page, pageSize };
      }
      where.factoryUnitId = user.assignedFactoryUnitId;
    }
    if (status) where.status = Array.isArray(status) ? { in: status } : status;
    if (search) {
      where.orderNumber = { contains: search, mode: 'insensitive' };
    }

    if (!history) {
      const statusesRequested = status ? (Array.isArray(status) ? status : [status]) : null;
      const dispatchedRequested = !statusesRequested || statusesRequested.includes(SalesOrderStatus.DISPATCHED);
      if (dispatchedRequested) {
        const cutoff = dispatchedActiveWindowCutoff();
        // Only DISPATCHED orders are time-filtered; every other status in
        // the query passes through untouched.
        where.AND = [
          ...(where.AND ?? []),
          {
            OR: [
              { status: { not: SalesOrderStatus.DISPATCHED } },
              { status: SalesOrderStatus.DISPATCHED, completedAt: { gte: cutoff } },
            ],
          },
        ];
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        // bill tells the seller app an order is already billed (status stays DISPATCHED
        // until Accounts raises the invoice), so it stops offering Generate Bill.
        include: { proformaInvoice: { include: { client: true } }, factoryUnit: true, bill: { select: { id: true, createdAt: true } } },
      }),
      this.prisma.salesOrder.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: {
        proformaInvoice: { include: { client: true, transport: true } },
        bill: { select: { id: true, createdAt: true } },
        factoryUnit: {
          include: {
            assignedDispatcher: {
              select: { id: true, firstName: true, lastName: true, employeeCode: true, phone: true, email: true },
            },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (user.role === 'SELLER' && order.sellerId !== user.id) throw new ForbiddenException();
    if (user.role === 'DISPATCHER' && order.factoryUnitId !== user.assignedFactoryUnitId) {
      throw new ForbiddenException();
    }

    return order;
  }

  private async assertDispatcherOwnsOrder(orderId: string, user: AuthenticatedUser) {
    const order = await this.prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
    if (order.factoryUnitId !== user.assignedFactoryUnitId) throw new ForbiddenException();
    return order;
  }

  async accept(id: string, dispatcher: AuthenticatedUser) {
    const order = await this.assertDispatcherOwnsOrder(id, dispatcher);
    if (order.status !== SalesOrderStatus.PENDING) {
      throw new BadRequestException('Only a Pending order can be accepted');
    }

    const updated = await this.prisma.salesOrder.update({
      where: { id },
      data: { status: SalesOrderStatus.PROCESSING, acceptedAt: new Date() },
    });

    await this.orderEvents.log({
      entityType: 'SalesOrder',
      entityId: id,
      action: 'accepted',
      actorId: dispatcher.id,
    });

    this.realtime.emitOrderAccepted(order.sellerId, id, { orderId: id, orderNumber: order.orderNumber, status: updated.status });
    return updated;
  }

  async complete(id: string, dispatcher: AuthenticatedUser) {
    const order = await this.assertDispatcherOwnsOrder(id, dispatcher);
    if (order.status !== SalesOrderStatus.PROCESSING) {
      throw new BadRequestException('Only a Processing order can be completed');
    }

    const updated = await this.prisma.salesOrder.update({
      where: { id },
      data: { status: SalesOrderStatus.DISPATCHED, completedAt: new Date() },
    });

    await this.orderEvents.log({
      entityType: 'SalesOrder',
      entityId: id,
      action: 'completed',
      actorId: dispatcher.id,
    });

    // FCM "please bill it" push would fire alongside this in production.
    this.realtime.emitOrderCompleted(order.sellerId, id, { orderId: id, orderNumber: order.orderNumber, status: updated.status });
    return updated;
  }

  async reject(id: string, dispatcher: AuthenticatedUser) {
    const order = await this.assertDispatcherOwnsOrder(id, dispatcher);
    if (order.status !== SalesOrderStatus.PENDING && order.status !== SalesOrderStatus.PROCESSING) {
      throw new BadRequestException('This order can no longer be rejected');
    }

    const updated = await this.prisma.salesOrder.update({
      where: { id },
      data: { status: SalesOrderStatus.REJECTED, rejectedAt: new Date() },
    });

    await this.orderEvents.log({
      entityType: 'SalesOrder',
      entityId: id,
      action: 'rejected',
      actorId: dispatcher.id,
    });

    this.realtime.emitOrderRejected(order.sellerId, id, { orderId: id, orderNumber: order.orderNumber, status: updated.status });
    return updated;
  }

  /**
   * Seller-only, at ANY status (Pending/Processing/Dispatched). Sets CANCELLED,
   * unlocks the source PI so it becomes editable in place again (no versioning).
   *
   * Blocks cancellation once a Bill already exists against this order — even
   * though the order's own status might still show DISPATCHED (Bill creation
   * doesn't change Order.status; only Invoice creation does, to BILLED).
   * Without this check, an order could be cancelled while a Bill for it is
   * still sitting in Accounts' inbox, leaving an orphaned Bill referencing a
   * cancelled order — exactly what "prevent orphaned Invoice/Bill
   * references" in the security checklist is about.
   */
  async cancel(id: string, seller: AuthenticatedUser) {
    const order = await this.prisma.salesOrder.findUniqueOrThrow({
      where: { id },
      include: { bill: { select: { id: true } } },
    });
    if (order.sellerId !== seller.id) throw new ForbiddenException();
    if (order.status === SalesOrderStatus.CANCELLED || order.status === SalesOrderStatus.REJECTED || order.status === SalesOrderStatus.BILLED) {
      throw new BadRequestException('This order can no longer be cancelled');
    }
    if (order.bill) {
      throw new BadRequestException(
        'A bill has already been generated for this order and cannot be cancelled from here — contact Accounts.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const cancelled = await tx.salesOrder.update({
        where: { id },
        data: {
          status: SalesOrderStatus.CANCELLED,
          cancelledBy: seller.id,
          cancelledAt: new Date(),
        },
      });
      await tx.proformaInvoice.update({
        where: { id: order.piId },
        data: { editLocked: false },
      });
      return cancelled;
    });

    await this.orderEvents.log({
      entityType: 'SalesOrder',
      entityId: id,
      action: 'cancelled',
      actorId: seller.id,
    });

    this.realtime.emitOrderCancelled(order.factoryUnitId, { orderId: id, orderNumber: order.orderNumber, status: updated.status });
    return updated;
  }
}
