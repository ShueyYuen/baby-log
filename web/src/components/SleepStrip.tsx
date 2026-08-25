import { useMemo } from 'react';
import dayjs from 'dayjs';
import type { TimelineRecord } from '../lib/api';

interface SleepStripProps {
  records: TimelineRecord[];
  hours?: number;
}

export function SleepStrip({ records, hours = 24 }: SleepStripProps) {
  const now = Date.now();
  const windowStart = now - hours * 3600 * 1000;

  const segments = useMemo(() => {
    const sleeps = records
      .filter((r) => r.type === 'sleep')
      .map((r) => {
        const start = new Date(r.data?.startTime || r.occurredAt).getTime();
        const end = r.data?.ongoing
          ? now
          : r.data?.endTime
            ? new Date(r.data.endTime).getTime()
            : start + (Number(r.data?.durationMinutes) || 0) * 60000;
        return { start, end };
      })
      .filter((s) => s.end > windowStart && s.start < now)
      .map((s) => ({
        start: Math.max(s.start, windowStart),
        end: Math.min(s.end, now),
      }));
    return sleeps;
  }, [records, now, windowStart]);

  const totalMin = segments.reduce((sum, s) => sum + (s.end - s.start) / 60000, 0);
  const h = Math.floor(totalMin / 60);
  const m = Math.round(totalMin % 60);
  const span = now - windowStart;

  if (segments.length === 0) {
    return (
      <div className="card py-3">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">近 {hours} 小时睡眠</p>
        <p className="text-sm text-gray-400">还没有睡眠记录</p>
      </div>
    );
  }

  return (
    <div className="card py-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">近 {hours} 小时睡眠</p>
        <p className="text-sm font-semibold dark:text-gray-100">{h > 0 ? `${h}小时${m}分` : `${m}分钟`}</p>
      </div>
      <div className="relative h-5 rounded-full bg-gray-200/70 dark:bg-white/10 overflow-hidden">
        {segments.map((s, i) => {
          const left = ((s.start - windowStart) / span) * 100;
          const width = Math.max(((s.end - s.start) / span) * 100, 0.8);
          return (
            <div
              key={i}
              className="absolute top-0 bottom-0 bg-indigo-400 dark:bg-indigo-500"
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${dayjs(s.start).format('HH:mm')}–${dayjs(s.end).format('HH:mm')}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-gray-400 mt-1">
        <span>{dayjs(windowStart).format('HH:mm')}</span>
        <span>现在</span>
      </div>
    </div>
  );
}
