import { Module } from '@nestjs/common';
import { FactoryUnitsService } from './factory-units.service';
import { FactoryUnitsController } from './factory-units.controller';
import { OrderEventsModule } from '../order-events/order-events.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [OrderEventsModule, RealtimeModule],
  controllers: [FactoryUnitsController],
  providers: [FactoryUnitsService],
  exports: [FactoryUnitsService],
})
export class FactoryUnitsModule {}
