import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';

@Roles(UserRole.ADMIN)
@Controller()
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('users/check-code')
  checkCode(@Query('code') code: string) {
    return this.usersService.checkCodeAvailable(code);
  }

  @Post('admin/users')
  create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.create(dto, user.id);
  }

  @Get('users')
  findMany(
    @Query('role') role?: UserRole,
    @Query('unassigned') unassigned?: string,
    @Query('page') page?: string,
    @Query('search') search?: string,
  ) {
    return this.usersService.findMany({
      role,
      unassigned: unassigned === 'true',
      page: page ? Number(page) : 1,
      search,
    });
  }

  @Get('users/:id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch('users/:id')
  update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateUserDto>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.update(id, dto, user.id);
  }

  @Delete('users/:id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.softDelete(id, user.id);
  }

  @Post('users/:id/reset-password')
  resetPassword(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.resetPassword(id, user.id);
  }
}
