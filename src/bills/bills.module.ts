import { Module } from '@nestjs/common';
import { BillsService } from './bills.service';
import { BillsController } from './bills.controller';
import { OrderEventsModule } from '../order-events/order-events.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [OrderEventsModule, RealtimeModule],
  controllers: [BillsController],
  providers: [BillsService],
  exports: [BillsService],
})
export class BillsModule {}
