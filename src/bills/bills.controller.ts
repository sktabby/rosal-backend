import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { BillsService } from './bills.service';
import { CreateBillDto } from './dto/create-bill.dto';

@Controller('bills')
export class BillsController {
  constructor(private billsService: BillsService) {}

  @Roles(UserRole.SELLER)
  @Post()
  create(@Body() dto: CreateBillDto, @CurrentUser() user: AuthenticatedUser) {
    return this.billsService.create(dto, user);
  }

  @Roles(UserRole.SELLER, UserRole.ACCOUNTS, UserRole.ADMIN)
  @Get()
  findMany(
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
    @Query('page') page?: string,
  ) {
    return this.billsService.findMany(user, { search, page: page ? Number(page) : 1 });
  }

  @Roles(UserRole.SELLER, UserRole.ACCOUNTS, UserRole.ADMIN)
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.billsService.findOne(id, user);
  }
}
