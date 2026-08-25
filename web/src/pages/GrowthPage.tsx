import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useBaby } from '../contexts/BabyContext';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import type { TranslateFn } from '../i18n';
import { api, generateIdempotencyKey, toStoredMedia, type RecordImage, type UploadMomentResult, type GrowthItem, type MilestoneItem } from '../lib/api';
import { cacheRead, cacheWrite, cacheInvalidate } from '../lib/queryCache';
import { useRefreshHandler } from '../hooks/usePullRefresh';
import { useServerEvent } from '../hooks/useServerEvents';
import { useActivated } from '../hooks/useActivated';
import dayjs from 'dayjs';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Plus, Star, Pencil, Trash2, ImagePlus, X, AlertCircle, Check, Clock, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { Button, Input, Card, CardContent, CardHeader, CardTitle, Badge, Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DatePicker, ConfirmDialog, MediaThumbs, ImageViewer, MediaCover, toViewerImages, useToast } from '../components/ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui';
import { Textarea } from '../components/ui';
import { GrowthSkeleton } from '../components/ui/skeleton';
import { VisibilityPicker } from '../components/ui/visibility-picker';
import { getPercentileData, PercentileData } from '../lib/growth-standards';
import {
  milestoneStandards,
  milestoneCategoryColors,
  getMilestonesForAge,
  evaluateMilestoneTiming,
  formatMonthRange,
  type MilestoneStandard,
} from '../lib/milestone-standards';

const milestoneTypes = [...milestoneStandards.map((s) => s.type), 'custom'];

function uiMilestoneLabel(type: string, t: TranslateFn, fallback?: string): string {
  if (type === 'custom') return t('growth.custom');
  const key = `milestoneItems.${type}`;
  const translated = t(key);
  return translated === key ? (fallback ?? type) : translated;
}

function timingI18nKey(timing: string): string {
  if (timing === 'on_time') return 'onTime';
  if (timing === 'not_yet') return 'notYet';
  return timing;
}

interface MilestonePreview {
  file?: File;
  url: string;
  result?: UploadMomentResult;
  progress?: number;
  error?: boolean;
  cancelled?: boolean;
  type: 'image' | 'video';
  existing?: RecordImage;
  visibleTo?: string[];
}

const M_CONCURRENT = 2;
const M_STEP = 5;

function MUploadRing({ progress, error }: { progress: number; error?: boolean }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  const off = c - (progress / 100) * c;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
      {error ? (
        <AlertCircle size={14} className="text-red-400" />
      ) : (
        <div className="relative w-8 h-8">
          <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
            <circle cx="18" cy="18" r={r} fill="none" stroke="white" strokeWidth="2.5" opacity={0.3} />
            <circle cx="18" cy="18" r={r} fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} className="transition-[stroke-dashoffset] duration-200" />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-white text-[8px] font-semibold">{progress}%</span>
        </div>
      )}
    </div>
  );
}

function recordImageToPreview(img: RecordImage): MilestonePreview {
  return {
    url: img.url,
    type: (img.mediaType === 'video' ? 'video' : 'image') as 'image' | 'video',
    existing: img,
    visibleTo: img.visibleTo,
    result: { url: img.url, key: img.key, rawUrl: img.rawUrl, rawKey: img.rawKey, posterKey: img.posterKey, posterUrl: img.posterUrl, mediaType: img.mediaType || 'image' },
  };
}


function DevelopmentChecklist({
  birthDate,
  milestones,
  onRecord,
  isViewer,
}: {
  birthDate?: string;
  milestones: MilestoneItem[];
  onRecord: (std: MilestoneStandard) => void;
  isViewer: boolean;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(true);

  if (!birthDate) return null;

  const ageMonths = dayjs().diff(dayjs(birthDate), 'month', true);
  const relevant = getMilestonesForAge(ageMonths);

  const achievedTypes = new Set(milestones.map((m) => m.type));
  const achievedMap = new Map<string, MilestoneItem>();
  for (const m of milestones) {
    if (!achievedMap.has(m.type)) achievedMap.set(m.type, m);
  }

  const items = relevant.map((std) => {
    const achieved = achievedMap.get(std.type);
    const achievedAge = achieved ? dayjs(achieved.occurredAt).diff(dayjs(birthDate), 'month', true) : null;
    const timing = evaluateMilestoneTiming(std, achievedAge, ageMonths);
    return { std, achieved: !!achieved, achievedAge, timing };
  });

  const doneCount = items.filter((i) => i.achieved).length;
  const totalCount = items.length;

  const timingIcon = (timing: string) => {
    switch (timing) {
      case 'early': return <Check size={14} className="text-blue-500" />;
      case 'on_time': return <Check size={14} className="text-green-500" />;
      case 'late': return <AlertCircle size={14} className="text-orange-500" />;
      case 'not_yet': return <Clock size={14} className="text-yellow-500" />;
      case 'upcoming': return <Clock size={14} className="text-gray-300 dark:text-gray-600" />;
      default: return null;
    }
  };

  const timingLabel = (timing: string) => t(`growth.timing.${timingI18nKey(timing)}`);

  return (
    <div>
      <button
        className="flex items-center justify-between w-full mb-3 group"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-lg dark:text-gray-100">{t('growth.checklist')}</h3>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {doneCount}/{totalCount}
          </span>
        </div>
        {expanded
          ? <ChevronUp size={18} className="text-gray-400" />
          : <ChevronDown size={18} className="text-gray-400" />
        }
      </button>

      {expanded && (
        <Card>
          <CardContent className="space-y-1 py-2">
            <div className="flex items-center gap-1.5 mb-2 text-[11px] text-gray-400 dark:text-gray-500">
              <Info size={12} />
              <span>{t('growth.checklistHint', { age: ageMonths.toFixed(1) })}</span>
            </div>

            {/* Progress bar */}
            <div className="h-1.5 glass-progress-track rounded-full overflow-hidden mb-3">
              <div
                className="h-full bg-green-400 dark:bg-green-500 rounded-full transition-all duration-500"
                style={{ width: `${totalCount > 0 ? (doneCount / totalCount) * 100 : 0}%` }}
              />
            </div>

            {items.map(({ std, achieved, achievedAge, timing }) => (
              <div
                key={std.type}
                className={`flex items-center gap-3 py-2 px-2 rounded-lg transition-colors ${
                  achieved
                    ? 'glass-info-strip'
                    : timing === 'not_yet' || timing === 'late'
                    ? 'glass-warning-tint'
                    : ''
                }`}
              >
                <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center glass-avatar-placeholder">
                  {timingIcon(timing)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-medium text-sm ${achieved ? 'line-through text-gray-400 dark:text-gray-500' : 'dark:text-gray-100'}`}>
                      {uiMilestoneLabel(std.type, t, std.label)}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${milestoneCategoryColors[std.category]}`}>
                      {t(`growth.cats.${std.category}`)}
                    </span>
                    {std.whoSource && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-indigo-50 text-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-300 font-medium">WHO</span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                    {formatMonthRange(std.earliestMonth, std.latestMonth, t)}
                    {achieved && achievedAge !== null && (
                      <span className="ml-1.5">
                        · {achievedAge < 1
                          ? t('growth.achievedAtDays', { n: Math.round(achievedAge * 30) })
                          : t('growth.achievedAtMonths', { n: achievedAge.toFixed(1) })}
                      </span>
                    )}
                    {!achieved && <span className="ml-1.5">· {timingLabel(timing)}</span>}
                  </div>
                </div>

                {!achieved && !isViewer && (
                  <button
                    onClick={() => onRecord(std)}
                    className="flex-shrink-0 text-xs text-primary-500 hover:text-primary-600 px-2 py-1 rounded glass-icon-btn transition-colors"
                  >
                    {t('growth.recordAction')}
                  </button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function GrowthPage() {
  const { currentBaby } = useBaby();
  const { isViewer } = useAuth();
  const { t } = useI18n();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [growthRecords, setGrowthRecords] = useState<GrowthItem[]>([]);
  const [milestones, setMilestones] = useState<MilestoneItem[]>([]);
  const [showGrowthForm, setShowGrowthForm] = useState(false);
  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [activeChart, setActiveChart] = useState<'weight' | 'height' | 'head'>('weight');
  const [deletingMilestoneId, setDeletingMilestoneId] = useState<string | null>(null);
  const [milestonePage, setMilestonePage] = useState(1);
  const [milestoneHasMore, setMilestoneHasMore] = useState(false);
  const [milestoneLoadingMore, setMilestoneLoadingMore] = useState(false);
  const milestoneSentinelRef = useRef<HTMLDivElement>(null);
  const MILESTONE_PAGE_SIZE = 20;

  const [loading, setLoading] = useState(true);

  const [gDate, setGDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [gHeight, setGHeight] = useState('');
  const [gWeight, setGWeight] = useState('');
  const [gHead, setGHead] = useState('');

  const [mType, setMType] = useState('smile');
  const [mTitle, setMTitle] = useState('');
  const [mDate, setMDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [mDesc, setMDesc] = useState('');
  const [mPreviews, setMPreviews] = useState<MilestonePreview[]>([]);
  const [mUploading, setMUploading] = useState(false);
  const [mViewerOpen, setMViewerOpen] = useState(false);
  const [mViewerIdx, setMViewerIdx] = useState(0);
  const mCancelledRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!currentBaby) {
      setLoading(false);
      return;
    }
    loadData(true);
  }, [currentBaby]);

  // Auto-load milestones when sentinel enters viewport
  useEffect(() => {
    const sentinel = milestoneSentinelRef.current;
    if (!sentinel || !milestoneHasMore || milestoneLoadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && milestoneHasMore && !milestoneLoadingMore) {
          loadMoreMilestones();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [milestoneHasMore, milestoneLoadingMore, milestonePage]);

  const loadData = async (invalidate = false) => {
    if (!currentBaby) return;
    const cKeyGrowth = `/growth?babyId=${currentBaby.id}`;
    const cKeyMilestones = `/milestones?babyId=${currentBaby.id}&page=1&pageSize=${MILESTONE_PAGE_SIZE}`;

    if (invalidate) {
      cacheInvalidate(cKeyGrowth);
      cacheInvalidate(`/milestones`);
    }

    type GRes = { success: boolean; data: { items: GrowthItem[] } | GrowthItem[] };
    type MRes = { success: boolean; data: { items: MilestoneItem[]; hasMore?: boolean } | MilestoneItem[] };
    const extractG = (d: GRes['data']) => Array.isArray(d) ? d : d.items;
    const extractM = (d: MRes['data']) => Array.isArray(d) ? d : d.items;
    const extractMHasMore = (d: MRes['data']) => Array.isArray(d) ? false : !!(d as { hasMore?: boolean }).hasMore;

    const cachedGrowth = cacheRead<GRes>(cKeyGrowth);
    const cachedMilestones = cacheRead<MRes>(cKeyMilestones);
    if (cachedGrowth && cachedMilestones) {
      setGrowthRecords(extractG(cachedGrowth.data));
      setMilestones(extractM(cachedMilestones.data));
      setMilestoneHasMore(extractMHasMore(cachedMilestones.data));
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
      setMilestoneHasMore(extractMHasMore(milestonesRes.data));
      setMilestonePage(1);
    } finally {
      setLoading(false);
    }
  };

  const loadMoreMilestones = async () => {
    if (!currentBaby || milestoneLoadingMore) return;
    const nextPage = milestonePage + 1;
    setMilestoneLoadingMore(true);
    try {
      type MRes = { success: boolean; data: { items: MilestoneItem[]; hasMore?: boolean } | MilestoneItem[] };
      const res = await api.get<MRes>(`/milestones?babyId=${currentBaby.id}&page=${nextPage}&pageSize=${MILESTONE_PAGE_SIZE}`);
      const items = Array.isArray(res.data) ? res.data : res.data.items;
      const more = Array.isArray(res.data) ? false : !!(res.data as { hasMore?: boolean }).hasMore;
      setMilestones((prev) => [...prev, ...items]);
      setMilestoneHasMore(more);
      setMilestonePage(nextPage);
    } finally {
      setMilestoneLoadingMore(false);
    }
  };

  useActivated(useCallback(() => { loadData(true); }, [currentBaby]));
  useRefreshHandler(useCallback(async () => {
    await loadData(true);
  }, [currentBaby]));

  useServerEvent(
    ['growth.created', 'growth.updated', 'growth.deleted', 'milestone.change'],
    useCallback(() => { loadData(true); }, [currentBaby]),
  );

  const addGrowth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBaby) return;
    await api.growth.create({
      babyId: currentBaby.id,
      date: gDate,
      height: gHeight ? +gHeight : undefined,
      weight: gWeight ? +gWeight : undefined,
      headCircumference: gHead ? +gHead : undefined,
    }, generateIdempotencyKey());
    setShowGrowthForm(false);
    setGHeight(''); setGWeight(''); setGHead('');
    loadData(true);
  };

  const [editingMilestone, setEditingMilestone] = useState<MilestoneItem | null>(null);

  const addMilestone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBaby || mUploading) return;
    const completed = mPreviews.filter((p) => p.result && !p.cancelled).map((p) => toStoredMedia(p.result!, { visibleTo: p.visibleTo }));
    await api.milestonesCrud.create({
      babyId: currentBaby.id,
      type: mType,
      title: mTitle || uiMilestoneLabel(mType, t),
      occurredAt: new Date(mDate).toISOString(),
      description: mDesc || undefined,
      images: completed.length > 0 ? completed : undefined,
    }, generateIdempotencyKey());
    setShowMilestoneForm(false);
    setMTitle(''); setMDesc(''); setMPreviews([]);
    loadData(true);
  };

  const openEditMilestone = (m: MilestoneItem) => {
    setEditingMilestone(m);
    setMType(m.type);
    setMTitle(m.title);
    setMDate(dayjs(m.occurredAt).format('YYYY-MM-DD'));
    setMDesc(m.description || '');
    setMPreviews((m.images || []).map(recordImageToPreview));
  };

  const saveMilestone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMilestone || mUploading) return;
    const completed = mPreviews.filter((p) => p.result && !p.cancelled).map((p) => toStoredMedia(p.result!, { visibleTo: p.visibleTo }));
    await api.milestonesCrud.update(editingMilestone.id, {
      type: mType,
      title: mTitle || uiMilestoneLabel(mType, t),
      occurredAt: new Date(mDate).toISOString(),
      description: mDesc || undefined,
      images: completed,
    });
    setEditingMilestone(null);
    setMTitle(''); setMDesc(''); setMPreviews([]);
    loadData(true);
  };

  const deleteMilestone = async (id: string) => {
    try {
      await api.milestonesCrud.delete(id);
      toast(t('growth.deleted'), 'success');
      loadData(true);
    } catch {
      toast(t('growth.deleteFailed'), 'error');
    }
    setDeletingMilestoneId(null);
  };

  const handleMilestoneUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const allowed = Array.from(files);
    const startIdx = mPreviews.length;

    const placeholders: MilestonePreview[] = allowed.map((f) => ({
      file: f, url: '', type: f.type.startsWith('video/') ? 'video' as const : 'image' as const, progress: 0,
    }));
    setMPreviews((prev) => [...prev, ...placeholders]);
    mCancelledRef.current = new Set();
    setMUploading(true);

    for (let i = 0; i < allowed.length; i++) {
      const blobUrl = URL.createObjectURL(allowed[i]);
      setMPreviews((prev) => {
        const next = [...prev]; const idx = startIdx + i;
        if (next[idx]) next[idx] = { ...next[idx], url: blobUrl };
        return next;
      });
    }

    let queueIdx = 0;
    const lastR: number[] = new Array(allowed.length).fill(-1);
    const uploadNext = async (): Promise<void> => {
      const myIdx = queueIdx++;
      if (myIdx >= allowed.length) return;
      const fileIdx = startIdx + myIdx;

      if (mCancelledRef.current.has(fileIdx)) {
        await uploadNext();
        return;
      }

      try {
        const result = await api.milestones.uploadMedia(allowed[myIdx], (pct) => {
          if (mCancelledRef.current.has(fileIdx)) return;
          const stepped = Math.floor(pct / M_STEP) * M_STEP;
          if (stepped <= lastR[myIdx]) return;
          lastR[myIdx] = stepped;
          setMPreviews((prev) => { const n = [...prev]; if (n[fileIdx]) n[fileIdx] = { ...n[fileIdx], progress: stepped }; return n; });
        });
        if (!mCancelledRef.current.has(fileIdx)) {
          setMPreviews((prev) => { const n = [...prev]; if (n[fileIdx]) n[fileIdx] = { ...n[fileIdx], result, progress: undefined }; return n; });
        }
      } catch {
        if (!mCancelledRef.current.has(fileIdx)) {
          setMPreviews((prev) => { const n = [...prev]; if (n[fileIdx]) n[fileIdx] = { ...n[fileIdx], error: true, progress: undefined }; return n; });
        }
      }
      await uploadNext();
    };
    await Promise.all(Array.from({ length: Math.min(M_CONCURRENT, allowed.length) }, () => uploadNext()));
    setMUploading(false);
  }, [mPreviews.length]);

  const removeMPreview = useCallback((idx: number) => {
    mCancelledRef.current.add(idx);
    setMPreviews((prev) => {
      const next = [...prev];
      if (next[idx]) {
        if (next[idx].file) URL.revokeObjectURL(next[idx].url);
        next[idx] = { ...next[idx], cancelled: true };
      }
      return next;
    });
  }, []);

  const mUploadingCount = mPreviews.filter(
    (p) => p.file && !p.result && !p.error && !p.cancelled,
  ).length;

  const openMPreview = (p: MilestonePreview) => {
    const viewable = mPreviews.filter((x) => !x.cancelled && x.url);
    const idx = viewable.findIndex((x) => x === p);
    if (idx >= 0) {
      setMViewerIdx(idx);
      setMViewerOpen(true);
    }
  };

  useEffect(() => {
    if (mUploading && mUploadingCount === 0) {
      setMUploading(false);
    }
  }, [mUploading, mUploadingCount]);

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
        label: days < 90 ? t('age.days', { n: days }) : t('age.monthsShort', { n: +(days / 30.44).toFixed(1) }),
        p3: interpolatePercentile(days, 'p3'),
        p15: interpolatePercentile(days, 'p15'),
        p50: interpolatePercentile(days, 'p50'),
        p85: interpolatePercentile(days, 'p85'),
        p97: interpolatePercentile(days, 'p97'),
        value: baby?.value ?? null,
      };
    });
  }, [growthRecords, activeChart, gender, birthDate, t]);

  const chartConfig = {
    weight: { label: t('growth.weight'), color: '#f19232', key: 'value' },
    height: { label: t('growth.height'), color: '#10b981', key: 'value' },
    head: { label: t('growth.head'), color: '#6366f1', key: 'head' },
  };

  if (loading && growthRecords.length === 0 && milestones.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold dark:text-gray-100">{t('growth.title')}</h2>
        <GrowthSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold dark:text-gray-100">{t('growth.title')}</h2>

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
                  tickFormatter={(days: number) => days < 90 ? t('age.days', { n: days }) : t('age.monthsShort', { n: Math.round(days / 30.44) })}
                  label={{ value: activeChart === 'head' ? t('growth.dayAge') : t('growth.dayMonthAge'), position: 'insideBottom', offset: -10, fontSize: 11, fill: 'var(--chart-axis)' }}
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
                    return t('age.daysMonths', { days, months });
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
                  name={t('growth.baby')}
                  animationDuration={300}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-center text-gray-400 py-8">{t('growth.noData')}</p>
          )}

          <div className="flex gap-2 mt-4">
            {growthRecords.length > 0 && (
              <Button variant="outline" className="flex-1" asChild>
                <Link to="/growth/history">{t('common.history')} ({growthRecords.length})</Link>
              </Button>
            )}
            <Dialog open={showGrowthForm} onOpenChange={setShowGrowthForm}>
              {!isViewer && (
              <DialogTrigger asChild>
                <Button variant="outline" className="flex-1">
                  <Plus size={16} /> {t('growth.recordData')}
                </Button>
              </DialogTrigger>
              )}
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>{t('growth.recordVitals')}</DialogTitle>
              </DialogHeader>
              <form onSubmit={addGrowth} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('common.date')}</label>
                  <DatePicker value={gDate} onChange={setGDate} placeholder={t('growth.pickDate')} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('growth.weight')}</label>
                  <Input type="number" value={gWeight} onChange={(e) => setGWeight(e.target.value)} step="0.1" placeholder={t('growth.placeholderWeight')} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('growth.height')}</label>
                  <Input type="number" value={gHeight} onChange={(e) => setGHeight(e.target.value)} step="0.1" placeholder={t('growth.placeholderHeight')} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('growth.head')}</label>
                  <Input type="number" value={gHead} onChange={(e) => setGHead(e.target.value)} step="0.1" placeholder={t('growth.placeholderHead')} />
                </div>
                <div className="flex gap-3">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setShowGrowthForm(false)}>{t('common.cancel')}</Button>
                  <Button type="submit" className="flex-1">{t('common.save')}</Button>
                </div>
              </form>
            </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      {/* WHO Development Checklist */}
      <DevelopmentChecklist
        birthDate={birthDate}
        milestones={milestones}
        onRecord={(std) => {
          setMType(std.type);
          setMTitle(uiMilestoneLabel(std.type, t, std.label));
          setMDate(dayjs().format('YYYY-MM-DD'));
          setMDesc('');
          setMPreviews([]);
          setShowMilestoneForm(true);
        }}
        isViewer={isViewer}
      />

      {/* Milestones */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-lg dark:text-gray-100">{t('growth.milestones')}</h3>
          <Dialog open={showMilestoneForm} onOpenChange={setShowMilestoneForm}>
            {!isViewer && (
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm">
                <Plus size={14} /> {t('common.add')}
              </Button>
            </DialogTrigger>
            )}
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>{t('growth.addMilestone')}</DialogTitle>
              </DialogHeader>
              <form onSubmit={addMilestone} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('common.type')}</label>
                  <Select value={mType} onValueChange={setMType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {milestoneTypes.map((k) => (
                        <SelectItem key={k} value={k}>{uiMilestoneLabel(k, t)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('common.title')}</label>
                  <Input value={mTitle} onChange={(e) => setMTitle(e.target.value)} placeholder={t('growth.titlePlaceholder')} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('common.date')}</label>
                  <DatePicker value={mDate} onChange={setMDate} placeholder={t('growth.pickDate')} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('common.description')}</label>
                  <Textarea value={mDesc} onChange={(e) => setMDesc(e.target.value)} placeholder={t('growth.descPlaceholder')} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('common.photosVideos')}</label>
                  <div className="flex flex-wrap gap-2">
                    {mPreviews.map((p, idx) => p.cancelled ? null : (
                      <div key={idx} className="relative w-16 h-16 rounded-lg overflow-hidden glass-media-thumb">
                        {!p.url ? null : (
                          <MediaCover src={p.url} mediaType={p.type} posterSrc={p.result?.posterUrl} className="w-full h-full" playSize={14} onClick={() => openMPreview(p)} />
                        )}
                        {p.file && !p.result && <MUploadRing progress={p.progress ?? 0} error={p.error} />}
                        <button type="button" onClick={() => removeMPreview(idx)} className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 rounded-full flex items-center justify-center">
                          <X size={10} className="text-white" />
                        </button>
                        {p.result && (
                          <div className="absolute bottom-0.5 left-0.5">
                            <VisibilityPicker
                              value={p.visibleTo}
                              onChange={(vt) => setMPreviews((prev) => prev.map((item, i) => i === idx ? { ...item, visibleTo: vt } : item))}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                    <label className="w-16 h-16 rounded-lg glass-upload-zone flex items-center justify-center cursor-pointer transition-colors">
                      <input type="file" accept="image/*,video/*" className="hidden" multiple disabled={mUploading} onChange={(e) => { handleMilestoneUpload(e.target.files); e.target.value = ''; }} />
                      {mUploading && mUploadingCount > 0 ? <span className="text-[10px] text-gray-400 animate-pulse">{t('common.uploading')}</span> : <ImagePlus size={16} className="text-gray-400" />}
                    </label>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => { setShowMilestoneForm(false); setMPreviews([]); }}>{t('common.cancel')}</Button>
                  <Button type="submit" className="flex-1" disabled={mUploading}>{t('common.save')}</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {milestones.length === 0 ? (
          <p className="text-center text-gray-400 py-6">{t('growth.noMilestones')}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {milestones.map((m) => {
              const std = milestoneStandards.find((s) => s.type === m.type);
              const achievedAge = birthDate ? dayjs(m.occurredAt).diff(dayjs(birthDate), 'month', true) : null;
              const timing = std && achievedAge !== null ? evaluateMilestoneTiming(std, achievedAge, 0) : null;
              const timingBadge = timing === 'early'
                ? { text: t('growth.timing.earlyShort'), cls: 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300' }
                : timing === 'on_time'
                ? { text: t('growth.timing.normalShort'), cls: 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-300' }
                : timing === 'late'
                ? { text: t('growth.timing.lateShort'), cls: 'bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300' }
                : null;
              return (
              <Card key={m.id}>
                <CardContent className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-yellow-50 dark:bg-yellow-900/30 flex items-center justify-center flex-shrink-0">
                    <Star size={18} className="text-yellow-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-base dark:text-gray-100">{m.title}</h4>
                      {timingBadge && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${timingBadge.cls}`}>{timingBadge.text}</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-400 dark:text-gray-500">
                      {dayjs(m.occurredAt).format('YYYY-MM-DD')}
                      {achievedAge !== null && (
                        <span className="ml-1.5">
                          {achievedAge < 1
                            ? t('growth.achievedAgeDays', { n: Math.round(achievedAge * 30) })
                            : t('growth.achievedAgeMonths', { n: achievedAge.toFixed(1) })}
                        </span>
                      )}
                    </p>
                    {std && (
                      <p className="text-[11px] text-gray-400 dark:text-gray-500">
                        {std.whoSource
                          ? t('growth.whoRef', { range: formatMonthRange(std.earliestMonth, std.latestMonth, t) })
                          : t('growth.ref', { range: formatMonthRange(std.earliestMonth, std.latestMonth, t) })}
                      </p>
                    )}
                    {m.description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{m.description}</p>}
                    {m.images && m.images.length > 0 && (
                      <MediaThumbs
                        images={toViewerImages(m.images)}
                        className="mt-1.5"
                        thumbClassName="w-10 h-10 rounded"
                        max={3}
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {!isViewer && (
                    <>
                    <button
                      onClick={() => openEditMilestone(m)}
                      className="p-1.5 rounded-md text-gray-400 hover:text-primary-500 glass-icon-btn transition-colors"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => setDeletingMilestoneId(m.id)}
                      className="p-1.5 rounded-md text-gray-400 hover:text-red-500 glass-icon-btn transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                    </>
                    )}
                  </div>
                </CardContent>
              </Card>
              );
            })}
          </div>
        )}
        {milestoneLoadingMore && (
          <div className="flex justify-center py-4">
            <div className="w-5 h-5 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {milestoneHasMore && !milestoneLoadingMore && (
          <div ref={milestoneSentinelRef} className="h-4" />
        )}
        {!milestoneHasMore && milestones.length > 0 && !milestoneLoadingMore && (
          <div className="py-4 text-center text-xs text-gray-300 dark:text-gray-600">
            {t('growth.loadedAll')}
          </div>
        )}

        {/* Edit Milestone Dialog */}
        <Dialog open={!!editingMilestone} onOpenChange={(open) => { if (!open) setEditingMilestone(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{t('growth.editMilestone')}</DialogTitle>
            </DialogHeader>
            <form onSubmit={saveMilestone} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('common.type')}</label>
                <Select value={mType} onValueChange={setMType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {milestoneTypes.map((k) => (
                      <SelectItem key={k} value={k}>{uiMilestoneLabel(k, t)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('common.title')}</label>
                <Input value={mTitle} onChange={(e) => setMTitle(e.target.value)} placeholder={t('growth.titlePlaceholder')} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('common.date')}</label>
                <DatePicker value={mDate} onChange={setMDate} placeholder={t('growth.pickDate')} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('common.description')}</label>
                <Textarea value={mDesc} onChange={(e) => setMDesc(e.target.value)} placeholder={t('growth.descPlaceholder')} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('common.photosVideos')}</label>
                <div className="flex flex-wrap gap-2">
                  {mPreviews.map((p, idx) => p.cancelled ? null : (
                    <div key={idx} className="relative w-16 h-16 rounded-lg overflow-hidden glass-media-thumb">
                      {!p.url ? null : (
                        <MediaCover src={p.url} mediaType={p.type} posterSrc={p.result?.posterUrl} className="w-full h-full" playSize={14} onClick={() => openMPreview(p)} />
                      )}
                      {p.file && !p.result && <MUploadRing progress={p.progress ?? 0} error={p.error} />}
                      <button type="button" onClick={() => removeMPreview(idx)} className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 rounded-full flex items-center justify-center">
                        <X size={10} className="text-white" />
                      </button>
                      {p.result && (
                        <div className="absolute bottom-0.5 left-0.5">
                          <VisibilityPicker
                            value={p.visibleTo}
                            onChange={(vt) => setMPreviews((prev) => prev.map((item, i) => i === idx ? { ...item, visibleTo: vt } : item))}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                  <label className="w-16 h-16 rounded-lg glass-upload-zone flex items-center justify-center cursor-pointer transition-colors">
                    <input type="file" accept="image/*,video/*" className="hidden" multiple disabled={mUploading} onChange={(e) => { handleMilestoneUpload(e.target.files); e.target.value = ''; }} />
                    {mUploading && mUploadingCount > 0 ? <span className="text-[10px] text-gray-400 animate-pulse">{t('common.uploading')}</span> : <ImagePlus size={16} className="text-gray-400" />}
                  </label>
                </div>
              </div>
              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={() => { setEditingMilestone(null); setMPreviews([]); }}>{t('common.cancel')}</Button>
                <Button type="submit" className="flex-1" disabled={mUploading}>{t('common.save')}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <ImageViewer
        images={mPreviews
          .filter((p) => !p.cancelled && p.url)
          .map((p) => ({ url: p.result?.url || p.url, rawUrl: p.result?.rawUrl, mediaType: p.type }))}
        initialIndex={mViewerIdx}
        open={mViewerOpen}
        onOpenChange={setMViewerOpen}
      />
      <ConfirmDialog
        open={!!deletingMilestoneId}
        onOpenChange={(open) => { if (!open) setDeletingMilestoneId(null); }}
        title={t('growth.deleteTitle')}
        description={t('growth.deleteDesc')}
        confirmLabel={t('common.delete')}
        variant="danger"
        onConfirm={() => deletingMilestoneId && deleteMilestone(deletingMilestoneId)}
      />
    </div>
  );
}
