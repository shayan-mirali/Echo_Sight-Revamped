import { Controller, Get } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Liveness + readiness probe. Unauthenticated, cheap, and safe to hammer.
 *
 *   GET /api/health -> { status, db, uptime, timestamp }
 *
 * Always returns 200 (the process is alive); `db` reports whether the database
 * is reachable so a monitor/Render can distinguish "app up, DB down".
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    let db: 'up' | 'down' = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'down';
    }
    return {
      status: 'ok',
      db,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
