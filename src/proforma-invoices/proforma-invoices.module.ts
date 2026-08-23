import { Module } from '@nestjs/common';
import { ProformaInvoicesService } from './proforma-invoices.service';
import { ProformaInvoicesController } from './proforma-invoices.controller';
import { OrderEventsModule } from '../order-events/order-events.module';

@Module({
  imports: [OrderEventsModule],
  controllers: [ProformaInvoicesController],
  providers: [ProformaInvoicesService],
  exports: [ProformaInvoicesService],
})
export class ProformaInvoicesModule {}
