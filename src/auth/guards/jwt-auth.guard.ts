import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Requires a valid Bearer access token. Use with `@UseGuards(JwtAuthGuard)`. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
