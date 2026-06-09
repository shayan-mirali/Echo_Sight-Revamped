import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../auth/strategies/jwt.strategy';
import { UpdateSettingsDto } from './settings.dto';
import { SettingsService } from './settings.service';

@Controller('me/settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.settings.get(user.userId);
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateSettingsDto) {
    return this.settings.update(user.userId, dto);
  }
}
