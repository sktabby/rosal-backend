import { Controller, Get, Param, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { OrderEventsService } from './order-events.service';

@Roles(UserRole.ADMIN)
@Controller()
export class OrderEventsController {
  constructor(private orderEventsService: OrderEventsService) {}

  // Global feed for the Admin History page — GET /admin/audit-log?page=&entityType=
  @Get('admin/audit-log')
  listAll(@Query('page') page?: string, @Query('entityType') entityType?: string) {
    return this.orderEventsService.listAll({
      page: page ? Number(page) : 1,
      entityType,
    });
  }

  // Per-record audit trail — GET /order-events/SalesOrder/:id
  @Get('order-events/:entityType/:entityId')
  listForEntity(@Param('entityType') entityType: string, @Param('entityId') entityId: string) {
    return this.orderEventsService.listForEntity(entityType, entityId);
  }
}