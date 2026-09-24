import { Injectable } from '@nestjs/common';
import { PiStatus, SalesOrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async adminSummary() {
    const [activeUsers, activeClients, activeProducts, pendingOrders, dispatchedOrders] =
      await Promise.all([
        this.prisma.user.count({ where: { status: 'ACTIVE', deletedAt: null } }),
        this.prisma.client.count({ where: { deletedAt: null } }),
        this.prisma.product.count({ where: { deletedAt: null } }),
        this.prisma.salesOrder.count({ where: { status: SalesOrderStatus.PENDING } }),
        this.prisma.salesOrder.count({ where: { status: SalesOrderStatus.DISPATCHED } }),
      ]);

    const recentEvents = await this.prisma.orderEvent.findMany({
      orderBy: { timestamp: 'desc' },
      take: 15,
      include: { actor: { select: { firstName: true, lastName: true, role: true } } },
    });

    return { activeUsers, activeClients, activeProducts, pendingOrders, dispatchedOrders, recentEvents };
  }

  /** Seller Home: billing card count ("2 dispatched orders awaiting bill") + quick counts. */
  async sellerSummary(seller: AuthenticatedUser) {
    const [draftPiCount, pendingOrderCount, dispatchedAwaitingBill] = await Promise.all([
      this.prisma.proformaInvoice.count({ where: { sellerId: seller.id, status: PiStatus.DRAFT } }),
      this.prisma.salesOrder.count({ where: { sellerId: seller.id, status: SalesOrderStatus.PENDING } }),
      this.prisma.salesOrder.count({
        where: { sellerId: seller.id, status: SalesOrderStatus.DISPATCHED, bill: null },
      }),
    ]);

    return { draftPiCount, pendingOrderCount, dispatchedAwaitingBill };
  }

  /** Dispatcher Home: Pending / Processing counts scoped to their assigned Factory Unit. */
  async dispatcherSummary(dispatcher: AuthenticatedUser) {
    if (!dispatcher.assignedFactoryUnitId) {
      return { pendingCount: 0, processingCount: 0, dispatchCount: 0, completedCount: 0 };
    }
    const shipped = { status: { in: [SalesOrderStatus.DISPATCHED, SalesOrderStatus.BILLED] } };
    const [pendingCount, processingCount, dispatchCount, completedCount] = await Promise.all([
      this.prisma.salesOrder.count({
        where: { factoryUnitId: dispatcher.assignedFactoryUnitId, status: SalesOrderStatus.PENDING },
      }),
      this.prisma.salesOrder.count({
        where: { factoryUnitId: dispatcher.assignedFactoryUnitId, status: SalesOrderStatus.PROCESSING },
      }),
      // Dispatch = shipped, LR not yet submitted; Completed = LR submitted by the seller.
      this.prisma.salesOrder.count({
        where: {
          factoryUnitId: dispatcher.assignedFactoryUnitId,
          ...shipped,
          NOT: { bill: { lrSubmittedAt: { not: null } } },
        },
      }),
      this.prisma.salesOrder.count({
        where: {
          factoryUnitId: dispatcher.assignedFactoryUnitId,
          ...shipped,
          bill: { lrSubmittedAt: { not: null } },
        },
      }),
    ]);
    return { pendingCount, processingCount, dispatchCount, completedCount };
  }
}
