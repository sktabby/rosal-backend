import { Module } from '@nestjs/common';
import { OrderEventsService } from './order-events.service';
import { OrderEventsController } from './order-events.controller';

@Module({
  controllers: [OrderEventsController],
  providers: [OrderEventsService],
  exports: [OrderEventsService],
})
export class OrderEventsModule {}
