// WHO Motor Development Milestones — Windows of Achievement
// Source: WHO Multicentre Growth Reference Study (MGRS)
// Percentile bounds (P1–P99) define the normal range of achievement ages.
//
// Additional developmental milestones from CDC/AAP guidelines are included
// for a more comprehensive checklist.

export interface MilestoneStandard {
  type: string;
  label: string;
  category: 'motor' | 'social' | 'cognitive' | 'language';
  /** Earliest normal age in months (WHO P1 or CDC lower bound) */
  earliestMonth: number;
  /** Median age in months (WHO P50 or CDC typical) */
  medianMonth: number;
  /** Latest normal age in months (WHO P99 or CDC upper bound) */
  latestMonth: number;
  /** True if data comes from WHO MGRS study */
  whoSource: boolean;
  description: string;
}

export const milestoneStandards: MilestoneStandard[] = [
  // --- WHO MGRS 6 Gross Motor Milestones (P1, P50, P99) ---
  {
    type: 'head_up',
    label: '抬头',
    category: 'motor',
    earliestMonth: 1,
    medianMonth: 2,
    latestMonth: 4,
    whoSource: false,
    description: '俯卧时能短暂抬起头部',
  },
  {
    type: 'smile',
    label: '社交微笑',
    category: 'social',
    earliestMonth: 1,
    medianMonth: 2,
    latestMonth: 3,
    whoSource: false,
    description: '对人脸或声音做出有意识的微笑回应',
  },
  {
    type: 'roll_over',
    label: '翻身',
    category: 'motor',
    earliestMonth: 3,
    medianMonth: 4.5,
    latestMonth: 7,
    whoSource: false,
    description: '从俯卧翻到仰卧，或仰卧翻到俯卧',
  },
  {
    type: 'sit_without_support',
    label: '独坐',
    category: 'motor',
    earliestMonth: 3.8,
    medianMonth: 5.9,
    latestMonth: 9.2,
    whoSource: true,
    description: '无需支撑独立坐稳（WHO MGRS）',
  },
  {
    type: 'stand_with_assistance',
    label: '扶站',
    category: 'motor',
    earliestMonth: 4.8,
    medianMonth: 7.6,
    latestMonth: 11.4,
    whoSource: true,
    description: '扶着物体站立（WHO MGRS）',
  },
  {
    type: 'first_tooth',
    label: '长牙',
    category: 'motor',
    earliestMonth: 4,
    medianMonth: 6,
    latestMonth: 12,
    whoSource: false,
    description: '萌出第一颗乳牙',
  },
  {
    type: 'crawl',
    label: '爬行',
    category: 'motor',
    earliestMonth: 5.2,
    medianMonth: 8.5,
    latestMonth: 13.5,
    whoSource: true,
    description: '手膝着地爬行（WHO MGRS）',
  },
  {
    type: 'walk_with_assistance',
    label: '扶走',
    category: 'motor',
    earliestMonth: 5.9,
    medianMonth: 9.2,
    latestMonth: 13.7,
    whoSource: true,
    description: '扶着物体或牵手行走（WHO MGRS）',
  },
  {
    type: 'stand_alone',
    label: '独站',
    category: 'motor',
    earliestMonth: 6.9,
    medianMonth: 11.0,
    latestMonth: 16.9,
    whoSource: true,
    description: '不扶任何物体独立站立（WHO MGRS）',
  },
  {
    type: 'first_word',
    label: '说话',
    category: 'language',
    earliestMonth: 8,
    medianMonth: 12,
    latestMonth: 18,
    whoSource: false,
    description: '有意识地说出第一个词（如"妈妈""爸爸"）',
  },
  {
    type: 'walk',
    label: '独走',
    category: 'motor',
    earliestMonth: 8.2,
    medianMonth: 12.0,
    latestMonth: 17.6,
    whoSource: true,
    description: '不扶任何物体独立行走（WHO MGRS）',
  },
  {
    type: 'sleep_through',
    label: '睡整觉',
    category: 'social',
    earliestMonth: 3,
    medianMonth: 6,
    latestMonth: 12,
    whoSource: false,
    description: '连续睡眠 6 小时以上',
  },
];

export const milestoneCategoryLabels: Record<string, string> = {
  motor: '大运动',
  social: '社交/情感',
  cognitive: '认知',
  language: '语言',
};

export const milestoneCategoryColors: Record<string, string> = {
  motor: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  social: 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300',
  cognitive: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  language: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
};

/**
 * Returns milestones relevant for a baby of the given age in months.
 * Includes milestones whose window overlaps [0, ageMonths + 3]
 * so parents can see upcoming milestones too.
 */
export function getMilestonesForAge(ageMonths: number): MilestoneStandard[] {
  return milestoneStandards.filter(
    (m) => m.earliestMonth <= ageMonths + 3
  );
}

/**
 * Evaluate timing relative to WHO/reference window.
 * Returns 'early' | 'on_time' | 'late' | 'upcoming'.
 */
export function evaluateMilestoneTiming(
  standard: MilestoneStandard,
  achievedAgeMonths: number | null,
  currentAgeMonths: number
): 'early' | 'on_time' | 'late' | 'upcoming' | 'not_yet' {
  if (achievedAgeMonths !== null) {
    if (achievedAgeMonths < standard.earliestMonth) return 'early';
    if (achievedAgeMonths <= standard.latestMonth) return 'on_time';
    return 'late';
  }
  if (currentAgeMonths < standard.earliestMonth) return 'upcoming';
  if (currentAgeMonths <= standard.latestMonth) return 'not_yet';
  return 'late';
}

export function formatMonthRange(earliest: number, latest: number): string {
  const fmtMonth = (m: number) => {
    if (m < 1) return `${Math.round(m * 30)}天`;
    if (Number.isInteger(m)) return `${m}月`;
    return `${m.toFixed(1)}月`;
  };
  return `${fmtMonth(earliest)} ~ ${fmtMonth(latest)}`;
}
