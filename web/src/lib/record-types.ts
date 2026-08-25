import dayjs from 'dayjs';
import type { LucideIcon } from 'lucide-react';
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

export function formatRecordDetail(record: TimelineRecord): string {
  const { type, data } = record;
  switch (type) {
    case 'breastfeed':
      return `左${data.leftMinutes || 0}分钟 / 右${data.rightMinutes || 0}分钟`;
    case 'bottle':
      return `${data.milkType === 'formula' ? '配方奶' : '母乳'} ${data.amountMl}ml`;
    case 'pump': {
      const sideLabels: Record<string, string> = { left: '左', right: '右', both: '双侧' };
      const storageLabels: Record<string, string> = { fridge: '冷藏', freezer: '冷冻', direct_feed: '直接喂' };
      const parts = [`${data.amountMl}ml`, sideLabels[data.side] || data.side, `${data.durationMinutes || 0}分钟`];
      if (data.storage) parts.push(storageLabels[data.storage] || data.storage);
      return parts.join(' · ');
    }
    case 'solid':
      return `${data.name}${data.amount ? ` (${data.amount})` : ''}`;
    case 'water':
      return `${data.amountMl}ml`;
    case 'diaper':
      return data.type === 'wet' ? '尿' : data.type === 'dirty' ? '便' : '尿+便';
    case 'sleep': {
      if (data.ongoing) return '进行中';
      const sStart = data.startTime || record.occurredAt;
      const sEnd = data.endTime;
      if (sStart && sEnd) {
        const s = dayjs(sStart);
        const e = dayjs(sEnd);
        const durMin = data.durationMinutes || Math.round(e.diff(s, 'minute'));
        const durH = Math.floor(durMin / 60);
        const durM = durMin % 60;
        const durStr = durH > 0 ? `${durH}h${durM > 0 ? `${durM}m` : ''}` : `${durM}m`;
        const crossDay = !s.isSame(e, 'day');
        return `${s.format('HH:mm')}-${crossDay ? e.format('次日HH:mm') : e.format('HH:mm')} (${durStr})`;
      }
      return data.durationMinutes ? `${data.durationMinutes}分钟` : '';
    }
    case 'supplement':
      return data.name || '';
    case 'temperature': {
      const loc: Record<string, string> = { axillary: '腋下', ear: '耳温', forehead: '额温', rectal: '肛温' };
      return `${data.value}°C (${loc[data.location] || data.location})`;
    }
    case 'play':
      return data.ongoing ? '进行中' : data.durationMinutes ? `${data.durationMinutes}分钟` : '';
    case 'bath':
      return data.ongoing ? '进行中' : data.durationMinutes ? `${data.durationMinutes}分钟` : '';
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
