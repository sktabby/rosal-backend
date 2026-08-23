import { Module } from '@nestjs/common';
import { FactoryUnitsService } from './factory-units.service';
import { FactoryUnitsController } from './factory-units.controller';
import { OrderEventsModule } from '../order-events/order-events.module';

@Module({
  imports: [OrderEventsModule],
  controllers: [FactoryUnitsController],
  providers: [FactoryUnitsService],
  exports: [FactoryUnitsService],
})
export class FactoryUnitsModule {}
