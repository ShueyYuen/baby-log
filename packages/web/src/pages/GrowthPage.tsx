import { useState, useEffect } from 'react';
import { useBaby } from '../contexts/BabyContext';
import { api } from '../lib/api';
import dayjs from 'dayjs';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Plus, Star } from 'lucide-react';
import { Button, Input, Card, CardContent, CardHeader, CardTitle, Badge, Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DatePicker } from '../components/ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui';
import { Textarea } from '../components/ui';

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

  const [gDate, setGDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [gHeight, setGHeight] = useState('');
  const [gWeight, setGWeight] = useState('');
  const [gHead, setGHead] = useState('');

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
      <h2 className="text-xl font-semibold dark:text-gray-100">成长记录</h2>

      {/* Growth Chart */}
      <Card>
        <CardContent>
          <div className="flex gap-2 mb-4">
            {Object.entries(chartConfig).map(([key, cfg]) => (
              <Button
                key={key}
                variant={activeChart === key ? 'default' : 'secondary'}
                size="sm"
                onClick={() => setActiveChart(key as any)}
              >
                {cfg.label}
              </Button>
            ))}
          </div>

          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid, #e5e7eb)" />
                <XAxis dataKey="date" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--tooltip-bg, white)',
                    border: '1px solid var(--tooltip-border, #e5e7eb)',
                    borderRadius: '8px',
                  }}
                />
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

          <Dialog open={showGrowthForm} onOpenChange={setShowGrowthForm}>
            <DialogTrigger asChild>
              <Button variant="outline" className="w-full mt-4">
                <Plus size={16} /> 记录生理数据
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-sm mx-4">
              <DialogHeader>
                <DialogTitle>记录生理数据</DialogTitle>
              </DialogHeader>
              <form onSubmit={addGrowth} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">日期</label>
                  <DatePicker value={gDate} onChange={setGDate} placeholder="选择日期" />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">体重(kg)</label>
                  <Input type="number" value={gWeight} onChange={(e) => setGWeight(e.target.value)} step="0.1" placeholder="如：3.5" />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">身高(cm)</label>
                  <Input type="number" value={gHeight} onChange={(e) => setGHeight(e.target.value)} step="0.1" placeholder="如：50" />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">头围(cm)</label>
                  <Input type="number" value={gHead} onChange={(e) => setGHead(e.target.value)} step="0.1" placeholder="如：34" />
                </div>
                <div className="flex gap-3">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setShowGrowthForm(false)}>取消</Button>
                  <Button type="submit" className="flex-1">保存</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      {/* Milestones */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-lg dark:text-gray-100">里程碑</h3>
          <Dialog open={showMilestoneForm} onOpenChange={setShowMilestoneForm}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm">
                <Plus size={14} /> 添加
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-sm mx-4">
              <DialogHeader>
                <DialogTitle>记录里程碑</DialogTitle>
              </DialogHeader>
              <form onSubmit={addMilestone} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">类型</label>
                  <Select value={mType} onValueChange={setMType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(milestoneLabels).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">标题</label>
                  <Input value={mTitle} onChange={(e) => setMTitle(e.target.value)} placeholder="留空则使用类型名称" />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">日期</label>
                  <DatePicker value={mDate} onChange={setMDate} placeholder="选择日期" />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">描述</label>
                  <Textarea value={mDesc} onChange={(e) => setMDesc(e.target.value)} placeholder="可选..." />
                </div>
                <div className="flex gap-3">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setShowMilestoneForm(false)}>取消</Button>
                  <Button type="submit" className="flex-1">保存</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {milestones.length === 0 ? (
          <p className="text-center text-gray-400 py-6">暂无里程碑记录</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {milestones.map((m) => (
              <Card key={m.id}>
                <CardContent className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-yellow-50 dark:bg-yellow-900/30 flex items-center justify-center flex-shrink-0">
                    <Star size={18} className="text-yellow-500" />
                  </div>
                  <div>
                    <h4 className="font-medium text-sm dark:text-gray-100">{m.title}</h4>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{dayjs(m.occurredAt).format('YYYY-MM-DD')}</p>
                    {m.description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{m.description}</p>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
