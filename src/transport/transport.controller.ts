import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { TransportService } from './transport.service';
import { CreateTransportDto } from './dto/create-transport.dto';

@Controller('transport')
export class TransportController {
  constructor(private transportService: TransportService) {}

  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() dto: CreateTransportDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.create(dto, user.id);
  }

  // Readable by all (Seller PI form dropdown)
  @Get()
  findMany(@Query('search') search?: string, @Query('page') page?: string) {
    return this.transportService.findMany({ search, page: page ? Number(page) : 1 });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.transportService.findOne(id);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateTransportDto>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.transportService.update(id, dto, user.id);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.softDelete(id, user.id);
  }
}
