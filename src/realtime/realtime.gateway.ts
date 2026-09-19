import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload, loadActiveSessionUser } from '../auth/session';

// process.env.CORS_ORIGINS is populated by the explicit `import 'dotenv/config'`
// at the top of main.ts, which — because ES module imports execute top-to-
// bottom in the order written — runs before this file's decorator is
// evaluated. (Note: CORS only applies to the web portal's browser client;
// Android's socket.io-client doesn't do CORS preflight at all.)
const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

/**
 * Room scoping (per backend spec §6):
 *  - factoryUnit:{id}  -> Dispatcher (order:created, order:cancelled)
 *  - user:{userId}     -> Seller (order:accepted/completed/rejected)
 *  - accounts          -> all Accounts staff (bill:created)
 *
 * Clients authenticate the socket handshake with the same JWT used for REST calls,
 * then get auto-joined to the room(s) relevant to their role.
 */
@WebSocketGateway({
  cors: { origin: corsOrigins, credentials: true },
  namespace: '/realtime',
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(private jwt: JwtService, private prisma: PrismaService) {}

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      const payload = this.jwt.verify<JwtPayload & { exp?: number }>(token);

      // Same check as every REST request: a deactivated/deleted user, or a token issued
      // before a password change, never gets a live feed of order updates.
      const user = await loadActiveSessionUser(this.prisma, payload);

      client.data.userId = user.id;
      client.data.role = user.role;
      client.data.assignedFactoryUnitId = user.assignedFactoryUnitId;

      // Lets the server end every live connection of one user (deactivation, password change).
      client.join(`session:${user.id}`);
      if (user.role === 'DISPATCHER' && user.assignedFactoryUnitId) {
        client.join(`factoryUnit:${user.assignedFactoryUnitId}`);
      }
      if (user.role === 'SELLER') {
        client.join(`user:${user.id}`);
      }
      if (user.role === 'ACCOUNTS') {
        client.join('accounts');
      }

      // A socket outliving its token would keep receiving events after the REST session
      // has expired — close it when the token does; the client reconnects with a new one.
      if (payload.exp) {
        const msLeft = payload.exp * 1000 - Date.now();
        const timer = setTimeout(() => client.disconnect(true), Math.max(msLeft, 0));
        client.once('disconnect', () => clearTimeout(timer));
      }

      this.logger.log(`Socket connected: ${user.role} ${user.id}`);
    } catch (err) {
      this.logger.warn(`Socket auth failed: ${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Socket disconnected: ${client.data?.userId ?? 'unknown'}`);
  }

  /** Closes every live connection of these users; clients must re-authenticate to reconnect. */
  disconnectUsers(...userIds: (string | null | undefined)[]) {
    for (const id of userIds) {
      if (id) this.server.in(`session:${id}`).disconnectSockets(true);
    }
  }

  /** Drops the dispatcher socket(s) in a factory unit's room, e.g. after reassignment. */
  disconnectFactoryUnit(factoryUnitId: string) {
    this.server.in(`factoryUnit:${factoryUnitId}`).disconnectSockets(true);
  }

  @SubscribeMessage('order:subscribe')
  async handleOrderSubscribe(@ConnectedSocket() client: Socket, @MessageBody() orderId: string) {
    // Lets a client (e.g. Seller viewing Order Detail) get live status pushes
    // for one specific order beyond their default role room.
    //
    // Ownership check: without this, any authenticated socket could pass an
    // arbitrary orderId and listen in on another seller's — or another
    // factory unit's — order updates in real time. Only the order's own
    // Seller, or the Dispatcher assigned to its Factory Unit, may join.
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: orderId },
      select: { sellerId: true, factoryUnitId: true },
    });
    if (!order) return; // silently ignore — don't leak whether the ID exists

    const { userId, role, assignedFactoryUnitId } = client.data;
    const isOwningSeller = role === 'SELLER' && order.sellerId === userId;
    const isAssignedDispatcher = role === 'DISPATCHER' && order.factoryUnitId === assignedFactoryUnitId;

    if (!isOwningSeller && !isAssignedDispatcher) {
      this.logger.warn(`Rejected order:subscribe — user ${userId} is not party to order ${orderId}`);
      return;
    }

    client.join(`order:${orderId}`);
  }

  private extractToken(client: Socket): string {
    const raw =
      client.handshake.auth?.token ??
      (client.handshake.headers.authorization as string | undefined);
    if (!raw) throw new UnauthorizedException('Missing token');
    return raw.replace('Bearer ', '');
  }

  // ── Emit helpers used by feature services ──────────────────────────

  emitOrderCreated(factoryUnitId: string, payload: unknown) {
    this.server.to(`factoryUnit:${factoryUnitId}`).emit('order:created', payload);
  }

  emitOrderCancelled(factoryUnitId: string, payload: unknown) {
    this.server.to(`factoryUnit:${factoryUnitId}`).emit('order:cancelled', payload);
  }

  emitOrderAccepted(sellerId: string, orderId: string, payload: unknown) {
    this.server.to(`user:${sellerId}`).to(`order:${orderId}`).emit('order:accepted', payload);
  }

  emitOrderCompleted(sellerId: string, orderId: string, payload: unknown) {
    this.server.to(`user:${sellerId}`).to(`order:${orderId}`).emit('order:completed', payload);
  }

  emitOrderRejected(sellerId: string, orderId: string, payload: unknown) {
    this.server.to(`user:${sellerId}`).to(`order:${orderId}`).emit('order:rejected', payload);
  }

  emitBillCreated(payload: unknown) {
    this.server.to('accounts').emit('bill:created', payload);
  }
}
