import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto';
import { OrderEventsService } from '../order-events/order-events.service';

@Injectable()
export class CompanySettingsService {
  constructor(private prisma: PrismaService, private orderEvents: OrderEventsService) {}

  /** Singleton row — created by the seed script; falls back to defaults if somehow missing. */
  async get() {
    const existing = await this.prisma.companySettings.findFirst();
    if (existing) return existing;
    return this.prisma.companySettings.create({ data: {} });
  }

  async update(dto: UpdateCompanySettingsDto, actorId: string) {
    const existing = await this.get();
    const updated = await this.prisma.companySettings.update({
      where: { id: existing.id },
      data: dto,
    });
    await this.orderEvents.log({
      entityType: 'CompanySettings',
      entityId: updated.id,
      action: 'edited',
      actorId,
    });
    return updated;
  }
}
