import { AlarmClock, Bell, BellOff, Milk } from 'lucide-react';
import type { FeedingPrediction } from '../lib/api';
import { isPushSupported } from '../lib/push';
import { addFeedingReminderToCalendar } from '../lib/calendar';

export function FeedingPredictionCard({
  prediction,
  pushEnabled,
  onPush,
}: {
  prediction: FeedingPrediction;
  pushEnabled: boolean;
  onPush: () => void;
}) {
  if (prediction.minutesUntilNext == null || prediction.avgIntervalMinutes == null) return null;
  const min = prediction.minutesUntilNext;
  const interval = prediction.avgIntervalMinutes;
  const ratio = min / interval;
  let cardBg = 'border border-green-200 dark:border-green-900/50';
  let labelColor = 'text-green-600 dark:text-green-400';
  if (min <= 0) {
    cardBg = 'border border-red-200 dark:border-red-900/50';
    labelColor = 'text-red-600 dark:text-red-400';
  } else if (ratio <= 0.25) {
    cardBg = 'border border-orange-200 dark:border-orange-900/50';
    labelColor = 'text-orange-600 dark:text-orange-400';
  } else if (ratio <= 0.5) {
    cardBg = 'border border-yellow-200 dark:border-yellow-900/50';
    labelColor = 'text-yellow-600 dark:text-yellow-500';
  }

  let timeText: string;
  if (min <= 0) {
    const overdue = Math.abs(min);
    timeText = overdue < 60 ? `已超时 ${overdue} 分钟，建议尽快喂奶` : `已超时 ${Math.floor(overdue / 60)}小时，建议尽快喂奶`;
  } else if (min < 60) {
    timeText = `约 ${min} 分钟后`;
  } else {
    timeText = `约 ${Math.floor(min / 60)}小时${min % 60 > 0 ? `${min % 60}分钟` : ''}后`;
  }

  return (
    <div className={`card flex items-center gap-3 ${cardBg}`}>
      <div className="w-10 h-10 rounded-full bg-white/50 dark:bg-white/[0.06] flex items-center justify-center flex-shrink-0">
        <Milk size={18} className={labelColor} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium ${labelColor}`}>
          预计下次喂奶
          {prediction.method === 'bottle' && ' (基于奶量)'}
          {prediction.method === 'breastfeed' && ' (基于哺乳时长)'}
        </p>
        <p className="text-sm font-semibold dark:text-gray-100">{timeText}</p>
      </div>
      {isPushSupported() && (
        <button onClick={onPush} className="w-8 h-8 rounded-full flex items-center justify-center glass-chip" title={pushEnabled ? '设置提醒' : '开启推送'}>
          {pushEnabled ? <Bell size={14} /> : <BellOff size={14} />}
        </button>
      )}
      {min > 0 && (
        <button
          onClick={() => addFeedingReminderToCalendar(min)}
          className="w-8 h-8 rounded-full flex items-center justify-center glass-chip"
          title="系统闹钟"
        >
          <AlarmClock size={14} />
        </button>
      )}
    </div>
  );
}

export function formatTimeAgo(minutes: number): string {
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时${minutes % 60 > 0 ? `${minutes % 60}分钟` : ''}前`;
  return `${Math.floor(hours / 24)}天前`;
}

export function minutesSince(time: string, now: number): number {
  return Math.max(0, Math.round((now - new Date(time).getTime()) / 60000));
}
