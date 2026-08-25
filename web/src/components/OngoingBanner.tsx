import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { Square } from 'lucide-react';
import { useI18n } from '../contexts/I18nContext';
import type { TimelineRecord } from '../lib/api';
import { api } from '../lib/api';
import { formatElapsed, recordTypeLabel, typeConfig } from '../lib/record-types';
import { invalidateRecordCaches } from '../lib/quick-record';
import { Button, DateTimePicker, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, ScrollDateTimePicker, useToast } from './ui';

export function OngoingBanner({
  records,
  isViewer,
  now,
  onChanged,
}: {
  records: TimelineRecord[];
  isViewer: boolean;
  now: number;
  onChanged?: () => void;
}) {
  const { toast } = useToast();
  const { t } = useI18n();
  const ongoing = records.filter((r) => r.data?.ongoing);
  const [endingRecord, setEndingRecord] = useState<TimelineRecord | null>(null);
  const [endWakeTime, setEndWakeTime] = useState('');

  if (ongoing.length === 0) return null;

  const finish = async (record: TimelineRecord, endIso: string) => {
    const startTime = record.data?.startTime || record.occurredAt;
    const startMs = new Date(startTime).getTime();
    let endMs = new Date(endIso).getTime();
    if (endMs <= startMs) endMs += 24 * 60 * 60 * 1000;
    const durationMinutes = Math.max(1, Math.round((endMs - startMs) / 60000));
    try {
      await api.recordsCrud.update(record.id, {
        data: { ...record.data, ongoing: undefined, startTime, endTime: new Date(endMs).toISOString(), durationMinutes },
      });
      const durH = Math.floor(durationMinutes / 60);
      const durM = durationMinutes % 60;
      const durStr = durH > 0
        ? t('time.hoursMinutes', { h: durH, m: durM })
        : t('duration.minutes', { n: durationMinutes });
      toast(t('ongoing.ended', { label: recordTypeLabel(record.type, t), duration: durStr }), 'success');
      invalidateRecordCaches();
      onChanged?.();
    } catch {
      toast(t('ongoing.endFailed'), 'error');
    }
  };

  const handleEnd = (record: TimelineRecord) => {
    if (record.type === 'sleep') {
      setEndingRecord(record);
      setEndWakeTime(dayjs().format('YYYY-MM-DDTHH:mm'));
    } else {
      finish(record, new Date().toISOString());
    }
  };

  return (
    <>
      <div className="sticky top-0 z-20 space-y-2 -mx-4 px-4 py-2 bg-white/40 dark:bg-transparent backdrop-blur-md">
        {ongoing.map((record) => {
          const config = typeConfig[record.type] || typeConfig.other;
          const Icon = config.icon;
          const startTime = record.data?.startTime || record.occurredAt;
          const elapsed = formatElapsed(now - new Date(startTime).getTime());
          return (
            <div key={record.id} className={`card flex items-center gap-3 border-l-[3px] ${config.accent}`}>
              <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${config.color} bg-white/50 dark:bg-white/[0.06]`}>
                <Icon size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium dark:text-gray-100">{t('ongoing.inProgress', { label: recordTypeLabel(record.type, t) })}</span>
                  <span className="text-xs text-indigo-500">{t('ongoing.startedAt', { time: dayjs(startTime).format('HH:mm') })}</span>
                </div>
                <p className="text-lg font-semibold tabular-nums text-indigo-600 dark:text-indigo-300">{elapsed}</p>
              </div>
              {!isViewer && (
                <Button onClick={() => handleEnd(record)} size="sm" className="gap-1.5 rounded-full flex-shrink-0">
                  <Square size={14} fill="currentColor" />
                  {t('ongoing.end')}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={!!endingRecord} onOpenChange={(v) => { if (!v) setEndingRecord(null); }}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle>{t('ongoing.endSleep')}</DialogTitle>
            <DialogDescription>
              {endingRecord && t('ongoing.confirmWake', { time: dayjs(endingRecord.data?.startTime || endingRecord.occurredAt).format('HH:mm') })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <ScrollDateTimePicker value={endWakeTime} onChange={setEndWakeTime} className="md:hidden" />
            <DateTimePicker value={endWakeTime} onChange={setEndWakeTime} placeholder={t('ongoing.pickWakeTime')} className="hidden md:flex" />
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setEndingRecord(null)}>{t('common.cancel')}</Button>
              <Button className="flex-1" onClick={() => {
                if (endingRecord) finish(endingRecord, new Date(endWakeTime).toISOString());
                setEndingRecord(null);
              }}>{t('ongoing.confirmEnd')}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function useNowTicker(hasOngoing: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), hasOngoing ? 1000 : 60 * 1000);
    return () => clearInterval(timer);
  }, [hasOngoing]);
  return now;
}
