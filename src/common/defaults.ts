/// Shared defaults that mirror the Flutter `AppSettingsController`.

export const SOUND_CLASSES = [
  'Car Horn',
  'Siren',
  'Dog Bark',
  'Speech',
  'Door Knock',
  'Name Call',
] as const;

export type SoundClass = (typeof SOUND_CLASSES)[number];

/** Every sound class enabled by default. */
export function defaultEnabledClassifications(): Record<string, boolean> {
  return Object.fromEntries(SOUND_CLASSES.map((c) => [c, true]));
}

export const THEME_MODES = ['system', 'light', 'dark'] as const;
export const HAPTIC_INTENSITIES = ['low', 'medium', 'high'] as const;

export const SETTINGS_DEFAULTS = {
  themeMode: 'system',
  hapticIntensity: 'medium',
  sensitivityThreshold: 0.6,
};

/** OTP purposes (stored as plain strings since SQLite has no enums). */
export const OtpPurpose = {
  VerifyEmail: 'VERIFY_EMAIL',
  ResetPassword: 'RESET_PASSWORD',
  Login: 'LOGIN',
} as const;
export type OtpPurpose = (typeof OtpPurpose)[keyof typeof OtpPurpose];
