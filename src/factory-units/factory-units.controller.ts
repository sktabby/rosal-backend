import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { FactoryUnitsService } from './factory-units.service';
import { CreateFactoryUnitDto } from './dto/create-factory-unit.dto';

@Controller('factory-units')
export class FactoryUnitsController {
  constructor(private factoryUnitsService: FactoryUnitsService) {}

  @Roles(UserRole.ADMIN)
  @Get('unassigned-dispatchers')
  unassignedDispatchers() {
    return this.factoryUnitsService.findUnassignedDispatchers();
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() dto: CreateFactoryUnitDto, @CurrentUser() user: AuthenticatedUser) {
    return this.factoryUnitsService.create(dto, user.id);
  }

  // Readable by all (Seller "Create Order" factory-unit dropdown shows name + dispatcher)
  @Get()
  findMany(@Query('search') search?: string, @Query('page') page?: string) {
    return this.factoryUnitsService.findMany({ search, page: page ? Number(page) : 1 });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.factoryUnitsService.findOne(id);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateFactoryUnitDto>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.factoryUnitsService.update(id, dto, user.id);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.factoryUnitsService.softDelete(id, user.id);
  }
}
