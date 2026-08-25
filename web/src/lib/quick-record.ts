import { generateIdempotencyKey, api, type TimelineRecord } from './api';
import { getRecordDefaults, getRecentNames, patchRecordDefaults, rememberName } from './record-defaults';
import { cacheInvalidate } from './queryCache';
import { tZh, type TranslateFn } from '../i18n';

export type DiaperKind = 'wet' | 'dirty' | 'both';

export function invalidateRecordCaches() {
  cacheInvalidate('/timeline');
  cacheInvalidate('/stats');
  cacheInvalidate('/records');
}

export async function createQuickRecord(input: {
  babyId: string;
  category: string;
  type: string;
  data: Record<string, unknown>;
}): Promise<TimelineRecord> {
  const res = await api.recordsCrud.create(
    {
      babyId: input.babyId,
      category: input.category,
      type: input.type,
      data: input.data,
      occurredAt: new Date().toISOString(),
    },
    generateIdempotencyKey(),
  );
  invalidateRecordCaches();
  return res.data;
}

export async function quickDiaper(babyId: string, kind: DiaperKind) {
  return createQuickRecord({
    babyId,
    category: 'nursing',
    type: 'diaper',
    data: { type: kind },
  });
}

export async function quickBottle(babyId: string) {
  const d = getRecordDefaults().bottle;
  const milkType = d?.milkType || 'formula';
  const amountMl = d?.amountMl ?? 120;
  const rec = await createQuickRecord({
    babyId,
    category: 'feeding',
    type: 'bottle',
    data: { milkType, amountMl },
  });
  patchRecordDefaults({ bottle: { milkType, amountMl } });
  return rec;
}

export async function quickBreastfeed(babyId: string) {
  const d = getRecordDefaults().breastfeed;
  const leftMinutes = d?.leftMinutes ?? 10;
  const rightMinutes = d?.rightMinutes ?? 10;
  const rec = await createQuickRecord({
    babyId,
    category: 'feeding',
    type: 'breastfeed',
    data: { leftMinutes, rightMinutes },
  });
  patchRecordDefaults({ breastfeed: { leftMinutes, rightMinutes } });
  return rec;
}

export async function quickSolid(babyId: string, defaultName?: string) {
  const name = getRecentNames('solid')[0] || defaultName || tZh('quick.defaultSolid');
  const rec = await createQuickRecord({
    babyId,
    category: 'feeding',
    type: 'solid',
    data: { name },
  });
  rememberName('solid', name);
  return rec;
}

export async function quickWater(babyId: string) {
  const amountMl = getRecordDefaults().water?.amountMl ?? 30;
  const rec = await createQuickRecord({
    babyId,
    category: 'feeding',
    type: 'water',
    data: { amountMl },
  });
  patchRecordDefaults({ water: { amountMl } });
  return rec;
}

export async function startOngoing(babyId: string, type: 'sleep' | 'bath' | 'play') {
  const category = type === 'sleep' || type === 'play' ? 'activity' : 'nursing';
  const nowIso = new Date().toISOString();
  const rec = await createQuickRecord({
    babyId,
    category,
    type,
    data: { ongoing: true, startTime: nowIso },
  });
  return rec;
}

export function diaperLabel(kind: DiaperKind, t: TranslateFn = tZh) {
  return kind === 'wet' ? t('diaper.wet') : kind === 'dirty' ? t('diaper.dirty') : t('diaper.both');
}

/** One-tap actions that match typical needs at this completed-month age. */
export type QuickActionId =
  | 'wet'
  | 'dirty'
  | 'both'
  | 'bottle'
  | 'breastfeed'
  | 'water'
  | 'solid'
  | 'play';

export function quickActionsForAge(months: number | null): QuickActionId[] {
  const m = months ?? 0;
  const actions: QuickActionId[] = ['wet', 'dirty'];
  if (m < 6) actions.push('both');
  actions.push('bottle');
  if (m < 12) actions.push('breastfeed');
  if (m >= 6) {
    actions.push('solid');
    actions.push('water');
  }
  if (m >= 12) actions.push('play');
  return actions;
}
