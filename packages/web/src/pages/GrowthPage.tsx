import { useState, useEffect } from 'react';
import { useBaby } from '../contexts/BabyContext';
import { api } from '../lib/api';
import dayjs from 'dayjs';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Plus, Star } from 'lucide-react';

interface GrowthItem {
  id: string;
  date: string;
  height?: number;
  weight?: number;
  headCircumference?: number;
  note?: string;
}

interface MilestoneItem {
  id: string;
  type: string;
  title: string;
  occurredAt: string;
  description?: string;
}

const milestoneLabels: Record<string, string> = {
  roll_over: '翻身',
  smile: '微笑',
  head_up: '抬头',
  sleep_through: '睡整觉',
  first_tooth: '长牙',
  crawl: '爬行',
  walk: '走路',
  custom: '自定义',
};

export default function GrowthPage() {
  const { currentBaby } = useBaby();
  const [growthRecords, setGrowthRecords] = useState<GrowthItem[]>([]);
  const [milestones, setMilestones] = useState<MilestoneItem[]>([]);
  const [showGrowthForm, setShowGrowthForm] = useState(false);
  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [activeChart, setActiveChart] = useState<'weight' | 'height' | 'head'>('weight');

  // Growth form
  const [gDate, setGDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [gHeight, setGHeight] = useState('');
  const [gWeight, setGWeight] = useState('');
  const [gHead, setGHead] = useState('');

  // Milestone form
  const [mType, setMType] = useState('smile');
  const [mTitle, setMTitle] = useState('');
  const [mDate, setMDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [mDesc, setMDesc] = useState('');

  useEffect(() => {
    if (!currentBaby) return;
    loadData();
  }, [currentBaby]);

  const loadData = async () => {
    if (!currentBaby) return;
    const [growthRes, milestonesRes] = await Promise.all([
      api.get<{ success: boolean; data: GrowthItem[] }>(`/growth?babyId=${currentBaby.id}`),
      api.get<{ success: boolean; data: MilestoneItem[] }>(`/milestones?babyId=${currentBaby.id}`),
    ]);
    setGrowthRecords(growthRes.data);
    setMilestones(milestonesRes.data);
  };

  const addGrowth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBaby) return;
    await api.post('/growth', {
      babyId: currentBaby.id,
      date: gDate,
      height: gHeight ? +gHeight : undefined,
      weight: gWeight ? +gWeight : undefined,
      headCircumference: gHead ? +gHead : undefined,
    });
    setShowGrowthForm(false);
    setGHeight(''); setGWeight(''); setGHead('');
    loadData();
  };

  const addMilestone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBaby) return;
    await api.post('/milestones', {
      babyId: currentBaby.id,
      type: mType,
      title: mTitle || milestoneLabels[mType],
      occurredAt: new Date(mDate).toISOString(),
      description: mDesc || undefined,
    });
    setShowMilestoneForm(false);
    setMTitle(''); setMDesc('');
    loadData();
  };

  const chartData = [...growthRecords]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map((r) => ({
      date: dayjs(r.date).format('MM/DD'),
      weight: r.weight,
      height: r.height,
      head: r.headCircumference,
    }));

  const chartConfig = {
    weight: { label: '体重(kg)', color: '#f19232', key: 'weight' },
    height: { label: '身高(cm)', color: '#10b981', key: 'height' },
    head: { label: '头围(cm)', color: '#6366f1', key: 'head' },
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">成长记录</h2>

      {/* Growth Chart */}
      <div className="card">
        <div className="flex gap-2 mb-4">
          {Object.entries(chartConfig).map(([key, cfg]) => (
            <button
              key={key}
              onClick={() => setActiveChart(key as any)}
              className={`px-3 py-1 rounded-full text-xs ${activeChart === key ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-600'}`}
            >
              {cfg.label}
            </button>
          ))}
        </div>

        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey={chartConfig[activeChart].key}
                stroke={chartConfig[activeChart].color}
                strokeWidth={2}
                dot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-center text-gray-400 py-8">暂无数据</p>
        )}

        <button onClick={() => setShowGrowthForm(true)} className="btn-secondary w-full mt-4 flex items-center justify-center gap-1">
          <Plus size={16} /> 记录生理数据
        </button>
      </div>

      {/* Growth Form Modal */}
      {showGrowthForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 px-4">
          <form onSubmit={addGrowth} className="bg-white rounded-xl p-6 w-full max-w-sm space-y-4">
            <h3 className="font-semibold text-lg">记录生理数据</h3>
            <div>
              <label className="block text-sm text-gray-700 mb-1">日期</label>
              <input type="date" value={gDate} onChange={(e) => setGDate(e.target.value)} className="input" required />
            </div>
            <div>
              <label className="block text-sm text-gray-700 mb-1">体重(kg)</label>
              <input type="number" value={gWeight} onChange={(e) => setGWeight(e.target.value)} className="input" step="0.1" placeholder="如：3.5" />
            </div>
            <div>
              <label className="block text-sm text-gray-700 mb-1">身高(cm)</label>
              <input type="number" value={gHeight} onChange={(e) => setGHeight(e.target.value)} className="input" step="0.1" placeholder="如：50" />
            </div>
            <div>
              <label className="block text-sm text-gray-700 mb-1">头围(cm)</label>
              <input type="number" value={gHead} onChange={(e) => setGHead(e.target.value)} className="input" step="0.1" placeholder="如：34" />
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShowGrowthForm(false)} className="btn-secondary flex-1">取消</button>
              <button type="submit" className="btn-primary flex-1">保存</button>
            </div>
          </form>
        </div>
      )}

      {/* Milestones */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-lg">里程碑</h3>
          <button onClick={() => setShowMilestoneForm(true)} className="text-sm text-primary-500 flex items-center gap-1">
            <Plus size={14} /> 添加
          </button>
        </div>

        {milestones.length === 0 ? (
          <p className="text-center text-gray-400 py-6">暂无里程碑记录</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {milestones.map((m) => (
              <div key={m.id} className="card flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-yellow-50 flex items-center justify-center">
                  <Star size={18} className="text-yellow-500" />
                </div>
                <div>
                  <h4 className="font-medium text-sm">{m.title}</h4>
                  <p className="text-xs text-gray-400">{dayjs(m.occurredAt).format('YYYY-MM-DD')}</p>
                  {m.description && <p className="text-xs text-gray-500 mt-1">{m.description}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Milestone Form Modal */}
      {showMilestoneForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 px-4">
          <form onSubmit={addMilestone} className="bg-white rounded-xl p-6 w-full max-w-sm space-y-4">
            <h3 className="font-semibold text-lg">记录里程碑</h3>
            <div>
              <label className="block text-sm text-gray-700 mb-1">类型</label>
              <select value={mType} onChange={(e) => setMType(e.target.value)} className="input">
                {Object.entries(milestoneLabels).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-700 mb-1">标题</label>
              <input type="text" value={mTitle} onChange={(e) => setMTitle(e.target.value)} className="input" placeholder="留空则使用类型名称" />
            </div>
            <div>
              <label className="block text-sm text-gray-700 mb-1">日期</label>
              <input type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} className="input" required />
            </div>
            <div>
              <label className="block text-sm text-gray-700 mb-1">描述</label>
              <textarea value={mDesc} onChange={(e) => setMDesc(e.target.value)} className="input" rows={2} placeholder="可选..." />
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShowMilestoneForm(false)} className="btn-secondary flex-1">取消</button>
              <button type="submit" className="btn-primary flex-1">保存</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
