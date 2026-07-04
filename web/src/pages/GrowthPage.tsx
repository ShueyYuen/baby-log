import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useBaby } from '../contexts/BabyContext';
import { useAuth } from '../contexts/AuthContext';
import { api, type RecordImage } from '../lib/api';
import { cacheRead, cacheWrite, cacheInvalidate } from '../lib/queryCache';
import dayjs from 'dayjs';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Plus, Star, Pencil, Trash2, ImagePlus, Play, X } from 'lucide-react';
import { Button, Input, Card, CardContent, CardHeader, CardTitle, Badge, Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DatePicker, ConfirmDialog, useToast } from '../components/ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui';
import { Textarea } from '../components/ui';
import { GrowthSkeleton } from '../components/ui/skeleton';
import { getPercentileData, PercentileData } from '../lib/growth-standards';

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
  images?: RecordImage[];
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
  const { isViewer } = useAuth();
  const { toast } = useToast();
  const [growthRecords, setGrowthRecords] = useState<GrowthItem[]>([]);
  const [milestones, setMilestones] = useState<MilestoneItem[]>([]);
  const [showGrowthForm, setShowGrowthForm] = useState(false);
  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [activeChart, setActiveChart] = useState<'weight' | 'height' | 'head'>('weight');
  const [deletingMilestoneId, setDeletingMilestoneId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);

  const [gDate, setGDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [gHeight, setGHeight] = useState('');
  const [gWeight, setGWeight] = useState('');
  const [gHead, setGHead] = useState('');

  const [mType, setMType] = useState('smile');
  const [mTitle, setMTitle] = useState('');
  const [mDate, setMDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [mDesc, setMDesc] = useState('');
  const [mImages, setMImages] = useState<RecordImage[]>([]);
  const [mUploading, setMUploading] = useState(false);

  useEffect(() => {
    if (!currentBaby) return;
    loadData(true);
  }, [currentBaby]);

  const loadData = async (invalidate = false) => {
    if (!currentBaby) return;
    const cKeyGrowth = `/growth?babyId=${currentBaby.id}`;
    const cKeyMilestones = `/milestones?babyId=${currentBaby.id}`;

    if (invalidate) {
      cacheInvalidate(cKeyGrowth);
      cacheInvalidate(cKeyMilestones);
    }

    type GRes = { success: boolean; data: { items: GrowthItem[] } | GrowthItem[] };
    type MRes = { success: boolean; data: { items: MilestoneItem[] } | MilestoneItem[] };
    const extractG = (d: GRes['data']) => Array.isArray(d) ? d : d.items;
    const extractM = (d: MRes['data']) => Array.isArray(d) ? d : d.items;

    const cachedGrowth = cacheRead<GRes>(cKeyGrowth);
    const cachedMilestones = cacheRead<MRes>(cKeyMilestones);
    if (cachedGrowth && cachedMilestones) {
      setGrowthRecords(extractG(cachedGrowth.data));
      setMilestones(extractM(cachedMilestones.data));
      setLoading(false);
    }

    try {
      const [growthRes, milestonesRes] = await Promise.all([
        api.get<GRes>(cKeyGrowth),
        api.get<MRes>(cKeyMilestones),
      ]);
      cacheWrite(cKeyGrowth, growthRes);
      cacheWrite(cKeyMilestones, milestonesRes);
      setGrowthRecords(extractG(growthRes.data));
      setMilestones(extractM(milestonesRes.data));
    } finally {
      setLoading(false);
    }
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
    loadData(true);
  };

  const [editingMilestone, setEditingMilestone] = useState<MilestoneItem | null>(null);

  const addMilestone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBaby || mUploading) return;
    await api.post('/milestones', {
      babyId: currentBaby.id,
      type: mType,
      title: mTitle || milestoneLabels[mType],
      occurredAt: new Date(mDate).toISOString(),
      description: mDesc || undefined,
      images: mImages.length > 0 ? mImages.map((img) => ({ key: img.key, rawKey: img.rawKey, mediaType: img.mediaType })) : undefined,
    });
    setShowMilestoneForm(false);
    setMTitle(''); setMDesc(''); setMImages([]);
    loadData(true);
  };

  const openEditMilestone = (m: MilestoneItem) => {
    setEditingMilestone(m);
    setMType(m.type);
    setMTitle(m.title);
    setMDate(dayjs(m.occurredAt).format('YYYY-MM-DD'));
    setMDesc(m.description || '');
    setMImages(m.images || []);
  };

  const saveMilestone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMilestone || mUploading) return;
    await api.put(`/milestones/${editingMilestone.id}`, {
      type: mType,
      title: mTitle || milestoneLabels[mType],
      occurredAt: new Date(mDate).toISOString(),
      description: mDesc || undefined,
      images: mImages.map((img) => ({ key: img.key, rawKey: img.rawKey, mediaType: img.mediaType })),
    });
    setEditingMilestone(null);
    setMTitle(''); setMDesc(''); setMImages([]);
    loadData(true);
  };

  const deleteMilestone = async (id: string) => {
    try {
      await api.delete(`/milestones/${id}`);
      toast('里程碑已删除', 'success');
      loadData(true);
    } catch {
      toast('删除失败', 'error');
    }
    setDeletingMilestoneId(null);
  };

  const handleMilestoneUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setMUploading(true);
    try {
      const newItems: RecordImage[] = [];
      for (const file of Array.from(files)) {
        const result = await api.moments.uploadMediaSingle(file);
        newItems.push({ key: result.key, rawKey: result.rawKey, mediaType: result.mediaType, url: result.url, rawUrl: result.rawUrl });
      }
      setMImages((prev) => [...prev, ...newItems]);
    } catch {
      toast('上传失败', 'error');
    } finally {
      setMUploading(false);
    }
  };

  const gender = (currentBaby?.gender === 'female' ? 'female' : 'male') as 'male' | 'female';
  const birthDate = currentBaby?.birthDate;

  const chartData = useMemo(() => {
    if (!birthDate) return [];

    const birth = dayjs(birthDate);

    if (activeChart === 'head') {
      return [...growthRecords]
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .filter((r) => r.headCircumference != null)
        .map((r) => {
          const days = dayjs(r.date).diff(birth, 'day');
          return { days, month: +(days / 30.44).toFixed(1), head: r.headCircumference };
        });
    }

    const percentiles = getPercentileData(gender, activeChart === 'weight' ? 'weight' : 'height');

    const babyPoints = [...growthRecords]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((r) => {
        const days = dayjs(r.date).diff(birth, 'day');
        return { days, value: activeChart === 'weight' ? r.weight : r.height };
      })
      .filter((r) => r.value != null);

    const maxDays = Math.max(...babyPoints.map((p) => p.days), 365);
    const maxMonth = Math.ceil(maxDays / 30.44) + 1;
    const relevantPercentiles = percentiles.filter((p) => p.month <= maxMonth);

    const interpolatePercentile = (days: number, key: keyof PercentileData) => {
      const monthAge = days / 30.44;
      const lowerIdx = Math.floor(monthAge);
      const upperIdx = Math.ceil(monthAge);
      if (lowerIdx >= relevantPercentiles.length) return null;
      if (upperIdx >= relevantPercentiles.length) return relevantPercentiles[lowerIdx]?.[key] ?? null;
      if (lowerIdx === upperIdx) return relevantPercentiles[lowerIdx][key];
      const fraction = monthAge - lowerIdx;
      const lower = relevantPercentiles.find((p) => p.month === lowerIdx);
      const upper = relevantPercentiles.find((p) => p.month === upperIdx);
      if (!lower || !upper) return null;
      return +(lower[key] + (upper[key] - lower[key]) * fraction).toFixed(2);
    };

    const allDays = new Set<number>();
    relevantPercentiles.forEach((p) => allDays.add(Math.round(p.month * 30.44)));
    babyPoints.forEach((p) => allDays.add(p.days));

    const sortedDays = [...allDays].sort((a, b) => a - b);

    return sortedDays.map((days) => {
      const baby = babyPoints.find((b) => b.days === days);
      return {
        days,
        label: days < 90 ? `${days}天` : `${+(days / 30.44).toFixed(1)}月`,
        p3: interpolatePercentile(days, 'p3'),
        p15: interpolatePercentile(days, 'p15'),
        p50: interpolatePercentile(days, 'p50'),
        p85: interpolatePercentile(days, 'p85'),
        p97: interpolatePercentile(days, 'p97'),
        value: baby?.value ?? null,
      };
    });
  }, [growthRecords, activeChart, gender, birthDate]);

  const chartConfig = {
    weight: { label: '体重(kg)', color: '#f19232', key: 'value' },
    height: { label: '身高(cm)', color: '#10b981', key: 'value' },
    head: { label: '头围(cm)', color: '#6366f1', key: 'head' },
  };

  if (loading && growthRecords.length === 0 && milestones.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold dark:text-gray-100">成长记录</h2>
        <GrowthSkeleton />
      </div>
    );
  }

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
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis
                  dataKey="days"
                  type="number"
                  fontSize={11}
                  tick={{ fill: 'var(--chart-axis)' }}
                  tickFormatter={(days: number) => days < 90 ? `${days}天` : `${Math.round(days / 30.44)}月`}
                  label={{ value: activeChart === 'head' ? '日龄' : '日龄/月龄', position: 'insideBottom', offset: -10, fontSize: 11, fill: 'var(--chart-axis)' }}
                  domain={[0, 'dataMax']}
                />
                <YAxis fontSize={12} domain={['dataMin - 1', 'dataMax + 1']} tick={{ fill: 'var(--chart-axis)' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--chart-tooltip-bg)',
                    border: '1px solid var(--chart-tooltip-border)',
                    borderRadius: '8px',
                    color: 'var(--chart-tooltip-text)',
                  }}
                  labelFormatter={(days: number) => {
                    const months = +(days / 30.44).toFixed(1);
                    return `${days}天 (${months}月)`;
                  }}
                />
                {activeChart !== 'head' && (
                  <>
                    <Line type="monotone" dataKey="p97" stroke="#e5e7eb" strokeWidth={1} strokeDasharray="3 3" dot={false} name="P97" animationDuration={300} />
                    <Line type="monotone" dataKey="p85" stroke="#d1d5db" strokeWidth={1} strokeDasharray="3 3" dot={false} name="P85" animationDuration={300} />
                    <Line type="monotone" dataKey="p50" stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="P50" animationDuration={300} />
                    <Line type="monotone" dataKey="p15" stroke="#d1d5db" strokeWidth={1} strokeDasharray="3 3" dot={false} name="P15" animationDuration={300} />
                    <Line type="monotone" dataKey="p3" stroke="#e5e7eb" strokeWidth={1} strokeDasharray="3 3" dot={false} name="P3" animationDuration={300} />
                  </>
                )}
                <Line
                  type="monotone"
                  dataKey={chartConfig[activeChart].key}
                  stroke={chartConfig[activeChart].color}
                  strokeWidth={2.5}
                  dot={{ r: 5, strokeWidth: 2 }}
                  connectNulls
                  name="宝宝"
                  animationDuration={300}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-center text-gray-400 py-8">暂无数据</p>
          )}

          <div className="flex gap-2 mt-4">
            {growthRecords.length > 0 && (
              <Button variant="outline" className="flex-1" asChild>
                <Link to="/growth/history">历史 ({growthRecords.length})</Link>
              </Button>
            )}
            <Dialog open={showGrowthForm} onOpenChange={setShowGrowthForm}>
              {!isViewer && (
              <DialogTrigger asChild>
                <Button variant="outline" className="flex-1">
                  <Plus size={16} /> 记录数据
                </Button>
              </DialogTrigger>
              )}
            <DialogContent className="w-[calc(100%-2rem)] max-w-sm">
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
          </div>
        </CardContent>
      </Card>

      {/* Milestones */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-lg dark:text-gray-100">里程碑</h3>
          <Dialog open={showMilestoneForm} onOpenChange={setShowMilestoneForm}>
            {!isViewer && (
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm">
                <Plus size={14} /> 添加
              </Button>
            </DialogTrigger>
            )}
            <DialogContent className="w-[calc(100%-2rem)] max-w-sm">
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
                <div>
                  <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">图片 / 视频</label>
                  <div className="flex flex-wrap gap-2">
                    {mImages.map((img, idx) => (
                      <div key={idx} className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600">
                        {img.mediaType === 'video' ? (
                          <div className="w-full h-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center"><Play size={16} className="text-gray-500" /></div>
                        ) : (
                          <img src={img.url} alt="" className="w-full h-full object-cover" />
                        )}
                        <button type="button" onClick={() => setMImages((prev) => prev.filter((_, i) => i !== idx))} className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 rounded-full flex items-center justify-center">
                          <X size={10} className="text-white" />
                        </button>
                      </div>
                    ))}
                    <label className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center cursor-pointer hover:border-primary-400 transition-colors">
                      <input type="file" accept="image/*,video/*" className="hidden" multiple disabled={mUploading} onChange={(e) => { handleMilestoneUpload(e.target.files); e.target.value = ''; }} />
                      {mUploading ? <span className="text-[10px] text-gray-400">上传中</span> : <ImagePlus size={16} className="text-gray-400" />}
                    </label>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => { setShowMilestoneForm(false); setMImages([]); }}>取消</Button>
                  <Button type="submit" className="flex-1" disabled={mUploading}>保存</Button>
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
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-sm dark:text-gray-100">{m.title}</h4>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{dayjs(m.occurredAt).format('YYYY-MM-DD')}</p>
                    {m.description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{m.description}</p>}
                    {m.images && m.images.length > 0 && (
                      <div className="flex gap-1 mt-1.5">
                        {m.images.slice(0, 3).map((img, i) => (
                          img.mediaType === 'video' ? (
                            <div key={i} className="w-10 h-10 rounded bg-gray-200 dark:bg-gray-700 flex items-center justify-center"><Play size={12} className="text-gray-500" /></div>
                          ) : (
                            <img key={i} src={img.url} alt="" className="w-10 h-10 rounded object-cover" />
                          )
                        ))}
                        {m.images.length > 3 && (
                          <span className="w-10 h-10 rounded bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-xs text-gray-500">+{m.images.length - 3}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {!isViewer && (
                    <>
                    <button
                      onClick={() => openEditMilestone(m)}
                      className="p-1.5 rounded-md text-gray-400 hover:text-primary-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => setDeletingMilestoneId(m.id)}
                      className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                    </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Edit Milestone Dialog */}
        <Dialog open={!!editingMilestone} onOpenChange={(open) => { if (!open) setEditingMilestone(null); }}>
          <DialogContent className="w-[calc(100%-2rem)] max-w-sm">
            <DialogHeader>
              <DialogTitle>编辑里程碑</DialogTitle>
            </DialogHeader>
            <form onSubmit={saveMilestone} className="space-y-4">
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
              <div>
                <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">图片 / 视频</label>
                <div className="flex flex-wrap gap-2">
                  {mImages.map((img, idx) => (
                    <div key={idx} className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600">
                      {img.mediaType === 'video' ? (
                        <div className="w-full h-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center"><Play size={16} className="text-gray-500" /></div>
                      ) : (
                        <img src={img.url} alt="" className="w-full h-full object-cover" />
                      )}
                      <button type="button" onClick={() => setMImages((prev) => prev.filter((_, i) => i !== idx))} className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 rounded-full flex items-center justify-center">
                        <X size={10} className="text-white" />
                      </button>
                    </div>
                  ))}
                  <label className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center cursor-pointer hover:border-primary-400 transition-colors">
                    <input type="file" accept="image/*,video/*" className="hidden" multiple disabled={mUploading} onChange={(e) => { handleMilestoneUpload(e.target.files); e.target.value = ''; }} />
                    {mUploading ? <span className="text-[10px] text-gray-400">上传中</span> : <ImagePlus size={16} className="text-gray-400" />}
                  </label>
                </div>
              </div>
              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={() => { setEditingMilestone(null); setMImages([]); }}>取消</Button>
                <Button type="submit" className="flex-1" disabled={mUploading}>保存</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <ConfirmDialog
        open={!!deletingMilestoneId}
        onOpenChange={(open) => { if (!open) setDeletingMilestoneId(null); }}
        title="删除里程碑"
        description="确定删除此里程碑？此操作不可撤销。"
        confirmLabel="删除"
        variant="danger"
        onConfirm={() => deletingMilestoneId && deleteMilestone(deletingMilestoneId)}
      />
    </div>
  );
}
