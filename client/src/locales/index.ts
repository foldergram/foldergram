import { createI18n } from 'vue-i18n';

import en from './en.json';
import de from './de.json';
import es from './es.json';
import zh from './zh.json';

export const SUPPORTED_LOCALES = ['en', 'es', 'zh', 'de'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = 'en';

const messages: Record<SupportedLocale, typeof en> = {
  en,
  de,
  es,
  zh
};

export function resolveSupportedLocale(locale: string | null | undefined): SupportedLocale | null {
  if (!locale) {
    return null;
  }

  const normalizedLocale = locale.trim().replace(/_/g, '-').toLowerCase();
  if (!normalizedLocale) {
    return null;
  }

  if ((SUPPORTED_LOCALES as readonly string[]).includes(normalizedLocale)) {
    return normalizedLocale as SupportedLocale;
  }

  const [baseLocale] = normalizedLocale.split('-');
  if (baseLocale && (SUPPORTED_LOCALES as readonly string[]).includes(baseLocale)) {
    return baseLocale as SupportedLocale;
  }

  return null;
}

export function resolvePreferredLocale(...candidates: Array<string | null | undefined>): SupportedLocale {
  for (const candidate of candidates) {
    const locale = resolveSupportedLocale(candidate);
    if (locale) {
      return locale;
    }
  }

  return DEFAULT_LOCALE;
}

export function syncDocumentLanguage(locale: SupportedLocale) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
}

export function createFoldergramI18n(locale: SupportedLocale = DEFAULT_LOCALE) {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: DEFAULT_LOCALE,
    messages
  });
}

export const i18n = createFoldergramI18n();
