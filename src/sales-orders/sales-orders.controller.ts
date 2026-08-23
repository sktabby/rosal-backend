import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SalesOrderStatus, UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { SalesOrdersService } from './sales-orders.service';
import { CreateOrderDto } from './dto/create-order.dto';

@Controller('orders')
export class SalesOrdersController {
  constructor(private ordersService: SalesOrdersService) {}

  // Caps order-create spam (checklist §5.4) — generous enough for real usage,
  // tight enough to stop a compromised seller account flooding a dispatcher's
  // queue/FCM notifications.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Roles(UserRole.SELLER)
  @Post()
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.create(dto, user);
  }

  // Seller sees own orders; Dispatcher sees their factory unit's queue — service scopes both.
  // `history=true` bypasses the 48h Dispatched visibility window (v1.1) —
  // pass it from History-style screens; omit/false for active queue/list views.
  // `archived` accepted as an alias for `history` (frontend teams may use
  // either name — both map to the same behavior server-side).
  @Roles(UserRole.SELLER, UserRole.DISPATCHER)
  @Get()
  findMany(
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('history') history?: string,
    @Query('archived') archived?: string,
  ) {
    const statusFilter = status
      ? (status.split(',') as SalesOrderStatus[]).length === 1
        ? (status as SalesOrderStatus)
        : (status.split(',') as SalesOrderStatus[])
      : undefined;
    return this.ordersService.findMany(user, {
      search,
      status: statusFilter,
      page: page ? Number(page) : 1,
      history: history === 'true' || archived === 'true',
    });
  }

  @Roles(UserRole.SELLER, UserRole.DISPATCHER)
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.findOne(id, user);
  }

  @Roles(UserRole.DISPATCHER)
  @Patch(':id/accept')
  accept(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.accept(id, user);
  }

  @Roles(UserRole.DISPATCHER)
  @Patch(':id/complete')
  complete(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.complete(id, user);
  }

  @Roles(UserRole.DISPATCHER)
  @Patch(':id/reject')
  reject(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.reject(id, user);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Roles(UserRole.SELLER)
  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.cancel(id, user);
  }
}