import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { babyAgeMonths, formatBabyAge } from './baby-age';

describe('babyAgeMonths', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T12:00:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null for missing or invalid dates', () => {
    expect(babyAgeMonths()).toBeNull();
    expect(babyAgeMonths(null)).toBeNull();
    expect(babyAgeMonths('not-a-date')).toBeNull();
  });

  it('returns null if the baby is unborn', () => {
    expect(babyAgeMonths('2026-09-01')).toBeNull();
  });

  it('returns completed calendar months since birth', () => {
    expect(babyAgeMonths('2026-08-25')).toBe(0);
    expect(babyAgeMonths('2026-02-25')).toBe(6);
    expect(babyAgeMonths('2025-08-25')).toBe(12);
  });
});

describe('formatBabyAge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T12:00:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty string for missing or invalid dates', () => {
    expect(formatBabyAge()).toBe('');
    expect(formatBabyAge(null)).toBe('');
    expect(formatBabyAge('nope')).toBe('');
  });

  it('returns 未出生 for future birth dates', () => {
    expect(formatBabyAge('2026-12-01')).toBe('未出生');
  });

  it('formats days, months, and years', () => {
    expect(formatBabyAge('2026-08-25')).toBe('0天');
    expect(formatBabyAge('2026-08-20')).toBe('5天');
    expect(formatBabyAge('2026-06-25')).toBe('2个月');
    expect(formatBabyAge('2025-08-25')).toBe('1岁');
    expect(formatBabyAge('2024-06-25')).toMatch(/岁/);
  });
});
