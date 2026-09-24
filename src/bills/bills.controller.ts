import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { BillStatus, UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { BillsService } from './bills.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { SubmitLrDto } from './dto/submit-lr.dto';
import { SaveTcDto } from './dto/save-tc.dto';

@Controller('bills')
export class BillsController {
  constructor(private billsService: BillsService) {}

  @Roles(UserRole.SELLER)
  @Post()
  create(@Body() dto: CreateBillDto, @CurrentUser() user: AuthenticatedUser) {
    return this.billsService.create(dto, user);
  }

  @Roles(UserRole.SELLER)
  @Patch(':id/lr')
  submitLr(@Param('id') id: string, @Body() dto: SubmitLrDto, @CurrentUser() user: AuthenticatedUser) {
    return this.billsService.submitLr(id, dto, user);
  }

  @Roles(UserRole.SELLER)
  @Patch(':id/tc')
  saveTc(@Param('id') id: string, @Body() dto: SaveTcDto, @CurrentUser() user: AuthenticatedUser) {
    return this.billsService.saveTc(id, dto, user);
  }

  @Roles(UserRole.SELLER, UserRole.ACCOUNTS, UserRole.ADMIN)
  @Get()
  findMany(
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('status') status?: string,
  ) {
    const statusFilter = status && (Object.values(BillStatus) as string[]).includes(status) ? (status as BillStatus) : undefined;
    return this.billsService.findMany(user, { search, page: page ? Number(page) : 1, status: statusFilter });
  }

  @Roles(UserRole.SELLER, UserRole.ACCOUNTS, UserRole.ADMIN)
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.billsService.findOne(id, user);
  }
}
