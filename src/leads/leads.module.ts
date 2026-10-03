import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { MailModule } from '../common/mail/mail.module';

@Module({
  imports: [MailModule],
  controllers: [LeadsController],
  providers: [LeadsService],
})
export class LeadsModule {}
