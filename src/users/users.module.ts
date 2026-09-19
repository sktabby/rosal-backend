import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AuthModule } from '../auth/auth.module';
import { OrderEventsModule } from '../order-events/order-events.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [AuthModule, OrderEventsModule, RealtimeModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
