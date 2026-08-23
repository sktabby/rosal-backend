import { Controller, Get } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

@Controller()
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Roles(UserRole.ADMIN)
  @Get('admin/dashboard-summary')
  adminSummary() {
    return this.dashboardService.adminSummary();
  }

  @Roles(UserRole.SELLER)
  @Get('app/home-summary')
  sellerSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboardService.sellerSummary(user);
  }

  @Roles(UserRole.DISPATCHER)
  @Get('app/dispatcher-summary')
  dispatcherSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboardService.dispatcherSummary(user);
  }
}
