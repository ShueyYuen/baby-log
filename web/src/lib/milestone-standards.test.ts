import { describe, expect, it } from 'vitest';
import {
  evaluateMilestoneTiming,
  formatMonthRange,
  getMilestonesForAge,
  milestoneCategoryLabels,
  milestoneStandards,
} from './milestone-standards';

const sit = milestoneStandards.find((m) => m.type === 'sit_without_support')!;

describe('milestone catalog', () => {
  it('has unique types and required labels', () => {
    const types = milestoneStandards.map((m) => m.type);
    expect(new Set(types).size).toBe(types.length);
    expect(milestoneCategoryLabels.motor).toBe('大运动');
  });

  it('includes upcoming milestones within a 3-month lookahead', () => {
    const atBirth = getMilestonesForAge(0);
    expect(atBirth.some((m) => m.type === 'smile')).toBe(true);
    expect(atBirth.some((m) => m.type === 'walk')).toBe(false);

    const atOneYear = getMilestonesForAge(12);
    expect(atOneYear.some((m) => m.type === 'walk')).toBe(true);
  });
});

describe('evaluateMilestoneTiming', () => {
  it('classifies achieved ages against the reference window', () => {
    expect(evaluateMilestoneTiming(sit, 3, 6)).toBe('early');
    expect(evaluateMilestoneTiming(sit, 6, 8)).toBe('on_time');
    expect(evaluateMilestoneTiming(sit, 12, 12)).toBe('late');
  });

  it('classifies unachieved milestones by current age', () => {
    expect(evaluateMilestoneTiming(sit, null, 2)).toBe('upcoming');
    expect(evaluateMilestoneTiming(sit, null, 6)).toBe('not_yet');
    expect(evaluateMilestoneTiming(sit, null, 12)).toBe('late');
  });
});

describe('formatMonthRange', () => {
  it('renders days, whole months, and decimal months', () => {
    expect(formatMonthRange(0.5, 2)).toBe('15天 ~ 2月');
    expect(formatMonthRange(3, 7)).toBe('3月 ~ 7月');
    expect(formatMonthRange(3.8, 9.2)).toBe('3.8月 ~ 9.2月');
  });
});
