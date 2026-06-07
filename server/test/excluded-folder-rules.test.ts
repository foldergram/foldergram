import { describe, expect, it } from 'vitest';

import {
  getEffectiveExcludedFolderRules,
  matchesExcludedFolder,
  normalizeExcludedFolderRules,
  parseExcludedFolderRulesFromEnv,
  parseExcludedFolderRulesFromSetting,
  serializeExcludedFolderRulesForSetting
} from '../src/utils/excluded-folder-rules.js';

describe('excluded folder rules', () => {
  it('parses env rules with trimming, slash normalization, and dedupe', () => {
    expect(parseExcludedFolderRulesFromEnv(' @eaDir , Archive\\cache , thumbnails , @eaDir ')).toEqual([
      '@eaDir',
      'Archive/cache',
      'thumbnails'
    ]);
  });

  it('parses setting rules from textarea-style content', async () => {
    expect(parseExcludedFolderRulesFromSetting('@eaDir\r\n\n Archive/cache \nArchive\\cache\n')).toEqual([
      '@eaDir',
      'Archive/cache'
    ]);
  });

  it('serializes normalized rules back to newline-separated storage', async () => {
    expect(serializeExcludedFolderRulesForSetting([' Archive/cache ', '@eaDir', 'Archive\\cache'])).toBe(
      'Archive/cache\n@eaDir'
    );
  });

  it('matches bare folder names anywhere in the folder tree', async () => {
    expect(matchesExcludedFolder('Trips/@eaDir', ['@eaDir'])).toBe(true);
    expect(matchesExcludedFolder('Archive/2024/@eaDir', ['@eaDir'])).toBe(true);
    expect(matchesExcludedFolder('Archive/cache', ['@eaDir'])).toBe(false);
  });

  it('matches exact relative folder roots and their descendants', async () => {
    expect(matchesExcludedFolder('Archive/cache', ['Archive/cache'])).toBe(true);
    expect(matchesExcludedFolder('Archive/cache/nested', ['Archive/cache'])).toBe(true);
    expect(matchesExcludedFolder('Archive/cache-2', ['Archive/cache'])).toBe(false);
  });

  it('builds the effective rule union across env and saved custom sources', async () => {
    expect(
      getEffectiveExcludedFolderRules({
        envRules: ['@eaDir'],
        customRules: ['Archive/cache', '@eaDir']
      })
    ).toEqual(['@eaDir', 'Archive/cache']);
  });

  it('rejects invalid rules and unsupported wildcard syntax', async () => {
    expect(() => normalizeExcludedFolderRules(['.', '..', '../cache'])).toThrow();
    expect(() => normalizeExcludedFolderRules(['cache/*'])).toThrow();
    expect(() => normalizeExcludedFolderRules(['/'])).toThrow();
  });
});
