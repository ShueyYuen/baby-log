import dayjs from 'dayjs';

/** Completed calendar months since birth, or null if unknown / unborn. */
export function babyAgeMonths(birthDate?: string | null): number | null {
  if (!birthDate) return null;
  const birth = dayjs(birthDate);
  if (!birth.isValid()) return null;
  const now = dayjs();
  if (now.isBefore(birth)) return null;
  return now.diff(birth, 'month');
}

export function formatBabyAge(birthDate?: string | null): string {
  if (!birthDate) return '';
  const birth = dayjs(birthDate);
  if (!birth.isValid()) return '';
  const now = dayjs();
  if (now.isBefore(birth)) return '未出生';

  const years = now.diff(birth, 'year');
  const afterYears = birth.add(years, 'year');
  const months = now.diff(afterYears, 'month');
  const afterMonths = afterYears.add(months, 'month');
  const days = now.diff(afterMonths, 'day');

  if (years > 0) {
    if (months > 0) return `${years}岁${months}个月`;
    return `${years}岁`;
  }
  if (months > 0) {
    return days > 0 ? `${months}个月${days}天` : `${months}个月`;
  }
  return `${Math.max(days, 0)}天`;
}
