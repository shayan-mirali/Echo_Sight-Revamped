import { Injectable, NotFoundException } from '@nestjs/common';

import {
  defaultEnabledClassifications,
  SETTINGS_DEFAULTS,
  SOUND_CLASSES,
} from '../common/defaults';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsResponse, UpdateSettingsDto } from './settings.dto';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<SettingsResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { settings: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const settings = user.settings;
    return {
      registeredName: user.registeredName,
      themeMode: settings?.themeMode ?? SETTINGS_DEFAULTS.themeMode,
      hapticIntensity:
        settings?.hapticIntensity ?? SETTINGS_DEFAULTS.hapticIntensity,
      sensitivityThreshold:
        settings?.sensitivityThreshold ??
        SETTINGS_DEFAULTS.sensitivityThreshold,
      enabledClassifications: this.parseClassifications(
        settings?.enabledClassifications,
      ),
    };
  }

  async update(
    userId: string,
    dto: UpdateSettingsDto,
  ): Promise<SettingsResponse> {
    if (dto.registeredName !== undefined) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { registeredName: dto.registeredName.trim() },
      });
    }

    const data: Record<string, unknown> = {};
    if (dto.themeMode !== undefined) data.themeMode = dto.themeMode;
    if (dto.hapticIntensity !== undefined) {
      data.hapticIntensity = dto.hapticIntensity;
    }
    if (dto.sensitivityThreshold !== undefined) {
      data.sensitivityThreshold = dto.sensitivityThreshold;
    }

    if (dto.enabledClassifications !== undefined) {
      const current = await this.prisma.userSettings.findUnique({
        where: { userId },
      });
      const merged = {
        ...this.parseClassifications(current?.enabledClassifications),
        ...this.sanitizeClassifications(dto.enabledClassifications),
      };
      data.enabledClassifications = JSON.stringify(merged);
    }

    // Upsert so a missing settings row can never break a sync.
    await this.prisma.userSettings.upsert({
      where: { userId },
      update: data,
      create: {
        userId,
        enabledClassifications: JSON.stringify(defaultEnabledClassifications()),
        ...data,
      },
    });

    return this.get(userId);
  }

  private parseClassifications(raw?: string | null): Record<string, boolean> {
    if (!raw) return defaultEnabledClassifications();
    try {
      const parsed = JSON.parse(raw);
      return this.sanitizeClassifications(parsed);
    } catch {
      return defaultEnabledClassifications();
    }
  }

  /** Keep only known sound classes with boolean values. */
  private sanitizeClassifications(input: unknown): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    if (input && typeof input === 'object') {
      for (const key of SOUND_CLASSES) {
        const value = (input as Record<string, unknown>)[key];
        if (typeof value === 'boolean') out[key] = value;
      }
    }
    return out;
  }
}
