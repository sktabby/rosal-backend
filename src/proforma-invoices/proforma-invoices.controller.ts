import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PiStatus, UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ProformaInvoicesService } from './proforma-invoices.service';
import { CreatePiDto } from './dto/create-pi.dto';
import { UpdatePiDto } from './dto/update-pi.dto';

@Roles(UserRole.SELLER)
@Controller('pi')
export class ProformaInvoicesController {
  constructor(private piService: ProformaInvoicesService) {}

  @Post()
  create(@Body() dto: CreatePiDto, @CurrentUser() user: AuthenticatedUser) {
    return this.piService.create(dto, user);
  }

  // v1.1: when clientId is present this is the Create-Order fetch step —
  // routes to the dedicated orderable-PI query (30-day window, not
  // editLocked, not Cancelled/Archived) instead of the general list.
  @Get()
  findMany(
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('clientId') clientId?: string,
  ) {
    if (clientId) {
      return this.piService.findOrderableForClient(user, clientId);
    }
    const statusFilter = status
      ? (status.split(',') as PiStatus[]).length === 1
        ? (status as PiStatus)
        : (status.split(',') as PiStatus[])
      : undefined;
    return this.piService.findMany(user, {
      search,
      status: statusFilter,
      page: page ? Number(page) : 1,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.piService.findOne(id, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePiDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.piService.update(id, dto, user);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.piService.cancel(id, user);
  }
}
