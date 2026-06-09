import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomInt } from 'crypto';

import { OtpPurpose } from '../common/defaults';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyOtpDto,
} from './auth.dto';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

interface PublicUser {
  id: string;
  email: string;
  registeredName: string;
  verified: boolean;
}

interface AuthResult extends Tokens {
  user: PublicUser;
}

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  // ── Registration / login ────────────────────────────────────────────

  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.users.createWithDefaults({
      email: dto.email,
      passwordHash,
      registeredName: dto.registeredName.trim(),
    });

    const tokens = await this.issueTokens(user);
    return { user: this.toPublicUser(user), ...tokens };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.users.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = await this.issueTokens(user);
    return { user: this.toPublicUser(user), ...tokens };
  }

  // ── Token rotation ──────────────────────────────────────────────────

  async refresh(rawToken: string): Promise<Tokens> {
    const [id, secret] = rawToken.split('.');
    if (!id || !secret) {
      throw new UnauthorizedException('Malformed refresh token');
    }

    const record = await this.prisma.refreshToken.findUnique({ where: { id } });
    if (
      !record ||
      record.revoked ||
      record.expiresAt.getTime() < Date.now() ||
      !(await bcrypt.compare(secret, record.tokenHash))
    ) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Rotate: revoke the used token, then mint a fresh pair.
    await this.prisma.refreshToken.update({
      where: { id },
      data: { revoked: true },
    });

    const user = await this.users.findById(record.userId);
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }
    return this.issueTokens(user);
  }

  async logout(rawToken: string): Promise<void> {
    const [id] = rawToken.split('.');
    if (!id) return;
    await this.prisma.refreshToken
      .update({ where: { id }, data: { revoked: true } })
      .catch(() => undefined); // already gone — nothing to do
  }

  // ── Password reset via OTP ──────────────────────────────────────────

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const user = await this.users.findByEmail(dto.email);
    // Only act if the user exists, but always return the same response so we
    // don't leak which emails are registered.
    if (user) {
      const code = await this.createOtp(user.id, OtpPurpose.ResetPassword);
      await this.notifications.sendOtp(
        user.email,
        code,
        OtpPurpose.ResetPassword,
      );
    }
    return { message: 'If that email exists, a code has been sent.' };
  }

  async verifyOtp(dto: VerifyOtpDto): Promise<{ valid: boolean }> {
    const user = await this.users.findByEmail(dto.email);
    if (!user) return { valid: false };
    const valid = await this.validateOtp(
      user.id,
      OtpPurpose.ResetPassword,
      dto.code,
      false,
    );
    return { valid };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const user = await this.users.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid code');
    }

    const valid = await this.validateOtp(
      user.id,
      OtpPurpose.ResetPassword,
      dto.code,
      true,
    );
    if (!valid) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.users.updatePassword(user.id, passwordHash);

    // Force re-login everywhere after a password change.
    await this.prisma.refreshToken.updateMany({
      where: { userId: user.id, revoked: false },
      data: { revoked: true },
    });

    return { message: 'Password updated. Please sign in again.' };
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private async issueTokens(user: User): Promise<Tokens> {
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
    });

    const secret = randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(secret, BCRYPT_ROUNDS);
    const days = Number(this.config.get('REFRESH_TTL_DAYS') ?? 30);
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const record = await this.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    return { accessToken, refreshToken: `${record.id}.${secret}` };
  }

  private async createOtp(userId: string, purpose: OtpPurpose): Promise<string> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeHash = await bcrypt.hash(code, BCRYPT_ROUNDS);
    const minutes = Number(this.config.get('OTP_TTL_MINUTES') ?? 10);
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000);

    // Invalidate any prior outstanding codes of the same purpose.
    await this.prisma.otpCode.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    await this.prisma.otpCode.create({
      data: { userId, purpose, codeHash, expiresAt },
    });
    return code;
  }

  private async validateOtp(
    userId: string,
    purpose: OtpPurpose,
    code: string,
    consume: boolean,
  ): Promise<boolean> {
    const record = await this.prisma.otpCode.findFirst({
      where: { userId, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!record || record.expiresAt.getTime() < Date.now()) {
      return false;
    }
    if (!(await bcrypt.compare(code, record.codeHash))) {
      return false;
    }

    if (consume) {
      await this.prisma.otpCode.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });
    }
    return true;
  }

  private toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      registeredName: user.registeredName,
      verified: user.verified,
    };
  }
}
