import { z } from 'zod';
import { appSettingsRepository } from '../db/repositories.js';

const SETTING_KEY = 'app.appearance';
export const appearanceSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']),
  accent: z.enum(['blue', 'purple', 'green', 'orange', 'rose'])
}).strict();
export type Appearance = z.infer<typeof appearanceSchema>;

export function getAppearance(): Appearance {
  try {
    const parsed = appearanceSchema.safeParse(JSON.parse(appSettingsRepository.get(SETTING_KEY) ?? 'null'));
    if (parsed.success) return parsed.data;
  } catch { /* Fall back to the original system appearance. */ }
  return { theme: 'system', accent: 'blue' };
}

export function saveAppearance(value: unknown): Appearance {
  const appearance = appearanceSchema.parse(value);
  appSettingsRepository.set(SETTING_KEY, JSON.stringify(appearance));
  return appearance;
}
