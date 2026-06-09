import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { RateLimit } from '../common/rate-limit.guard';
import {
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyOtpDto,
} from './auth.dto';
import { AuthService } from './auth.service';

const MIN = 60_000;

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @RateLimit({ limit: 10, windowMs: 15 * MIN })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowMs: 5 * MIN }) // blunt credential stuffing
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
    return { message: 'Logged out' };
  }

  @Post('password/forgot')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowMs: 15 * MIN }) // curb OTP-email spam
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowMs: 10 * MIN }) // curb OTP brute-force
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto);
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowMs: 10 * MIN })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }
}
