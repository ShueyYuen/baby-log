import dayjs from 'dayjs';

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

export function evaluatePee(count: number, ageDays: number): DiaperMetricResult {
  const range = getDiaperRange(ageDays);
  const status = evaluate(count, range.peeMin, range.peeMax);
  const firstWeekNote = ageDays <= 6 ? '（新生儿第一周小便次数应随天数递增）' : '';
  let advice: string;
  if (status === 'low') {
    advice = `小便次数偏少（参考约 ${range.peeMin}-${range.peeMax} 次/天）${firstWeekNote}。可能提示奶量或水分摄入不足，请注意增加喂养；若同时出现尿量少、尿色深黄、精神差、口唇干燥，需警惕脱水并及时就医。`;
  } else if (status === 'high') {
    advice = `小便次数偏多（参考约 ${range.peeMin}-${range.peeMax} 次/天）。多数情况与喝水/喂养较多有关；若伴随发热、哭闹、尿液异味，建议咨询医生。`;
  } else {
    advice = `小便次数正常（约 ${range.peeMin}-${range.peeMax} 次/天），说明摄入充足。`;
  }
  return { count, status, range: { min: range.peeMin, max: range.peeMax }, advice };
}

export function evaluatePoop(count: number, ageDays: number): DiaperMetricResult {
  const range = getDiaperRange(ageDays);
  const months = ageDays / 30.44;
  const status = evaluate(count, range.poopMin, range.poopMax);
  let advice: string;
  if (status === 'low') {
    if (ageDays <= 2) {
      advice = `大便次数偏少（参考约 ${range.poopMin}-${range.poopMax} 次/天）。出生头两天以胎便为主，若 24 小时内仍未排胎便需及时告知医生。`;
    } else if (months < 6) {
      advice = `大便次数偏少（参考约 ${range.poopMin}-${range.poopMax} 次/天）。纯母乳宝宝数天一次且大便性状软、精神好属正常“攒肚”；若大便干硬、排便费力或伴腹胀哭闹，需警惕便秘。`;
    } else {
      advice = `大便次数偏少（参考约 ${range.poopMin}-${range.poopMax} 次/天）。可留意是否大便干硬、排便困难；可适当增加水分、蔬果泥等膳食纤维，必要时咨询医生。`;
    }
  } else if (status === 'high') {
    advice = `大便次数偏多（参考约 ${range.poopMin}-${range.poopMax} 次/天）。若大便性状正常、精神好通常无需担心；若为稀水样、含黏液/血丝或伴发热呕吐，需警惕腹泻并及时就医、注意补液。`;
  } else {
    advice = `大便次数正常（参考约 ${range.poopMin}-${range.poopMax} 次/天）。`;
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

export function evaluateFeeding(count: number, ageDays: number): DiaperMetricResult {
  const range = getFeedingRange(ageDays);
  const status = evaluate(count, range.min, range.max);
  let advice: string;
  if (status === 'low') {
    advice = `喂养次数偏少（参考约 ${range.min}-${range.max} 次/天）。请留意宝宝是否有饥饿信号，必要时增加喂养频次；若伴随体重增长缓慢、小便偏少，建议咨询医生。`;
  } else if (status === 'high') {
    advice = `喂养次数偏多（参考约 ${range.min}-${range.max} 次/天）。若宝宝生长良好通常无需担心；若为频繁少量、易吐奶或哭闹，可评估是否为安抚性吸吮或喂养不足。`;
  } else {
    advice = `喂养次数正常（参考约 ${range.min}-${range.max} 次/天）。`;
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

export function evaluateSleep(hours: number, ageDays: number): DiaperMetricResult {
  const range = getSleepRange(ageDays);
  const status = evaluate(hours, range.min, range.max);
  let advice: string;
  if (status === 'low') {
    advice = `睡眠时长偏少（推荐约 ${range.min}-${range.max} 小时/天）。可留意睡眠环境与作息规律，避免过度疲劳；长期睡眠不足可能影响生长发育。（注意：仅统计已记录的睡眠，漏记会偏低）`;
  } else if (status === 'high') {
    advice = `睡眠时长偏多（推荐约 ${range.min}-${range.max} 小时/天）。多数情况正常；若宝宝异常嗜睡、难以唤醒或伴精神差，需及时就医。`;
  } else {
    advice = `睡眠时长正常（推荐约 ${range.min}-${range.max} 小时/天）。`;
  }
  return { count: hours, status, range, advice };
}
