import { useState, useEffect, useCallback } from 'react';
import { useBaby } from '../contexts/BabyContext';
import { api } from '../lib/api';
import { useRefreshHandler } from '../hooks/usePullRefresh';
import { useServerEvent } from '../hooks/useServerEvents';
import { useActivated } from '../hooks/useActivated';
import dayjs from 'dayjs';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getAgeDays, evaluatePee, evaluatePoop, evaluateFeeding, evaluateSleep, type DiaperStatus } from '../lib/diaper-standards';
import { StatsSkeleton } from '../components/ui/skeleton';

interface DailyData {
  date: string;
  feedingCount: number;
  diaperCount: number;
  peeCount: number;
  poopCount: number;
  sleepMinutes: number;
  feedingDetails: { breastfeed: number; bottle: number; solid: number };
}

const diaperStatusStyle: Record<DiaperStatus, { badge: string; text: string; label: string }> = {
  normal: { badge: 'bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400', text: 'text-green-600 dark:text-green-400', label: '正常' },
  low: { badge: 'bg-orange-100 text-orange-600 dark:bg-orange-900/50 dark:text-orange-400', text: 'text-orange-600 dark:text-orange-400', label: '偏少' },
  high: { badge: 'bg-orange-100 text-orange-600 dark:bg-orange-900/50 dark:text-orange-400', text: 'text-orange-600 dark:text-orange-400', label: '偏多' },
};

interface TempPoint {
  time: string;
  value: number;
  location: string;
}

type RangePreset = '7' | '14' | '30' | 'custom';

const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: '7', label: '7天' },
  { value: '14', label: '14天' },
  { value: '30', label: '30天' },
  { value: 'custom', label: '自定义' },
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
      feedingCount: 0, diaperCount: 0, peeCount: 0, poopCount: 0, sleepMinutes: 0,
      feedingDetails: { breastfeed: 0, bottle: 0, solid: 0 },
    });
    cursor = cursor.add(1, 'day');
  }
  return days;
}

export default function StatsPage() {
  const { currentBaby } = useBaby();
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

  useActivated(useCallback(() => { loadWeekData(); loadTempData(); }, [loadWeekData, loadTempData]));
  useRefreshHandler(useCallback(async () => {
    await Promise.all([loadWeekData(), loadTempData()]);
  }, [loadWeekData, loadTempData]));

  useServerEvent(
    ['record.created', 'record.updated', 'record.deleted'],
    useCallback(() => { loadWeekData(); loadTempData(); }, [loadWeekData, loadTempData]),
  );

  const chartData = weekData.map((d) => ({
    date: dayjs(d.date).format('MM/DD'),
    rawDate: d.date,
    喂养: d.feedingCount,
    换尿布: d.diaperCount,
    小便: d.peeCount,
    大便: d.poopCount,
    睡眠: Math.round(d.sleepMinutes / 60 * 10) / 10,
  }));

  const xAxisInterval = chartData.length > 14 ? Math.max(1, Math.ceil(chartData.length / 7) - 1) : 0;

  const rangeChartTitle = (suffix: string) => {
    if (rangePreset === 'custom') {
      return `${dayjs(dateRange.startDate).format('MM/DD')}-${dayjs(dateRange.endDate).format('MM/DD')}${suffix}`;
    }
    return `近${rangePreset}天${suffix}`;
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
    const feed = evaluateFeeding(row.喂养, ageDays);
    return (
      <div
        className="rounded-lg p-3 max-w-[260px] shadow-lg"
        style={{ backgroundColor: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', color: 'var(--chart-tooltip-text)' }}
      >
        <p className="text-xs font-medium mb-2">{dayjs(row.rawDate).format('MM月DD日')}</p>
        {row.喂养 === 0 ? (
          <p className="text-xs opacity-70">当天无喂养记录</p>
        ) : (
          <div>
            <p className="text-xs">
              <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: '#f19232' }} />
              喂养 {feed.count} 次
              <span className={diaperStatusStyle[feed.status].text}> · {diaperStatusStyle[feed.status].label}</span>
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
    const sleep = evaluateSleep(row.睡眠, ageDays);
    return (
      <div
        className="rounded-lg p-3 max-w-[260px] shadow-lg"
        style={{ backgroundColor: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', color: 'var(--chart-tooltip-text)' }}
      >
        <p className="text-xs font-medium mb-2">{dayjs(row.rawDate).format('MM月DD日')}</p>
        {row.睡眠 === 0 ? (
          <p className="text-xs opacity-70">当天无睡眠记录</p>
        ) : (
          <div>
            <p className="text-xs">
              <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: '#6366f1' }} />
              睡眠 {sleep.count} 小时
              <span className={diaperStatusStyle[sleep.status].text}> · {diaperStatusStyle[sleep.status].label}</span>
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
    const pee = evaluatePee(row.小便, ageDays);
    const poop = evaluatePoop(row.大便, ageDays);
    return (
      <div
        className="rounded-lg p-3 max-w-[260px] shadow-lg"
        style={{ backgroundColor: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', color: 'var(--chart-tooltip-text)' }}
      >
        <p className="text-xs font-medium mb-2">{dayjs(row.rawDate).format('MM月DD日')}</p>
        {row.换尿布 === 0 ? (
          <p className="text-xs opacity-70">当天无换尿布记录</p>
        ) : (
          <div className="space-y-2">
            <div>
              <p className="text-xs">
                <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: '#06b6d4' }} />
                小便 {pee.count} 次
                <span className={diaperStatusStyle[pee.status].text}> · {diaperStatusStyle[pee.status].label}</span>
              </p>
              <p className="text-[11px] opacity-80 leading-relaxed mt-0.5">{pee.advice}</p>
            </div>
            <div>
              <p className="text-xs">
                <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: '#d97706' }} />
                大便 {poop.count} 次
                <span className={diaperStatusStyle[poop.status].text}> · {diaperStatusStyle[poop.status].label}</span>
              </p>
              <p className="text-[11px] opacity-80 leading-relaxed mt-0.5">{poop.advice}</p>
            </div>
          </div>
        )}
      </div>
    );
  };

  const todayData = weekData[weekData.length - 1];

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold dark:text-gray-100">数据统计</h2>

      <div className="space-y-3">
        <div className="flex gap-1 p-1 rounded-lg bg-gray-100 dark:bg-gray-800">
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => setRangePreset(preset.value)}
              className={`flex-1 min-w-0 py-1.5 px-1 rounded-md text-xs sm:text-sm font-medium transition-colors ${
                rangePreset === preset.value
                  ? 'bg-primary-500 text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-white/60 dark:hover:bg-gray-700'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {rangePreset === 'custom' && (
          <div className="flex flex-col sm:flex-row gap-3">
            <label className="flex-1">
              <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">开始日期</span>
              <input
                type="date"
                value={customStartDate}
                max={customEndDate}
                onChange={(e) => handleCustomStartChange(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </label>
            <label className="flex-1">
              <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">结束日期</span>
              <input
                type="date"
                value={customEndDate}
                min={customStartDate}
                max={todayStr}
                onChange={(e) => handleCustomEndChange(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </label>
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
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">今日喂养</p>
              </div>
              <div className="card text-center">
                <p className="text-2xl font-bold text-yellow-500">{todayData.diaperCount}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">今日换尿布</p>
              </div>
              <div className="card text-center">
                <p className="text-2xl font-bold text-indigo-500">{Math.round(todayData.sleepMinutes / 60 * 10) / 10}h</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">今日睡眠</p>
              </div>
            </div>
          )}

          {/* Feeding Chart */}
          <div className="card">
            <h3 className="font-medium mb-4 dark:text-gray-100">{rangeChartTitle('喂养次数')}</h3>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="date" fontSize={12} interval={xAxisInterval} tick={{ fill: 'var(--chart-axis)' }} />
                <YAxis fontSize={12} allowDecimals={false} tick={{ fill: 'var(--chart-axis)' }} />
                <Tooltip content={<FeedingTooltip />} cursor={{ stroke: 'var(--chart-cursor)' }} />
                <Line type="monotone" dataKey="喂养" stroke="#f19232" strokeWidth={2} dot={{ r: 3 }} animationDuration={300} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Diaper Chart */}
          <div className="card">
            <h3 className="font-medium mb-4 dark:text-gray-100">{rangeChartTitle('大小便次数')}</h3>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="date" fontSize={12} interval={xAxisInterval} tick={{ fill: 'var(--chart-axis)' }} />
                <YAxis fontSize={12} allowDecimals={false} tick={{ fill: 'var(--chart-axis)' }} />
                <Tooltip content={<DiaperTooltip />} cursor={{ stroke: 'var(--chart-cursor)' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="小便" stroke="#06b6d4" strokeWidth={2} dot={{ r: 3 }} animationDuration={300} />
                <Line type="monotone" dataKey="大便" stroke="#d97706" strokeWidth={2} dot={{ r: 3 }} animationDuration={300} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Sleep Chart */}
          <div className="card">
            <h3 className="font-medium mb-4 dark:text-gray-100">{rangeChartTitle('睡眠时长(小时)')}</h3>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="date" fontSize={12} interval={xAxisInterval} tick={{ fill: 'var(--chart-axis)' }} />
                <YAxis fontSize={12} tick={{ fill: 'var(--chart-axis)' }} />
                <Tooltip content={<SleepTooltip />} cursor={{ stroke: 'var(--chart-cursor)' }} />
                <Line type="monotone" dataKey="睡眠" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} animationDuration={300} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Temperature Chart */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium dark:text-gray-100">体温变化</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTempDate(dayjs(tempDate).subtract(1, 'day').format('YYYY-MM-DD'))}
                  className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-sm text-gray-600 dark:text-gray-300">
                  {dayjs(tempDate).format('MM月DD日')}
                  {tempDate === dayjs().format('YYYY-MM-DD') && ' (今天)'}
                </span>
                <button
                  onClick={() => setTempDate(dayjs(tempDate).add(1, 'day').format('YYYY-MM-DD'))}
                  disabled={tempDate >= dayjs().format('YYYY-MM-DD')}
                  className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 disabled:opacity-30"
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
                      const loc: Record<string, string> = { axillary: '腋下', ear: '耳温', forehead: '额温', rectal: '肛温' };
                      return [`${value}°C (${loc[props.payload.location] || ''})`, '体温'];
                    }}
                  />
                  <ReferenceLine y={37.3} stroke="#fbbf24" strokeDasharray="4 4" label={{ value: '37.3°C', position: 'right', fontSize: 10, fill: '#fbbf24' }} />
                  <Line type="monotone" dataKey="value" stroke="#ef4444" strokeWidth={2} dot={{ r: 4 }} animationDuration={300} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-gray-400 py-8">当天无体温记录</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
