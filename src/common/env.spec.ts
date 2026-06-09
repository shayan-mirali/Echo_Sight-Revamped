import type { ConfigService } from '@nestjs/config';

import {
  assertProductionConfig,
  corsOrigins,
  DEV_JWT_SECRET,
  intEnv,
  isProduction,
  jwtSecret,
} from './env';

/** Minimal ConfigService stand-in backed by a plain map. */
function cfg(map: Record<string, string> = {}): ConfigService {
  return { get: (k: string) => map[k] } as unknown as ConfigService;
}

const PROD_OK = {
  NODE_ENV: 'production',
  JWT_ACCESS_SECRET: 'a-strong-random-secret',
  CORS_ORIGIN: 'https://app.example',
  DATABASE_URL: 'postgresql://user:pass@host:5432/db',
};

describe('env helpers', () => {
  describe('corsOrigins', () => {
    it('returns true for * or unset', () => {
      expect(corsOrigins(cfg({ CORS_ORIGIN: '*' }))).toBe(true);
      expect(corsOrigins(cfg({}))).toBe(true);
    });
    it('splits a comma-separated allowlist', () => {
      expect(corsOrigins(cfg({ CORS_ORIGIN: 'https://a.com, https://b.com' }))).toEqual([
        'https://a.com',
        'https://b.com',
      ]);
    });
  });

  describe('jwtSecret', () => {
    it('falls back to the dev secret', () => {
      expect(jwtSecret(cfg({}))).toBe(DEV_JWT_SECRET);
    });
    it('uses the configured secret', () => {
      expect(jwtSecret(cfg({ JWT_ACCESS_SECRET: 'xyz' }))).toBe('xyz');
    });
  });

  describe('isProduction', () => {
    it('is true only when NODE_ENV=production', () => {
      expect(isProduction(cfg({ NODE_ENV: 'production' }))).toBe(true);
      expect(isProduction(cfg({ NODE_ENV: 'development' }))).toBe(false);
    });
  });

  describe('intEnv', () => {
    it('parses a positive int or falls back', () => {
      expect(intEnv(cfg({ N: '5' }), 'N', 1)).toBe(5);
      expect(intEnv(cfg({}), 'N', 1)).toBe(1);
      expect(intEnv(cfg({ N: 'nope' }), 'N', 7)).toBe(7);
    });
  });

  describe('assertProductionConfig', () => {
    it('does not throw outside production', () => {
      expect(() => assertProductionConfig(cfg({ NODE_ENV: 'development' }))).not.toThrow();
    });

    it('throws on dev secret / open CORS / SQLite in production', () => {
      expect(() => assertProductionConfig(cfg({ NODE_ENV: 'production' }))).toThrow(/JWT_ACCESS_SECRET/);
      expect(() =>
        assertProductionConfig(cfg({ ...PROD_OK, CORS_ORIGIN: '*' })),
      ).toThrow(/CORS_ORIGIN/);
      expect(() =>
        assertProductionConfig(cfg({ ...PROD_OK, DATABASE_URL: 'file:./dev.db' })),
      ).toThrow(/SQLite/);
    });

    it('passes with a fully valid production config', () => {
      expect(() => assertProductionConfig(cfg(PROD_OK))).not.toThrow();
    });
  });
});
