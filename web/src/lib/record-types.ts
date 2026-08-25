import dayjs from 'dayjs';
import type { LucideIcon } from 'lucide-react';
import { tZh, type TranslateFn } from '../i18n';
import {
  Apple,
  Baby,
  Bath,
  Beaker,
  Droplets,
  Gamepad2,
  GlassWater,
  Heart,
  Milk,
  Moon,
  Pill,
  Thermometer,
} from 'lucide-react';
import type { TimelineRecord } from './api';

export interface RecordTypeMeta {
  type: string;
  category: string;
  label: string;
  icon: LucideIcon;
  color: string;
  accent: string;
}

export const allRecordTypes: RecordTypeMeta[] = [
  { type: 'breastfeed', category: 'feeding', label: '母乳', icon: Heart, color: 'text-pink-500', accent: 'border-l-pink-400' },
  { type: 'bottle', category: 'feeding', label: '瓶喂', icon: Milk, color: 'text-blue-500', accent: 'border-l-blue-400' },
  { type: 'pump', category: 'feeding', label: '吸奶', icon: Beaker, color: 'text-rose-500', accent: 'border-l-rose-400' },
  { type: 'solid', category: 'feeding', label: '辅食', icon: Apple, color: 'text-green-500', accent: 'border-l-green-400' },
  { type: 'water', category: 'feeding', label: '喝水', icon: GlassWater, color: 'text-cyan-500', accent: 'border-l-cyan-400' },
  { type: 'diaper', category: 'nursing', label: '换尿布', icon: Droplets, color: 'text-yellow-600', accent: 'border-l-yellow-400' },
  { type: 'bath', category: 'nursing', label: '洗澡', icon: Bath, color: 'text-teal-500', accent: 'border-l-teal-400' },
  { type: 'supplement', category: 'nursing', label: '营养补充', icon: Pill, color: 'text-purple-500', accent: 'border-l-purple-400' },
  { type: 'temperature', category: 'nursing', label: '体温', icon: Thermometer, color: 'text-red-500', accent: 'border-l-red-400' },
  { type: 'sleep', category: 'activity', label: '睡眠', icon: Moon, color: 'text-indigo-500', accent: 'border-l-indigo-400' },
  { type: 'play', category: 'activity', label: '玩耍', icon: Gamepad2, color: 'text-orange-500', accent: 'border-l-orange-400' },
  { type: 'other', category: 'activity', label: '其他', icon: Baby, color: 'text-gray-500', accent: 'border-l-gray-400' },
];

export const typeConfig: Record<string, RecordTypeMeta> = Object.fromEntries(
  allRecordTypes.map((t) => [t.type, t]),
);

export const twoPhaseTypes = ['sleep', 'bath', 'play'];

export function recordTypeLabel(type: string, t: TranslateFn = tZh): string {
  const key = `recordTypes.${type}`;
  const label = t(key);
  return label === key ? typeConfig[type]?.label || t('recordTypes.activityFallback') : label;
}

export function formatRecordDetail(record: TimelineRecord, t: TranslateFn = tZh): string {
  const { type, data } = record;
  switch (type) {
    case 'breastfeed':
      return t('recordDetail.breastfeed', { left: data.leftMinutes || 0, right: data.rightMinutes || 0 });
    case 'bottle':
      return t('recordDetail.bottle', {
        milk: data.milkType === 'formula' ? t('milk.formula') : t('milk.breastMilk'),
        amount: data.amountMl,
      });
    case 'pump': {
      const sideLabels: Record<string, string> = {
        left: t('pump.left'),
        right: t('pump.right'),
        both: t('pump.both'),
      };
      const storageLabels: Record<string, string> = {
        fridge: t('milk.fridge'),
        freezer: t('milk.freezer'),
        direct_feed: t('milk.directFeed'),
      };
      const parts = [
        `${data.amountMl}ml`,
        sideLabels[data.side] || data.side,
        t('duration.minutes', { n: data.durationMinutes || 0 }),
      ];
      if (data.storage) parts.push(storageLabels[data.storage] || data.storage);
      return parts.join(' · ');
    }
    case 'solid':
      return `${data.name}${data.amount ? ` (${data.amount})` : ''}`;
    case 'water':
      return `${data.amountMl}ml`;
    case 'diaper':
      return data.type === 'wet' ? t('diaper.wet') : data.type === 'dirty' ? t('diaper.dirty') : t('diaper.both');
    case 'sleep': {
      if (data.ongoing) return t('duration.ongoing');
      const sStart = data.startTime || record.occurredAt;
      const sEnd = data.endTime;
      if (sStart && sEnd) {
        const s = dayjs(sStart);
        const e = dayjs(sEnd);
        const durMin = data.durationMinutes || Math.round(e.diff(s, 'minute'));
        const durH = Math.floor(durMin / 60);
        const durM = durMin % 60;
        const durStr =
          durH > 0
            ? durM > 0
              ? t('duration.hoursMinutes', { h: durH, m: durM })
              : t('duration.hoursOnly', { h: durH })
            : t('duration.minutesOnly', { m: durM });
        const crossDay = !s.isSame(e, 'day');
        const endLabel = crossDay ? t('recordDetail.nextDay', { time: e.format('HH:mm') }) : e.format('HH:mm');
        return `${s.format('HH:mm')}-${endLabel} (${durStr})`;
      }
      return data.durationMinutes ? t('duration.minutes', { n: data.durationMinutes }) : '';
    }
    case 'supplement':
      return data.name || '';
    case 'temperature': {
      const loc: Record<string, string> = {
        axillary: t('temp.axillary'),
        ear: t('temp.ear'),
        forehead: t('temp.forehead'),
        rectal: t('temp.rectal'),
      };
      return `${data.value}°C (${loc[data.location] || data.location})`;
    }
    case 'play':
      return data.ongoing ? t('duration.ongoing') : data.durationMinutes ? t('duration.minutes', { n: data.durationMinutes }) : '';
    case 'bath':
      return data.ongoing ? t('duration.ongoing') : data.durationMinutes ? t('duration.minutes', { n: data.durationMinutes }) : '';
    default:
      return record.note || '';
  }
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
