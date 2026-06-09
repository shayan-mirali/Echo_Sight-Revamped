import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

/**
 * Lightweight, dependency-free request throttling for abuse-prone endpoints
 * (login, register, password reset). A fixed-window counter keyed by client IP
 * + route — enough to blunt credential-stuffing and OTP brute-force without
 * pulling in Redis or `@nestjs/throttler`. For a multi-instance deployment,
 * swap the in-process map for a shared store.
 */

export interface RateLimitOptions {
  /** Max requests allowed within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export const RATE_LIMIT_KEY = 'rateLimit';

/** Decorate a route (or controller) to throttle it. */
export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);

interface Bucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  /** Sweep expired buckets occasionally so the map doesn't grow unbounded. */
  private lastSweep = 0;

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    // No @RateLimit on this route → not throttled.
    if (!options) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const ip = this.clientIp(req);
    const routeKey = `${req.method}:${req.route?.path ?? req.path}`;
    const key = `${ip}|${routeKey}`;

    const now = Date.now();
    this.maybeSweep(now);

    const bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return true;
    }

    if (bucket.count >= options.limit) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests — please try again later.',
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    bucket.count++;
    return true;
  }

  private clientIp(req: Request): string {
    // Express populates req.ip; behind a proxy, set `trust proxy` so it's real.
    return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  }

  private maybeSweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [k, b] of this.buckets) {
      if (now >= b.resetAt) this.buckets.delete(k);
    }
  }
}
