import { describe, expect, it } from 'vitest';
import { collectKeys } from './translate';
import { zh } from './locales/zh';
import { en } from './locales/en';
import { createTranslator } from './translate';

describe('i18n dictionaries', () => {
  it('keeps the same keys in zh and en', () => {
    expect(collectKeys(en).sort()).toEqual(collectKeys(zh).sort());
  });

  it('interpolates params and falls back to zh then the key', () => {
    const t = createTranslator('en');
    expect(t('age.yearsMonths', { years: 1, months: 2 })).toBe('1y 2mo');
    expect(t('missing.key')).toBe('missing.key');
    expect(createTranslator('zh')('nav.records')).toBe('记录');
  });
});
