import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

/**
 * Centralized environment helpers + production guard rails.
 *
 * The dev defaults here let the project run with zero config locally, but
 * shipping them to production would be a security hole (a known JWT secret =
 * anyone can mint tokens; `*` CORS = any site can call the API). `assertProd*`
 * fails fast at boot so a misconfigured prod deploy never starts.
 */

const logger = new Logger('Env');

/** The well-known dev secret. Refusing to boot prod with this is the point. */
export const DEV_JWT_SECRET = 'dev-access-secret-change-me';

export function isProduction(config?: ConfigService): boolean {
  const env =
    config?.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? 'development';
  return env === 'production';
}

/** The JWT access secret, with the shared dev fallback. */
export function jwtSecret(config: ConfigService): string {
  return config.get<string>('JWT_ACCESS_SECRET') ?? DEV_JWT_SECRET;
}

/**
 * Allowed CORS origins. `CORS_ORIGIN` is a comma-separated list, or `*` for
 * any origin (dev default). Returns `true` (reflect any origin) for `*`.
 */
export function corsOrigins(config: ConfigService): string[] | boolean {
  const raw = (config.get<string>('CORS_ORIGIN') ?? '*').trim();
  if (raw === '*' || raw === '') return true;
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/** Read a positive integer env var, falling back to `fallback` if unset/invalid. */
export function intEnv(
  config: ConfigService,
  key: string,
  fallback: number,
): number {
  const n = Number(config.get(key));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Refuse to boot a production deploy that still carries dev-only secrets or a
 * wide-open CORS policy. Called once from `main.ts` after the app is created.
 */
export function assertProductionConfig(config: ConfigService): void {
  if (!isProduction(config)) {
    logger.log('Running in development mode (relaxed config guards).');
    return;
  }

  const problems: string[] = [];
  if (jwtSecret(config) === DEV_JWT_SECRET) {
    problems.push(
      'JWT_ACCESS_SECRET is unset or still the dev default — set a strong random value (e.g. `openssl rand -hex 32`).',
    );
  }
  if (corsOrigins(config) === true) {
    problems.push(
      'CORS_ORIGIN is `*` (any origin) — set it to your app/web origins in production.',
    );
  }
  const dbUrl = config.get<string>('DATABASE_URL') ?? '';
  if (dbUrl.startsWith('file:')) {
    problems.push(
      'DATABASE_URL points at a local SQLite file — use Postgres in production.',
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `Refusing to start in production with insecure config:\n  - ${problems.join(
        '\n  - ',
      )}`,
    );
  }
}
