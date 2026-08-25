import dayjs from 'dayjs';
import { tZh, type TranslateFn } from '../i18n';

/** Completed calendar months since birth, or null if unknown / unborn. */
export function babyAgeMonths(birthDate?: string | null): number | null {
  if (!birthDate) return null;
  const birth = dayjs(birthDate);
  if (!birth.isValid()) return null;
  const now = dayjs();
  if (now.isBefore(birth)) return null;
  return now.diff(birth, 'month');
}

export function formatBabyAge(birthDate?: string | null, t: TranslateFn = tZh): string {
  if (!birthDate) return '';
  const birth = dayjs(birthDate);
  if (!birth.isValid()) return '';
  const now = dayjs();
  if (now.isBefore(birth)) return t('baby.unborn');

  const years = now.diff(birth, 'year');
  const afterYears = birth.add(years, 'year');
  const months = now.diff(afterYears, 'month');
  const afterMonths = afterYears.add(months, 'month');
  const days = now.diff(afterMonths, 'day');

  if (years > 0) {
    if (months > 0) return t('age.yearsMonths', { years, months });
    return t('age.years', { n: years });
  }
  if (months > 0) {
    return days > 0 ? t('age.monthsDays', { months, days }) : t('age.months', { n: months });
  }
  return t('age.days', { n: Math.max(days, 0) });
}
