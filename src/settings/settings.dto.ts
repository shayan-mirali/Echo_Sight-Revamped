import {
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { HAPTIC_INTENSITIES, THEME_MODES } from '../common/defaults';

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  registeredName?: string;

  @IsOptional()
  @IsIn(THEME_MODES as unknown as string[])
  themeMode?: string;

  @IsOptional()
  @IsIn(HAPTIC_INTENSITIES as unknown as string[])
  hapticIntensity?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  sensitivityThreshold?: number;

  // Partial map of { "<sound class>": boolean }. Merged onto existing values.
  @IsOptional()
  @IsObject()
  enabledClassifications?: Record<string, boolean>;
}

export interface SettingsResponse {
  registeredName: string;
  themeMode: string;
  hapticIntensity: string;
  sensitivityThreshold: number;
  enabledClassifications: Record<string, boolean>;
}
