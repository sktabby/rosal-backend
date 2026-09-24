import { Module } from '@nestjs/common';
import { ProformaInvoicesService } from './proforma-invoices.service';
import { ProformaInvoicesController } from './proforma-invoices.controller';
import { OrderEventsModule } from '../order-events/order-events.module';
import { SalesOrdersModule } from '../sales-orders/sales-orders.module';

@Module({
  imports: [OrderEventsModule, SalesOrdersModule],
  controllers: [ProformaInvoicesController],
  providers: [ProformaInvoicesService],
  exports: [ProformaInvoicesService],
})
export class ProformaInvoicesModule {}
