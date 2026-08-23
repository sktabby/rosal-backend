import { Controller, Get, Param, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { OrderEventsService } from './order-events.service';

@Roles(UserRole.ADMIN)
@Controller('order-events')
export class OrderEventsController {
  constructor(private orderEventsService: OrderEventsService) {}

  // e.g. GET /order-events/SalesOrder/:id — audit trail for one record
  @Get(':entityType/:entityId')
  listForEntity(@Param('entityType') entityType: string, @Param('entityId') entityId: string) {
    return this.orderEventsService.listForEntity(entityType, entityId);
  }
}
