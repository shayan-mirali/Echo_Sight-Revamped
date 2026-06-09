import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { jwtSecret } from '../../common/env';

export interface JwtPayload {
  sub: string;
  email: string;
}

export interface AuthUser {
  userId: string;
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret(config),
    });
  }

  // Whatever this returns is attached to request.user.
  validate(payload: JwtPayload): AuthUser {
    return { userId: payload.sub, email: payload.email };
  }
}
