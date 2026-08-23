import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ClientsModule } from './clients/clients.module';
import { ProductsModule } from './products/products.module';
import { TransportModule } from './transport/transport.module';
import { FactoryUnitsModule } from './factory-units/factory-units.module';
import { CompanySettingsModule } from './company-settings/company-settings.module';
import { ProformaInvoicesModule } from './proforma-invoices/proforma-invoices.module';
import { SalesOrdersModule } from './sales-orders/sales-orders.module';
import { BillsModule } from './bills/bills.module';
import { InvoicesModule } from './invoices/invoices.module';
import { OrderEventsModule } from './order-events/order-events.module';
import { RealtimeModule } from './realtime/realtime.module';
import { UploadsModule } from './uploads/uploads.module';
import { SearchModule } from './search/search.module';
import { DashboardModule } from './dashboard/dashboard.module';

import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Global default rate limit — tighter per-route limits (login, OTP) are
    // set via @Throttle(...) on those specific handlers. See AuthController.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    UsersModule,
    ClientsModule,
    ProductsModule,
    TransportModule,
    FactoryUnitsModule,
    CompanySettingsModule,
    ProformaInvoicesModule,
    SalesOrdersModule,
    BillsModule,
    InvoicesModule,
    OrderEventsModule,
    RealtimeModule,
    UploadsModule,
    SearchModule,
    DashboardModule,
  ],
  providers: [
    // Every route requires a valid JWT by default; use @Public() to opt out
    // (see auth.controller.ts login/verify-otp).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Then enforce @Roles(...) where declared.
    { provide: APP_GUARD, useClass: RolesGuard },
    // Global rate limiting (per IP) — per-route overrides via @Throttle(...).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
