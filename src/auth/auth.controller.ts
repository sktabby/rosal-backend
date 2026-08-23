import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@Controller()
export class AuthController {
  constructor(private authService: AuthService) {}

  // Max 5 login attempts/minute/IP — per security checklist §3.5, this is a
  // higher-value brute-force target than a typical consumer app (small,
  // guessable employee-code user base).
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Public()
  @Post('auth/login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // Max 5 OTP-verify attempts/minute/IP at the transport level; OTP-specific
  // attempt counting (5 wrong tries invalidates the code) happens in the service.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Public()
  @Post('auth/verify-otp')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  // Max 1 resend / 30s / IP — matches the OTP screen's countdown.
  @Throttle({ default: { limit: 1, ttl: 30_000 } })
  @Public()
  @Post('auth/resend-otp')
  resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto.employeeCode);
  }

  @Get('account/me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.id);
  }

  @Post('account/change-password')
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.id, dto);
  }

  @Patch('account/notification-prefs')
  updateNotificationPrefs(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { push?: boolean; email?: boolean },
  ) {
    return this.authService.updateNotificationPrefs(user.id, body);
  }
}
