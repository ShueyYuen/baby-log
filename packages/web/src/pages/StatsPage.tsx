import { useState, useEffect } from 'react';
import { useBaby } from '../contexts/BabyContext';
import { api } from '../lib/api';
import dayjs from 'dayjs';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface DailyData {
  date: string;
  feedingCount: number;
  diaperCount: number;
  sleepMinutes: number;
  feedingDetails: { breastfeed: number; bottle: number; solid: number };
}

interface TempPoint {
  time: string;
  value: number;
  location: string;
}

export default function StatsPage() {
  const { currentBaby } = useBaby();
  const [weekData, setWeekData] = useState<DailyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [tempDate, setTempDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [tempData, setTempData] = useState<TempPoint[]>([]);

  useEffect(() => {
    if (!currentBaby) return;
    loadWeekData();
  }, [currentBaby]);

  useEffect(() => {
    if (!currentBaby) return;
    loadTempData();
  }, [currentBaby, tempDate]);

  const loadTempData = async () => {
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
  };

  const loadWeekData = async () => {
    if (!currentBaby) return;
    setLoading(true);

    const days: DailyData[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
      try {
        const res = await api.get<{ success: boolean; data: DailyData }>(`/stats/daily?babyId=${currentBaby.id}&date=${date}`);
        days.push(res.data);
      } catch {
        days.push({ date, feedingCount: 0, diaperCount: 0, sleepMinutes: 0, feedingDetails: { breastfeed: 0, bottle: 0, solid: 0 } });
      }
    }

    setWeekData(days);
    setLoading(false);
  };

  const chartData = weekData.map((d) => ({
    date: dayjs(d.date).format('MM/DD'),
    喂养: d.feedingCount,
    换尿布: d.diaperCount,
    睡眠: Math.round(d.sleepMinutes / 60 * 10) / 10,
  }));

  const todayData = weekData[weekData.length - 1];

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold dark:text-gray-100">数据统计</h2>

      {loading ? (
        <div className="text-center py-12 text-gray-400">加载中...</div>
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
            <h3 className="font-medium mb-4 dark:text-gray-100">近7天喂养次数</h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="date" fontSize={12} tick={{ fill: 'var(--chart-axis)' }} />
                <YAxis fontSize={12} allowDecimals={false} tick={{ fill: 'var(--chart-axis)' }} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: '8px', color: 'var(--chart-tooltip-text)' }} cursor={{ fill: 'var(--chart-cursor)' }} />
                <Bar dataKey="喂养" fill="#f19232" radius={[4, 4, 0, 0]} animationDuration={300} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Diaper Chart */}
          <div className="card">
            <h3 className="font-medium mb-4 dark:text-gray-100">近7天换尿布次数</h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="date" fontSize={12} tick={{ fill: 'var(--chart-axis)' }} />
                <YAxis fontSize={12} allowDecimals={false} tick={{ fill: 'var(--chart-axis)' }} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: '8px', color: 'var(--chart-tooltip-text)' }} cursor={{ fill: 'var(--chart-cursor)' }} />
                <Bar dataKey="换尿布" fill="#eab308" radius={[4, 4, 0, 0]} animationDuration={300} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Sleep Chart */}
          <div className="card">
            <h3 className="font-medium mb-4 dark:text-gray-100">近7天睡眠时长(小时)</h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="date" fontSize={12} tick={{ fill: 'var(--chart-axis)' }} />
                <YAxis fontSize={12} tick={{ fill: 'var(--chart-axis)' }} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: '8px', color: 'var(--chart-tooltip-text)' }} cursor={{ fill: 'var(--chart-cursor)' }} />
                <Bar dataKey="睡眠" fill="#6366f1" radius={[4, 4, 0, 0]} animationDuration={300} />
              </BarChart>
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
