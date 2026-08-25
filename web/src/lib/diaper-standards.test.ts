import { describe, expect, it } from 'vitest';
import {
  evaluateFeeding,
  evaluatePee,
  evaluatePoop,
  evaluateSleep,
  getAgeDays,
  getDiaperRange,
  getFeedingRange,
  getMonthAge,
  getSleepRange,
} from './diaper-standards';

describe('age helpers', () => {
  it('computes day and month age from a reference date', () => {
    expect(getAgeDays()).toBe(0);
    expect(getAgeDays('2026-08-20', '2026-08-25')).toBe(5);
    expect(getAgeDays('2026-09-01', '2026-08-25')).toBe(0);
    expect(getMonthAge('2026-02-25', '2026-08-25')).toBeCloseTo(181 / 30.44, 5);
  });
});

describe('diaper ranges', () => {
  it('tightens pee counts through the first week then stabilizes', () => {
    expect(getDiaperRange(0)).toMatchObject({ peeMin: 1, poopMin: 1 });
    expect(getDiaperRange(2).poopMax).toBe(4);
    expect(getDiaperRange(6).peeMin).toBeGreaterThanOrEqual(5);
    expect(getDiaperRange(20)).toEqual({ peeMin: 6, peeMax: 10, poopMin: 3, poopMax: 8 });
    expect(getDiaperRange(90)).toEqual({ peeMin: 5, peeMax: 8, poopMin: 1, poopMax: 6 });
    expect(getDiaperRange(240)).toEqual({ peeMin: 4, peeMax: 8, poopMin: 1, poopMax: 3 });
  });
});

describe('evaluatePee / evaluatePoop', () => {
  it('classifies low, normal, and high pee counts', () => {
    expect(evaluatePee(0, 20).status).toBe('low');
    expect(evaluatePee(7, 20).status).toBe('normal');
    expect(evaluatePee(20, 20).status).toBe('high');
    expect(evaluatePee(0, 3).advice).toContain('第一周');
  });

  it('uses newborn-specific poop advice in the first days', () => {
    const early = evaluatePoop(0, 1);
    expect(early.status).toBe('low');
    expect(early.advice).toContain('胎便');
    expect(evaluatePoop(10, 20).status).toBe('high');
    expect(evaluatePoop(4, 20).status).toBe('normal');
  });
});

describe('feeding and sleep ranges', () => {
  it('narrows feeding frequency as the baby grows', () => {
    expect(getFeedingRange(0)).toEqual({ min: 6, max: 12 });
    expect(getFeedingRange(10)).toEqual({ min: 8, max: 12 });
    expect(getFeedingRange(60)).toEqual({ min: 6, max: 10 });
    expect(getFeedingRange(150)).toEqual({ min: 5, max: 8 });
    expect(getFeedingRange(270)).toEqual({ min: 4, max: 7 });
    expect(getFeedingRange(400)).toEqual({ min: 3, max: 6 });
    expect(evaluateFeeding(2, 10).status).toBe('low');
    expect(evaluateFeeding(10, 10).status).toBe('normal');
  });

  it('evaluates sleep hours against age bands', () => {
    expect(getSleepRange(30)).toEqual({ min: 14, max: 17 });
    expect(getSleepRange(200)).toEqual({ min: 12, max: 16 });
    expect(getSleepRange(500)).toEqual({ min: 11, max: 14 });
    expect(getSleepRange(800)).toEqual({ min: 10, max: 13 });
    expect(evaluateSleep(8, 30).status).toBe('low');
    expect(evaluateSleep(15, 30).status).toBe('normal');
    expect(evaluateSleep(20, 30).status).toBe('high');
  });
});
