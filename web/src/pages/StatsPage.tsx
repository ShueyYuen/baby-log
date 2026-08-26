import { useState, useEffect, useCallback } from 'react';
import { useBaby } from '../contexts/BabyContext';
import { useI18n } from '../contexts/I18nContext';
import { api } from '../lib/api';
import { useServerEvent } from '../hooks/useServerEvents';
import dayjs from 'dayjs';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { SecondaryHeader } from '../components/SecondaryHeader';
import { getAgeDays, evaluatePee, evaluatePoop, evaluateFeeding, evaluateSleep, type DiaperStatus } from '../lib/diaper-standards';
import { StatsSkeleton } from '../components/ui/skeleton';
import { DatePicker } from '../components/ui';

interface DailyData {
  date: string;
  feedingCount: number;
  diaperCount: number;
  peeCount: number;
  poopCount: number;
  sleepMinutes: number;
  bottleAmountMl?: number;
  feedingDetails: { breastfeed: number; bottle: number; solid: number };
}

const diaperStatusStyle: Record<DiaperStatus, { badge: string; text: string }> = {
  normal: { badge: 'bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400', text: 'text-green-600 dark:text-green-400' },
  low: { badge: 'bg-orange-100 text-orange-600 dark:bg-orange-900/50 dark:text-orange-400', text: 'text-orange-600 dark:text-orange-400' },
  high: { badge: 'bg-orange-100 text-orange-600 dark:bg-orange-900/50 dark:text-orange-400', text: 'text-orange-600 dark:text-orange-400' },
};

const STATUS_KEYS: Record<DiaperStatus, 'statusNormal' | 'statusLow' | 'statusHigh'> = {
  normal: 'statusNormal',
  low: 'statusLow',
  high: 'statusHigh',
};

interface TempPoint {
  time: string;
  value: number;
  location: string;
}

type RangePreset = '7' | '14' | '30' | 'custom';

const RANGE_PRESETS: { value: RangePreset; labelKey: 'days7' | 'days14' | 'days30' | 'custom' }[] = [
  { value: '7', labelKey: 'days7' },
  { value: '14', labelKey: 'days14' },
  { value: '30', labelKey: 'days30' },
  { value: 'custom', labelKey: 'custom' },
];

function getPresetDateRange(preset: RangePreset, customStart: string, customEnd: string) {
  if (preset === 'custom') {
    return { startDate: customStart, endDate: customEnd };
  }
  const days = parseInt(preset, 10);
  return {
    startDate: dayjs().subtract(days - 1, 'day').format('YYYY-MM-DD'),
    endDate: dayjs().format('YYYY-MM-DD'),
  };
}

function buildEmptyRange(startDate: string, endDate: string): DailyData[] {
  const days: DailyData[] = [];
  let cursor = dayjs(startDate);
  const end = dayjs(endDate);
  while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
    days.push({
      date: cursor.format('YYYY-MM-DD'),
      feedingCount: 0, diaperCount: 0, peeCount: 0, poopCount: 0, sleepMinutes: 0, bottleAmountMl: 0,
      feedingDetails: { breastfeed: 0, bottle: 0, solid: 0 },
    });
    cursor = cursor.add(1, 'day');
  }
  return days;
}

export default function StatsPage() {
  const { currentBaby } = useBaby();
  const { t } = useI18n();
  const [weekData, setWeekData] = useState<DailyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [rangePreset, setRangePreset] = useState<RangePreset>('7');
  const [customStartDate, setCustomStartDate] = useState(dayjs().subtract(6, 'day').format('YYYY-MM-DD'));
  const [customEndDate, setCustomEndDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [tempDate, setTempDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [tempData, setTempData] = useState<TempPoint[]>([]);
  const dateRange = getPresetDateRange(rangePreset, customStartDate, customEndDate);

  const loadWeekData = useCallback(async () => {
    if (!currentBaby) return;
    setLoading(true);

    const { startDate, endDate } = getPresetDateRange(rangePreset, customStartDate, customEndDate);
    const tz = new Date().getTimezoneOffset();
    try {
      const res = await api.get<{ success: boolean; data: DailyData[] }>(
        `/stats/range?babyId=${currentBaby.id}&startDate=${startDate}&endDate=${endDate}&tz=${tz}`
      );
      setWeekData(res.data);
    } catch {
      setWeekData(buildEmptyRange(startDate, endDate));
    } finally {
      setLoading(false);
    }
  }, [currentBaby, rangePreset, customStartDate, customEndDate]);

  const loadTempData = useCallback(async () => {
    if (!currentBaby) return;
    try {
      const res = await api.get<{ success: boolean; data: { items: any[] } }>(
        `/records?babyId=${currentBaby.id}&type=temperature&pageSize=100`
      );
      const dayRecords = res.data.items
        .filter((r: any) => dayjs(r.occurredAt).format('YYYY-MM-DD') === tempDate)
        .sort((a: any, b: any) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())
        .map((r: any) => ({
          time: dayjs(r.occurredAt).format('HH:mm'),
          value: r.data?.value || 0,
          location: r.data?.location || '',
        }));
      setTempData(dayRecords);
    } catch {
      setTempData([]);
    }
  }, [currentBaby, tempDate]);

  useEffect(() => {
    if (!currentBaby) return;
    loadWeekData();
  }, [currentBaby, loadWeekData]);

  useEffect(() => {
    if (!currentBaby) return;
    loadTempData();
  }, [currentBaby, loadTempData]);

  useServerEvent(
    ['record.created', 'record.updated', 'record.deleted'],
    useCallback(() => { loadWeekData(); loadTempData(); }, [loadWeekData, loadTempData]),
  );

  const chartData = weekData.map((d) => ({
    date: dayjs(d.date).format('MM/DD'),
    rawDate: d.date,
    feeding: d.feedingCount,
    diaper: d.diaperCount,
    pee: d.peeCount,
    poop: d.poopCount,
    sleep: Math.round(d.sleepMinutes / 60 * 10) / 10,
    milk: d.bottleAmountMl ?? 0,
  }));

  const xAxisInterval = chartData.length > 14 ? Math.max(1, Math.ceil(chartData.length / 7) - 1) : 0;

  const rangeChartTitle = (suffix: string) => {
    if (rangePreset === 'custom') {
      return `${dayjs(dateRange.startDate).format('MM/DD')}-${dayjs(dateRange.endDate).format('MM/DD')}${suffix}`;
    }
    return t('stats.recentDays', { n: rangePreset, suffix });
  };

  const todayStr = dayjs().format('YYYY-MM-DD');

  const handleCustomStartChange = (value: string) => {
    setCustomStartDate(value);
    if (value > customEndDate) setCustomEndDate(value);
  };

  const handleCustomEndChange = (value: string) => {
    const capped = value > todayStr ? todayStr : value;
    setCustomEndDate(capped);
    if (capped < customStartDate) setCustomStartDate(capped);
  };

  const FeedingTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const row = payload[0].payload;
    const ageDays = getAgeDays(currentBaby?.birthDate, row.rawDate);
    const feed = evaluateFeeding(row.feeding, ageDays, t);
    return (
      <div
        className="rounded-lg p-3 max-w-[260px] shadow-lg"
        style={{ backgroundColor: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', color: 'var(--chart-tooltip-text)' }}
      >
        <p className="text-xs font-medium mb-2">{dayjs(row.rawDate).format(t('dateFmt.mdPad'))}</p>
        {row.feeding === 0 ? (
          <p className="text-xs opacity-70">{t('stats.noFeeding')}</p>
        ) : (
          <div>
            <p className="text-xs">
              <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: '#f19232' }} />
              {t('stats.feedingTimes', { n: feed.count })}
              <span className={diaperStatusStyle[feed.status].text}> · {t(`stats.${STATUS_KEYS[feed.status]}`)}</span>
            </p>
            <p className="text-[11px] opacity-80 leading-relaxed mt-0.5">{feed.advice}</p>
          </div>
        )}
      </div>
    );
  };

  const SleepTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const row = payload[0].payload;
    const ageDays = getAgeDays(currentBaby?.birthDate, row.rawDate);
    const sleep = evaluateSleep(row.sleep, ageDays, t);
    return (
      <div
        className="rounded-lg p-3 max-w-[260px] shadow-lg"
        style={{ backgroundColor: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', color: 'var(--chart-tooltip-text)' }}
      >
        <p className="text-xs font-medium mb-2">{dayjs(row.rawDate).format(t('dateFmt.mdPad'))}</p>
        {row.sleep === 0 ? (
          <p className="text-xs opacity-70">{t('stats.noSleep')}</p>
        ) : (
          <div>
            <p className="text-xs">
              <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: '#6366f1' }} />
              {t('stats.sleepHoursVal', { n: sleep.count })}
              <span className={diaperStatusStyle[sleep.status].text}> · {t(`stats.${STATUS_KEYS[sleep.status]}`)}</span>
            </p>
            <p className="text-[11px] opacity-80 leading-relaxed mt-0.5">{sleep.advice}</p>
          </div>
        )}
      </div>
    );
  };

  const DiaperTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const row = payload[0].payload;
    const ageDays = getAgeDays(currentBaby?.birthDate, row.rawDate);
    const pee = evaluatePee(row.pee, ageDays, t);
    const poop = evaluatePoop(row.poop, ageDays, t);
    return (
      <div
        className="rounded-lg p-3 max-w-[260px] shadow-lg"
        style={{ backgroundColor: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', color: 'var(--chart-tooltip-text)' }}
      >
        <p className="text-xs font-medium mb-2">{dayjs(row.rawDate).format(t('dateFmt.mdPad'))}</p>
        {row.diaper === 0 ? (
          <p className="text-xs opacity-70">{t('stats.noDiaper')}</p>
        ) : (
          <div className="space-y-2">
            <div>
              <p className="text-xs">
                <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: '#06b6d4' }} />
                {t('stats.peeTimes', { n: pee.count })}
                <span className={diaperStatusStyle[pee.status].text}> · {t(`stats.${STATUS_KEYS[pee.status]}`)}</span>
              </p>
              <p className="text-[11px] opacity-80 leading-relaxed mt-0.5">{pee.advice}</p>
            </div>
            <div>
              <p className="text-xs">
                <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: '#d97706' }} />
                {t('stats.poopTimes', { n: poop.count })}
                <span className={diaperStatusStyle[poop.status].text}> · {t(`stats.${STATUS_KEYS[poop.status]}`)}</span>
              </p>
              <p className="text-[11px] opacity-80 leading-relaxed mt-0.5">{poop.advice}</p>
            </div>
          </div>
        )}
      </div>
    );
  };

  const BottleTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const row = payload[0].payload;
    return (
      <div
        className="rounded-lg p-3 max-w-[260px] shadow-lg"
        style={{ backgroundColor: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', color: 'var(--chart-tooltip-text)' }}
      >
        <p className="text-xs font-medium mb-2">{dayjs(row.rawDate).format(t('dateFmt.mdPad'))}</p>
        {row.milk === 0 ? (
          <p className="text-xs opacity-70">{t('stats.noBottle')}</p>
        ) : (
          <p className="text-xs">
            <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: '#3b82f6' }} />
            {t('stats.bottleMl', { n: row.milk })}
          </p>
        )}
      </div>
    );
  };

  const todayData = weekData[weekData.length - 1];

  return (
    <div className="absolute inset-0 glass-page-shell">
      <SecondaryHeader title={t('stats.title')} />
      <div className="glass-page-body custom-scrollbar space-y-6">

      <div className="space-y-3">
        <div className="flex gap-1 p-1 rounded-lg glass-preset-bar">
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => setRangePreset(preset.value)}
              className={`flex-1 min-w-0 py-1.5 px-1 rounded-md text-xs sm:text-sm font-medium transition-colors ${
                rangePreset === preset.value
                  ? 'bg-primary-500 text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-white/40 dark:hover:bg-white/[0.06]'
              }`}
            >
              {t(`stats.${preset.labelKey}`)}
            </button>
          ))}
        </div>

        {rangePreset === 'custom' && (
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('stats.startDate')}</span>
              <DatePicker value={customStartDate} onChange={handleCustomStartChange} placeholder={t('stats.startDate')} />
            </div>
            <div className="flex-1">
              <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('stats.endDate')}</span>
              <DatePicker value={customEndDate} onChange={handleCustomEndChange} placeholder={t('stats.endDate')} />
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <StatsSkeleton />
      ) : (
        <>
          {/* Today Summary */}
          {todayData && (
            <div className="grid grid-cols-3 gap-3">
              <div className="card text-center">
                <p className="text-2xl font-bold text-primary-500">{todayData.feedingCount}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('stats.todayFeeding')}</p>
              </div>
              <div className="card text-center">
                <p className="text-2xl font-bold text-yellow-500">{todayData.diaperCount}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('stats.todayDiaper')}</p>
              </div>
              <div className="card text-center">
                <p className="text-2xl font-bold text-indigo-500">{Math.round(todayData.sleepMinutes / 60 * 10) / 10}h</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('stats.todaySleep')}</p>
              </div>
            </div>
          )}

          {/* Feeding Chart */}
          <div className="card">
            <h3 className="font-medium mb-4 dark:text-gray-100">{rangeChartTitle(t('stats.feedingCount'))}</h3>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="date" fontSize={12} interval={xAxisInterval} tick={{ fill: 'var(--chart-axis)' }} />
                <YAxis fontSize={12} allowDecimals={false} tick={{ fill: 'var(--chart-axis)' }} />
                <Tooltip content={<FeedingTooltip />} cursor={{ stroke: 'var(--chart-cursor)' }} />
                <Line type="monotone" dataKey="feeding" stroke="#f19232" strokeWidth={2} dot={{ r: 3 }} name={t('stats.feeding')} animationDuration={300} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Diaper Chart */}
          <div className="card">
            <h3 className="font-medium mb-4 dark:text-gray-100">{rangeChartTitle(t('stats.diaperCount'))}</h3>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="date" fontSize={12} interval={xAxisInterval} tick={{ fill: 'var(--chart-axis)' }} />
                <YAxis fontSize={12} allowDecimals={false} tick={{ fill: 'var(--chart-axis)' }} />
                <Tooltip content={<DiaperTooltip />} cursor={{ stroke: 'var(--chart-cursor)' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="pee" stroke="#06b6d4" strokeWidth={2} dot={{ r: 3 }} name={t('stats.pee')} animationDuration={300} />
                <Line type="monotone" dataKey="poop" stroke="#d97706" strokeWidth={2} dot={{ r: 3 }} name={t('stats.poop')} animationDuration={300} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Sleep Chart */}
          <div className="card">
            <h3 className="font-medium mb-4 dark:text-gray-100">{rangeChartTitle(t('stats.sleepHours'))}</h3>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="date" fontSize={12} interval={xAxisInterval} tick={{ fill: 'var(--chart-axis)' }} />
                <YAxis fontSize={12} tick={{ fill: 'var(--chart-axis)' }} />
                <Tooltip content={<SleepTooltip />} cursor={{ stroke: 'var(--chart-cursor)' }} />
                <Line type="monotone" dataKey="sleep" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} name={t('stats.sleep')} animationDuration={300} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Bottle Amount Chart */}
          <div className="card">
            <h3 className="font-medium mb-4 dark:text-gray-100">{rangeChartTitle(t('stats.milkMl'))}</h3>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="date" fontSize={12} interval={xAxisInterval} tick={{ fill: 'var(--chart-axis)' }} />
                <YAxis fontSize={12} allowDecimals={false} tick={{ fill: 'var(--chart-axis)' }} unit="ml" />
                <Tooltip content={<BottleTooltip />} cursor={{ stroke: 'var(--chart-cursor)' }} />
                <Line type="monotone" dataKey="milk" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name={t('stats.milk')} animationDuration={300} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Temperature Chart */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium dark:text-gray-100">{t('stats.tempChange')}</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTempDate(dayjs(tempDate).subtract(1, 'day').format('YYYY-MM-DD'))}
                  className="p-1 rounded glass-icon-btn text-gray-500 dark:text-gray-400"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-sm text-gray-600 dark:text-gray-300">
                  {dayjs(tempDate).format(t('dateFmt.mdPad'))}
                  {tempDate === dayjs().format('YYYY-MM-DD') && t('stats.todaySuffix')}
                </span>
                <button
                  onClick={() => setTempDate(dayjs(tempDate).add(1, 'day').format('YYYY-MM-DD'))}
                  disabled={tempDate >= dayjs().format('YYYY-MM-DD')}
                  className="p-1 rounded glass-icon-btn text-gray-500 dark:text-gray-400 disabled:opacity-30"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
            {tempData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={tempData} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="time" fontSize={12} tick={{ fill: 'var(--chart-axis)' }} />
                  <YAxis fontSize={12} domain={[35.5, 39]} tick={{ fill: 'var(--chart-axis)' }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: '8px', color: 'var(--chart-tooltip-text)' }}
                    formatter={(value: number, _name: string, props: any) => {
                      const locKey = props.payload.location ? `temp.${props.payload.location}` : '';
                      const loc = locKey ? t(locKey) : '';
                      return [`${value}°C (${loc === locKey ? '' : loc})`, t('stats.temperature')];
                    }}
                  />
                  <ReferenceLine y={37.3} stroke="#fbbf24" strokeDasharray="4 4" label={{ value: '37.3°C', position: 'right', fontSize: 10, fill: '#fbbf24' }} />
                  <Line type="monotone" dataKey="value" stroke="#ef4444" strokeWidth={2} dot={{ r: 4 }} animationDuration={300} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-gray-400 py-8">{t('stats.noTemp')}</p>
            )}
          </div>
        </>
      )}
      </div>
    </div>
  );
}
