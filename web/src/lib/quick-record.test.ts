import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  diaperLabel,
  invalidateRecordCaches,
  quickActionsForAge,
  quickBottle,
  quickBreastfeed,
  quickDiaper,
  startOngoing,
} from './quick-record';

const create = vi.fn();
vi.mock('./api', () => ({
  generateIdempotencyKey: () => 'idem-1',
  api: {
    recordsCrud: {
      create: (...args: unknown[]) => create(...args),
    },
  },
}));

vi.mock('./queryCache', () => ({
  cacheInvalidate: vi.fn(),
}));

describe('quick action helpers', () => {
  it('maps diaper kinds to labels', () => {
    expect(diaperLabel('wet')).toBe('尿');
    expect(diaperLabel('dirty')).toBe('便');
    expect(diaperLabel('both')).toBe('尿+便');
  });

  it('picks age-appropriate one-tap actions', () => {
    expect(quickActionsForAge(null)).toEqual(['wet', 'dirty', 'both', 'bottle', 'breastfeed']);
    expect(quickActionsForAge(2)).toContain('both');
    expect(quickActionsForAge(2)).not.toContain('solid');
    expect(quickActionsForAge(8)).toContain('solid');
    expect(quickActionsForAge(8)).toContain('water');
    expect(quickActionsForAge(8)).not.toContain('play');
    expect(quickActionsForAge(14)).toContain('play');
    expect(quickActionsForAge(14)).not.toContain('breastfeed');
  });
});

describe('quick record API wrappers', () => {
  beforeEach(() => {
    localStorage.clear();
    create.mockReset();
    create.mockResolvedValue({ data: { id: 'rec-1', type: 'diaper' } });
  });

  it('creates a diaper record and invalidates caches', async () => {
    const rec = await quickDiaper('baby-1', 'wet');
    expect(rec.id).toBe('rec-1');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        babyId: 'baby-1',
        category: 'nursing',
        type: 'diaper',
        data: { type: 'wet' },
      }),
      'idem-1',
    );
  });

  it('uses stored bottle defaults', async () => {
    localStorage.setItem(
      'recordDefaults',
      JSON.stringify({ bottle: { milkType: 'breast_milk', amountMl: 90 } }),
    );
    create.mockResolvedValue({ data: { id: 'b1', type: 'bottle' } });
    await quickBottle('baby-1');
    expect(create.mock.calls[0][0].data).toEqual({ milkType: 'breast_milk', amountMl: 90 });
  });

  it('uses stored breastfeed defaults', async () => {
    localStorage.setItem(
      'recordDefaults',
      JSON.stringify({ breastfeed: { leftMinutes: 8, rightMinutes: 12 } }),
    );
    await quickBreastfeed('baby-1');
    expect(create.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        category: 'feeding',
        type: 'breastfeed',
        data: { leftMinutes: 8, rightMinutes: 12 },
      }),
    );
  });

  it('starts ongoing sleep as activity and bath as nursing', async () => {
    await startOngoing('baby-1', 'sleep');
    await startOngoing('baby-1', 'bath');
    expect(create.mock.calls[0][0]).toEqual(
      expect.objectContaining({ category: 'activity', type: 'sleep', data: expect.objectContaining({ ongoing: true }) }),
    );
    expect(create.mock.calls[1][0]).toEqual(
      expect.objectContaining({ category: 'nursing', type: 'bath', data: expect.objectContaining({ ongoing: true }) }),
    );
  });
});

describe('invalidateRecordCaches', () => {
  it('drops timeline, stats, and records prefixes', async () => {
    const { cacheInvalidate } = await import('./queryCache');
    invalidateRecordCaches();
    expect(cacheInvalidate).toHaveBeenCalledWith('/timeline');
    expect(cacheInvalidate).toHaveBeenCalledWith('/stats');
    expect(cacheInvalidate).toHaveBeenCalledWith('/records');
  });
});
