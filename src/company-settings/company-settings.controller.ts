import { Body, Controller, Get, Patch } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CompanySettingsService } from './company-settings.service';
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto';

@Controller('company-settings')
export class CompanySettingsController {
  constructor(private service: CompanySettingsService) {}

  // Readable by everyone — this is the constant header printed on every PI/Bill/Invoice,
  // and it's fetched from the login page before a session exists.
  @Public()
  @Get()
  get() {
    return this.service.get();
  }

  @Roles(UserRole.ADMIN)
  @Patch()
  update(@Body() dto: UpdateCompanySettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.update(dto, user.id);
  }
}
