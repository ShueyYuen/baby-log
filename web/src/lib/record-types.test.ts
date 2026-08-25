import { describe, expect, it } from 'vitest';
import { allRecordTypes, formatElapsed, formatRecordDetail, twoPhaseTypes, typeConfig } from './record-types';
import type { TimelineRecord } from './api';

function rec(type: string, data: Record<string, unknown>, extra: Partial<TimelineRecord> = {}): TimelineRecord {
  return {
    id: '1',
    category: 'feeding',
    type,
    data,
    occurredAt: '2026-08-25T08:00:00.000Z',
    ...extra,
  };
}

describe('record type catalog', () => {
  it('covers feeding, nursing, and activity types in a fixed order', () => {
    const cats = new Set(allRecordTypes.map((t) => t.category));
    expect(cats).toEqual(new Set(['feeding', 'nursing', 'activity']));
    expect(allRecordTypes.map((t) => t.type)).toEqual([
      'breastfeed',
      'bottle',
      'pump',
      'solid',
      'water',
      'diaper',
      'bath',
      'supplement',
      'temperature',
      'sleep',
      'play',
      'other',
    ]);
    expect(typeConfig.bottle.label).toBe('瓶喂');
    expect(twoPhaseTypes).toEqual(['sleep', 'bath', 'play']);
  });
});

describe('formatRecordDetail', () => {
  it('formats feeding types', () => {
    expect(formatRecordDetail(rec('breastfeed', { leftMinutes: 8, rightMinutes: 12 }))).toBe(
      '左8分钟 / 右12分钟',
    );
    expect(formatRecordDetail(rec('bottle', { milkType: 'formula', amountMl: 120 }))).toBe('配方奶 120ml');
    expect(formatRecordDetail(rec('bottle', { milkType: 'breast_milk', amountMl: 80 }))).toBe('母乳 80ml');
    expect(
      formatRecordDetail(rec('pump', { amountMl: 60, side: 'both', durationMinutes: 15, storage: 'fridge' })),
    ).toBe('60ml · 双侧 · 15分钟 · 冷藏');
    expect(formatRecordDetail(rec('solid', { name: '米粉', amount: '30g' }))).toBe('米粉 (30g)');
    expect(formatRecordDetail(rec('water', { amountMl: 30 }))).toBe('30ml');
  });

  it('formats nursing types', () => {
    expect(formatRecordDetail(rec('diaper', { type: 'wet' }))).toBe('尿');
    expect(formatRecordDetail(rec('diaper', { type: 'dirty' }))).toBe('便');
    expect(formatRecordDetail(rec('diaper', { type: 'both' }))).toBe('尿+便');
    expect(formatRecordDetail(rec('supplement', { name: '维生素D' }))).toBe('维生素D');
    expect(formatRecordDetail(rec('temperature', { value: 37.2, location: 'axillary' }))).toBe(
      '37.2°C (腋下)',
    );
  });

  it('formats sleep with duration, ongoing, and cross-day windows', () => {
    expect(formatRecordDetail(rec('sleep', { ongoing: true }))).toBe('进行中');
    expect(formatRecordDetail(rec('sleep', { durationMinutes: 40 }))).toBe('40分钟');
    expect(
      formatRecordDetail(
        rec('sleep', {
          startTime: '2026-08-25T22:00:00.000Z',
          endTime: '2026-08-26T06:30:00.000Z',
          durationMinutes: 510,
        }),
      ),
    ).toMatch(/8h30m/);
  });

  it('formats remaining pump, sleep, bath, and temperature variants', () => {
    expect(
      formatRecordDetail(rec('pump', { amountMl: 40, side: 'left', durationMinutes: 8, storage: 'freezer' })),
    ).toContain('冷冻');
    expect(
      formatRecordDetail(rec('pump', { amountMl: 40, side: 'right', durationMinutes: 8, storage: 'direct_feed' })),
    ).toContain('直接喂');
    expect(formatRecordDetail(rec('solid', { name: '香蕉' }))).toBe('香蕉');
    expect(formatRecordDetail(rec('temperature', { value: 38, location: 'ear' }))).toBe('38°C (耳温)');
    expect(formatRecordDetail(rec('bath', { ongoing: true }))).toBe('进行中');
    expect(formatRecordDetail(rec('play', {}))).toBe('');
    expect(
      formatRecordDetail(
        rec('sleep', {
          startTime: '2026-08-25T10:00:00.000Z',
          endTime: '2026-08-25T10:20:00.000Z',
        }),
      ),
    ).toMatch(/20m/);
  });
});

describe('formatElapsed', () => {
  it('formats mm:ss and hh:mm:ss', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(5000)).toBe('0:05');
    expect(formatElapsed(65_000)).toBe('1:05');
    expect(formatElapsed(3_661_000)).toBe('1:01:01');
    expect(formatElapsed(-100)).toBe('0:00');
  });
});
