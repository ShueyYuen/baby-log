import { useState, useEffect } from 'react';
import { useBaby } from '../contexts/BabyContext';
import { api } from '../lib/api';
import dayjs from 'dayjs';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface DailyData {
  date: string;
  feedingCount: number;
  diaperCount: number;
  sleepMinutes: number;
  feedingDetails: { breastfeed: number; bottle: number; solid: number };
}

export default function StatsPage() {
  const { currentBaby } = useBaby();
  const [weekData, setWeekData] = useState<DailyData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentBaby) return;
    loadWeekData();
  }, [currentBaby]);

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
      <h2 className="text-xl font-semibold">数据统计</h2>

      {loading ? (
        <div className="text-center py-12 text-gray-400">加载中...</div>
      ) : (
        <>
          {/* Today Summary */}
          {todayData && (
            <div className="grid grid-cols-3 gap-3">
              <div className="card text-center">
                <p className="text-2xl font-bold text-primary-500">{todayData.feedingCount}</p>
                <p className="text-xs text-gray-500 mt-1">今日喂养</p>
              </div>
              <div className="card text-center">
                <p className="text-2xl font-bold text-yellow-500">{todayData.diaperCount}</p>
                <p className="text-xs text-gray-500 mt-1">今日换尿布</p>
              </div>
              <div className="card text-center">
                <p className="text-2xl font-bold text-indigo-500">{Math.round(todayData.sleepMinutes / 60 * 10) / 10}h</p>
                <p className="text-xs text-gray-500 mt-1">今日睡眠</p>
              </div>
            </div>
          )}

          {/* Feeding Chart */}
          <div className="card">
            <h3 className="font-medium mb-4">近7天喂养次数</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Bar dataKey="喂养" fill="#f19232" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Diaper Chart */}
          <div className="card">
            <h3 className="font-medium mb-4">近7天换尿布次数</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Bar dataKey="换尿布" fill="#eab308" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Sleep Chart */}
          <div className="card">
            <h3 className="font-medium mb-4">近7天睡眠时长(小时)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Bar dataKey="睡眠" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
