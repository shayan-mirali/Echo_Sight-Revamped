import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RateLimitGuard, RateLimitOptions } from './rate-limit.guard';

function context(ip = '1.1.1.1', path = '/auth/login'): ExecutionContext {
  const req = { method: 'POST', route: { path }, path, ip, socket: {} };
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function guardWith(opts?: RateLimitOptions): RateLimitGuard {
  const reflector = { getAllAndOverride: () => opts } as unknown as Reflector;
  return new RateLimitGuard(reflector);
}

describe('RateLimitGuard', () => {
  it('passes through routes with no @RateLimit metadata', () => {
    const guard = guardWith(undefined);
    expect(guard.canActivate(context())).toBe(true);
  });

  it('allows up to the limit, then throws 429', () => {
    const guard = guardWith({ limit: 2, windowMs: 10_000 });
    expect(guard.canActivate(context())).toBe(true);
    expect(guard.canActivate(context())).toBe(true);

    let status = 0;
    try {
      guard.canActivate(context());
    } catch (e) {
      status = (e as HttpException).getStatus();
    }
    expect(status).toBe(429);
  });

  it('tracks limits independently per client IP', () => {
    const guard = guardWith({ limit: 1, windowMs: 10_000 });
    expect(guard.canActivate(context('1.1.1.1'))).toBe(true);
    // a different IP still has its own budget
    expect(guard.canActivate(context('2.2.2.2'))).toBe(true);
    // the first IP is now over its limit
    expect(() => guard.canActivate(context('1.1.1.1'))).toThrow(HttpException);
  });
});
