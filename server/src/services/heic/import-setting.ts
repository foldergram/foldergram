import { appConfig } from '../../config/env.js';
import { HEIC_IMPORT_ENABLED_SETTING_KEY } from '../../constants/app-setting-keys.js';
import { appSettingsRepository } from '../../db/repositories.js';

export function getHeicImportSetting() {
  const override = appConfig.heicEnabledOverride;
  return {
    enabled: override ?? (appSettingsRepository.get(HEIC_IMPORT_ENABLED_SETTING_KEY) === '1'),
    managedByEnvironment: override !== undefined
  };
}
