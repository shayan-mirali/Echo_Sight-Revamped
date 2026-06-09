import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { AuthUser } from '../strategies/jwt.strategy';

/** Injects the authenticated user (set by JwtStrategy) into a handler param. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as AuthUser;
  },
);
