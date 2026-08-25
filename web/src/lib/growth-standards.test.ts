import { describe, expect, it } from 'vitest';
import { getPercentileData, heightBoys, heightGirls, weightBoys, weightGirls } from './growth-standards';

describe('WHO growth standards', () => {
  it('covers 0-24 months for each table', () => {
    for (const table of [weightBoys, weightGirls, heightBoys, heightGirls]) {
      expect(table).toHaveLength(25);
      expect(table[0].month).toBe(0);
      expect(table[24].month).toBe(24);
      for (const row of table) {
        expect(row.p3).toBeLessThan(row.p15);
        expect(row.p15).toBeLessThan(row.p50);
        expect(row.p50).toBeLessThan(row.p85);
        expect(row.p85).toBeLessThan(row.p97);
      }
    }
  });

  it('selects tables by gender and metric', () => {
    expect(getPercentileData('male', 'weight')).toBe(weightBoys);
    expect(getPercentileData('female', 'weight')).toBe(weightGirls);
    expect(getPercentileData('male', 'height')).toBe(heightBoys);
    expect(getPercentileData('female', 'height')).toBe(heightGirls);
  });
});
