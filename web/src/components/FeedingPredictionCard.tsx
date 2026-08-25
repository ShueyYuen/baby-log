import { AlarmClock, Bell, BellOff, Milk } from 'lucide-react';
import { useI18n } from '../contexts/I18nContext';
import { tZh, type TranslateFn } from '../i18n';
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
  const { t } = useI18n();
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
    timeText = overdue < 60
      ? t('feeding.overdueMinutes', { n: overdue })
      : t('feeding.overdueHours', { n: Math.floor(overdue / 60) });
  } else if (min < 60) {
    timeText = t('time.minutesLater', { n: min });
  } else {
    const h = Math.floor(min / 60);
    const m = min % 60;
    timeText = m > 0 ? t('time.hoursMinutesLater', { h, m }) : t('time.hoursLater', { h });
  }

  return (
    <div className={`card flex items-center gap-3 ${cardBg}`}>
      <div className="w-10 h-10 rounded-full bg-white/50 dark:bg-white/[0.06] flex items-center justify-center flex-shrink-0">
        <Milk size={18} className={labelColor} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium ${labelColor}`}>
          {t('feeding.nextFeed')}
          {prediction.method === 'bottle' && t('feeding.basedOnVolume')}
          {prediction.method === 'breastfeed' && t('feeding.basedOnDuration')}
        </p>
        <p className="text-sm font-semibold dark:text-gray-100">{timeText}</p>
      </div>
      {isPushSupported() && (
        <button onClick={onPush} className="w-8 h-8 rounded-full flex items-center justify-center glass-chip" title={pushEnabled ? t('feeding.setReminder') : t('feeding.enablePush')}>
          {pushEnabled ? <Bell size={14} /> : <BellOff size={14} />}
        </button>
      )}
      {min > 0 && (
        <button
          onClick={() => addFeedingReminderToCalendar(min, t)}
          className="w-8 h-8 rounded-full flex items-center justify-center glass-chip"
          title={t('feeding.systemAlarm')}
        >
          <AlarmClock size={14} />
        </button>
      )}
    </div>
  );
}

export function formatTimeAgo(minutes: number, t: TranslateFn = tZh): string {
  if (minutes < 1) return t('time.justNow');
  if (minutes < 60) return t('time.minutesAgo', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const m = minutes % 60;
    return m > 0 ? t('time.hoursMinutesAgo', { h: hours, m }) : t('time.hoursAgo', { n: hours });
  }
  return t('time.daysAgo', { n: Math.floor(hours / 24) });
}

export function minutesSince(time: string, now: number): number {
  return Math.max(0, Math.round((now - new Date(time).getTime()) / 60000));
}
