import { describe, expect, it } from 'vitest';

import en from './en.json';
import { DEFAULT_LOCALE, resolvePreferredLocale, resolveSupportedLocale } from './index';

type LocaleTree = Record<string, LocaleTree | string>;

const localeModules = import.meta.glob('./*.json', {
  eager: true,
  import: 'default'
}) as Record<string, LocaleTree>;

function collectLeafPaths(tree: LocaleTree, prefix = ''): string[] {
  const paths: string[] = [];

  for (const [key, value] of Object.entries(tree)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      paths.push(nextPrefix);
      continue;
    }

    paths.push(...collectLeafPaths(value, nextPrefix));
  }

  return paths;
}

describe('locale validation', () => {
  it('treats English as the canonical locale tree', () => {
    const englishPaths = collectLeafPaths(en as LocaleTree);

    expect(englishPaths.length).toBeGreaterThan(0);

    for (const [modulePath, localeMessages] of Object.entries(localeModules)) {
      if (modulePath.endsWith('/en.json')) {
        continue;
      }

      expect(collectLeafPaths(localeMessages)).toEqual(englishPaths);
    }
  });

  it('normalizes supported locales and falls back to English', () => {
    expect(resolveSupportedLocale('en')).toBe('en');
    expect(resolveSupportedLocale('en-US')).toBe('en');
    expect(resolveSupportedLocale('es')).toBe('es');
    expect(resolveSupportedLocale('es-MX')).toBe('es');
    expect(resolveSupportedLocale('zh')).toBe('zh');
    expect(resolveSupportedLocale('zh-CN')).toBe('zh');
    expect(resolveSupportedLocale('de')).toBe('de');
    expect(resolveSupportedLocale('de-AT')).toBe('de');
    expect(resolveSupportedLocale('EN_gb')).toBe('en');
    expect(resolveSupportedLocale('fr')).toBeNull();
    expect(resolvePreferredLocale('fr-FR', 'es-MX')).toBe('es');
    expect(resolvePreferredLocale('fr-FR', 'zh-CN')).toBe('zh');
    expect(resolvePreferredLocale('fr-FR')).toBe(DEFAULT_LOCALE);
  });
});
