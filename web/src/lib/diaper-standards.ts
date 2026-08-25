import dayjs from 'dayjs';
import { tZh, type TranslateFn } from '../i18n';

export type DiaperStatus = 'low' | 'normal' | 'high';

export interface DiaperMetricResult {
  count: number;
  status: DiaperStatus;
  range: { min: number; max: number };
  advice: string;
}

export interface DiaperRange {
  peeMin: number;
  peeMax: number;
  poopMin: number;
  poopMax: number;
}

// 天龄（出生天数），第一周等新生儿早期评估依赖它
export function getAgeDays(birthDate?: string, at?: string): number {
  if (!birthDate) return 0;
  const ref = at ? dayjs(at) : dayjs();
  return Math.max(0, ref.diff(dayjs(birthDate), 'day'));
}

// 月龄（可含小数），部分区间按月龄划分
export function getMonthAge(birthDate?: string, at?: string): number {
  return getAgeDays(birthDate, at) / 30.44;
}

// 参考区间（每天次数）。婴儿排便个体差异较大，仅供参考，异常需结合精神状态、性状综合判断。
// 以天龄为准：新生儿第一周小便次数约等于出生天数并逐日递增，之后趋于稳定。
export function getDiaperRange(ageDays: number): DiaperRange {
  const months = ageDays / 30.44;

  // 出生第一周（0-6天）：逐日细化
  if (ageDays <= 6) {
    // 小便：约“第几天”次，第6天起达到6次；给出 ±1 的容差
    const peeExpected = Math.max(1, ageDays);
    const peeMin = Math.max(1, peeExpected - 1);
    const peeMax = Math.max(peeExpected + 1, ageDays >= 5 ? 8 : peeExpected + 1);
    // 大便：前2天为胎便（1-2次），第3天起过渡便增多
    const poopMin = ageDays <= 2 ? 1 : 3;
    const poopMax = ageDays <= 2 ? 4 : 8;
    return { peeMin, peeMax, poopMin, poopMax };
  }

  if (months < 1) {
    // 满一周后至满月：小便≥6次提示奶量充足；母乳宝宝大便次数偏多
    return { peeMin: 6, peeMax: 10, poopMin: 3, poopMax: 8 };
  }
  if (months < 6) {
    // 纯母乳宝宝大便次数波动大，可能数天一次，因此下限放宽
    return { peeMin: 5, peeMax: 8, poopMin: 1, poopMax: 6 };
  }
  return { peeMin: 4, peeMax: 8, poopMin: 1, poopMax: 3 };
}

function evaluate(count: number, min: number, max: number): DiaperStatus {
  if (count < min) return 'low';
  if (count > max) return 'high';
  return 'normal';
}

export function evaluatePee(count: number, ageDays: number, t: TranslateFn = tZh): DiaperMetricResult {
  const range = getDiaperRange(ageDays);
  const status = evaluate(count, range.peeMin, range.peeMax);
  const firstWeekNote = ageDays <= 6 ? t('advice.firstWeekNote') : '';
  let advice: string;
  if (status === 'low') {
    advice = t('advice.peeLow', { min: range.peeMin, max: range.peeMax, note: firstWeekNote });
  } else if (status === 'high') {
    advice = t('advice.peeHigh', { min: range.peeMin, max: range.peeMax });
  } else {
    advice = t('advice.peeNormal', { min: range.peeMin, max: range.peeMax });
  }
  return { count, status, range: { min: range.peeMin, max: range.peeMax }, advice };
}

export function evaluatePoop(count: number, ageDays: number, t: TranslateFn = tZh): DiaperMetricResult {
  const range = getDiaperRange(ageDays);
  const months = ageDays / 30.44;
  const status = evaluate(count, range.poopMin, range.poopMax);
  let advice: string;
  if (status === 'low') {
    if (ageDays <= 2) {
      advice = t('advice.poopLowNewborn', { min: range.poopMin, max: range.poopMax });
    } else if (months < 6) {
      advice = t('advice.poopLowYoung', { min: range.poopMin, max: range.poopMax });
    } else {
      advice = t('advice.poopLowOlder', { min: range.poopMin, max: range.poopMax });
    }
  } else if (status === 'high') {
    advice = t('advice.poopHigh', { min: range.poopMin, max: range.poopMax });
  } else {
    advice = t('advice.poopNormal', { min: range.poopMin, max: range.poopMax });
  }
  return { count, status, range: { min: range.poopMin, max: range.poopMax }, advice };
}

// ---- 喂养次数（次/天）----
// 统计口径为“喂养”分类记录数（含母乳、瓶喂、辅食、喝水），个体差异大，仅供参考。
export function getFeedingRange(ageDays: number): { min: number; max: number } {
  const months = ageDays / 30.44;
  if (ageDays <= 1) return { min: 6, max: 12 }; // 出生当天/次日喂养逐步建立，下限放宽
  if (months < 1) return { min: 8, max: 12 };
  if (months < 3) return { min: 6, max: 10 };
  if (months < 6) return { min: 5, max: 8 };
  if (months < 12) return { min: 4, max: 7 };
  return { min: 3, max: 6 };
}

export function evaluateFeeding(count: number, ageDays: number, t: TranslateFn = tZh): DiaperMetricResult {
  const range = getFeedingRange(ageDays);
  const status = evaluate(count, range.min, range.max);
  let advice: string;
  if (status === 'low') {
    advice = t('advice.feedingLow', { min: range.min, max: range.max });
  } else if (status === 'high') {
    advice = t('advice.feedingHigh', { min: range.min, max: range.max });
  } else {
    advice = t('advice.feedingNormal', { min: range.min, max: range.max });
  }
  return { count, status, range, advice };
}

// ---- 睡眠时长（小时/天，含小睡）----
// 参考美国睡眠基金会推荐，仅供参考。
export function getSleepRange(ageDays: number): { min: number; max: number } {
  const months = ageDays / 30.44;
  if (months < 3) return { min: 14, max: 17 };
  if (months < 12) return { min: 12, max: 16 };
  if (months < 24) return { min: 11, max: 14 };
  return { min: 10, max: 13 };
}

export function evaluateSleep(hours: number, ageDays: number, t: TranslateFn = tZh): DiaperMetricResult {
  const range = getSleepRange(ageDays);
  const status = evaluate(hours, range.min, range.max);
  let advice: string;
  if (status === 'low') {
    advice = t('advice.sleepLow', { min: range.min, max: range.max });
  } else if (status === 'high') {
    advice = t('advice.sleepHigh', { min: range.min, max: range.max });
  } else {
    advice = t('advice.sleepNormal', { min: range.min, max: range.max });
  }
  return { count: hours, status, range, advice };
}
