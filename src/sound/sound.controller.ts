import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../auth/strategies/jwt.strategy';
import { SoundService } from './sound.service';

/**
 * Alert history REST API — what the Flutter history screen reads/manages.
 * Live alerts arrive over the WebSocket (`SoundGateway`); these endpoints let
 * the history persist and sync across devices/sessions.
 */
@Controller('me/alerts')
@UseGuards(JwtAuthGuard)
export class SoundController {
  constructor(private readonly sound: SoundService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
    const n = limit ? Number(limit) : 100;
    return this.sound.listAlerts(user.userId, Number.isFinite(n) ? n : 100);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.sound.deleteAlert(user.userId, id);
    return { ok: true };
  }

  @Delete()
  async clear(@CurrentUser() user: AuthUser) {
    await this.sound.clearAlerts(user.userId);
    return { ok: true };
  }
}
