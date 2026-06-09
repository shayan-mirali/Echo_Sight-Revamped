import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';

import { RateLimitGuard } from './common/rate-limit.guard';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { SettingsModule } from './settings/settings.module';
import { SoundModule } from './sound/sound.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    NotificationsModule,
    UsersModule,
    AuthModule,
    SettingsModule,
    SoundModule,
    HealthModule,
  ],
  providers: [
    // Global, but only throttles routes that opt in with @RateLimit.
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
