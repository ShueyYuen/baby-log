import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useBaby } from '../contexts/BabyContext';
import { useAuth } from '../contexts/AuthContext';
import { api, generateIdempotencyKey, type TimelineResponse, type TimelineRecord, type TimelineSummary, type FeedingPrediction } from '../lib/api';
import { cacheRead, cacheReadAsync, cacheWrite, cacheInvalidate } from '../lib/queryCache';
import { useRefreshHandler } from '../hooks/usePullRefresh';
import { useServerEvent } from '../hooks/useServerEvents';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import { Droplets, Moon, Baby, Pill, Bath, Apple, Milk, GlassWater, Plus, X, Gamepad2, Thermometer, Heart, Bell, BellOff, AlarmClock, Square, Play, Search } from 'lucide-react';
import { ImageViewer, useToast, type ViewerImage } from '../components/ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui';
import { TimelineSkeleton } from '../components/ui/skeleton';
import { TwoPhaseTypeButton } from '../components/TwoPhaseTypeButton';
import { isPushSupported, subscribePush, isSubscribed } from '../lib/push';
import { addFeedingReminderToCalendar } from '../lib/calendar';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

type RecordItem = TimelineRecord;

const typeConfig: Record<string, { label: string; icon: any; color: string }> = {
  breastfeed: { label: '母乳', icon: Heart, color: 'text-pink-500 bg-pink-50 dark:bg-pink-950/40' },
  bottle: { label: '瓶喂', icon: Milk, color: 'text-blue-500 bg-blue-50 dark:bg-blue-950/40' },
  solid: { label: '辅食', icon: Apple, color: 'text-green-500 bg-green-50 dark:bg-green-950/40' },
  water: { label: '喝水', icon: GlassWater, color: 'text-cyan-500 bg-cyan-50 dark:bg-cyan-950/40' },
  diaper: { label: '换尿布', icon: Droplets, color: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-950/40' },
  bath: { label: '洗澡', icon: Bath, color: 'text-teal-500 bg-teal-50 dark:bg-teal-950/40' },
  supplement: { label: '营养补充', icon: Pill, color: 'text-purple-500 bg-purple-50 dark:bg-purple-950/40' },
  temperature: { label: '体温', icon: Thermometer, color: 'text-red-500 bg-red-50 dark:bg-red-950/40' },
  sleep: { label: '睡眠', icon: Moon, color: 'text-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' },
  play: { label: '玩耍', icon: Baby, color: 'text-orange-500 bg-orange-50 dark:bg-orange-950/40' },
  other: { label: '其他', icon: Baby, color: 'text-gray-500 bg-gray-50 dark:bg-gray-700' },
};

const allRecordTypes = [
  { type: 'breastfeed', category: 'feeding', label: '母乳', icon: Heart, color: 'text-pink-500 bg-pink-50 dark:bg-pink-950/40' },
  { type: 'bottle', category: 'feeding', label: '瓶喂', icon: Milk, color: 'text-blue-500 bg-blue-50 dark:bg-blue-950/40' },
  { type: 'solid', category: 'feeding', label: '辅食', icon: Apple, color: 'text-green-500 bg-green-50 dark:bg-green-950/40' },
  { type: 'water', category: 'feeding', label: '喝水', icon: GlassWater, color: 'text-cyan-500 bg-cyan-50 dark:bg-cyan-950/40' },
  { type: 'diaper', category: 'nursing', label: '换尿布', icon: Droplets, color: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-950/40' },
  { type: 'bath', category: 'nursing', label: '洗澡', icon: Bath, color: 'text-teal-500 bg-teal-50 dark:bg-teal-950/40' },
  { type: 'supplement', category: 'nursing', label: '营养补充', icon: Pill, color: 'text-purple-500 bg-purple-50 dark:bg-purple-950/40' },
  { type: 'temperature', category: 'nursing', label: '体温', icon: Thermometer, color: 'text-red-500 bg-red-50 dark:bg-red-950/40' },
  { type: 'sleep', category: 'activity', label: '睡眠', icon: Moon, color: 'text-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' },
  { type: 'play', category: 'activity', label: '玩耍', icon: Gamepad2, color: 'text-orange-500 bg-orange-50 dark:bg-orange-950/40' },
  { type: 'other', category: 'activity', label: '其他', icon: Baby, color: 'text-gray-500 bg-gray-50 dark:bg-gray-700' },
];


function formatRecordDetail(record: RecordItem): string {
  const { type, data } = record;
  switch (type) {
    case 'breastfeed':
      return `左${data.leftMinutes || 0}分钟 / 右${data.rightMinutes || 0}分钟`;
    case 'bottle':
      return `${data.milkType === 'formula' ? '配方奶' : '母乳'} ${data.amountMl}ml`;
    case 'solid':
      return `${data.name}${data.amount ? ` (${data.amount})` : ''}`;
    case 'water':
      return `${data.amountMl}ml`;
    case 'diaper':
      return data.type === 'wet' ? '尿' : data.type === 'dirty' ? '便' : '尿+便';
    case 'sleep':
      return data.ongoing ? '进行中' : data.durationMinutes ? `${data.durationMinutes}分钟` : '进行中';
    case 'supplement':
      return data.name || '';
    case 'temperature': {
      const loc: Record<string, string> = { axillary: '腋下', ear: '耳温', forehead: '额温', rectal: '肛温' };
      return `${data.value}°C (${loc[data.location] || data.location})`;
    }
    case 'play':
      return data.ongoing ? '进行中' : data.durationMinutes ? `${data.durationMinutes}分钟` : '';
    case 'bath':
      return data.ongoing ? '进行中' : data.durationMinutes ? `${data.durationMinutes}分钟` : '';
    default:
      return record.note || '';
  }
}

// 支持“开始/结束”两阶段记录的活动类型（长按入口即可开始）。
const twoPhaseTypes = ['sleep', 'bath', 'play'];

// formatElapsed 将毫秒时长格式化为 mm:ss 或 h:mm:ss。
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function formatTimeAgo(minutes: number): string {
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时${minutes % 60 > 0 ? `${minutes % 60}分钟` : ''}前`;
  return `${Math.floor(hours / 24)}天前`;
}

function minutesSince(time: string, now: number): number {
  return Math.max(0, Math.round((now - new Date(time).getTime()) / 60000));
}

function getViewerImages(images: RecordItem['images']): ViewerImage[] {
  return (images ?? []).map((img) => ({ url: img.url, rawUrl: img.rawUrl }));
}

interface RecordCardItemProps {
  record: RecordItem;
  isViewer: boolean;
  onImageClick: (images: ViewerImage[], index: number) => void;
}

function RecordCardItem({ record, isViewer, onImageClick }: RecordCardItemProps) {
  const navigate = useNavigate();
  const href = `/record/${record.id}/edit`;
  const config = typeConfig[record.type] || typeConfig.other;
  const Icon = config.icon;

  const handleClick = () => {
    if (isViewer) return;
    const doNavigate = () => navigate(href, { state: { record } });
    if (document.startViewTransition) {
      document.startViewTransition(() => { flushSync(doNavigate); });
    } else {
      doNavigate();
    }
  };

  const urls = getViewerImages(record.images);

  return (
    <div
      key={record.id}
      style={{ viewTransitionName: `record-card-${record.id}` }}
      className={`card flex items-center gap-3 transition-colors ${!isViewer ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 active:bg-gray-100 dark:active:bg-gray-700' : ''}`}
      onClick={handleClick}
    >
      <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${config.color}`}>
        <Icon size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-base dark:text-gray-100">{config.label}</span>
          <span className="text-sm text-gray-400 dark:text-gray-500">
            {dayjs(record.occurredAt).format('HH:mm')}
          </span>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">
          {formatRecordDetail(record)}
        </p>
      </div>
      {record.images && record.images.length > 0 && (
        <div className="flex gap-1.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {record.images.slice(0, 2).map((img, i) => (
            img.mediaType === 'video' ? (
              <div key={i} className="w-11 h-11 rounded-lg bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                <Play size={14} className="text-gray-500" />
              </div>
            ) : (
              <img
                key={i}
                src={img.url}
                alt=""
                className="w-11 h-11 rounded-lg object-cover cursor-zoom-in"
                onClick={() => onImageClick(urls, i)}
              />
            )
          ))}
          {record.images.length > 2 && (
            <span
              className="w-11 h-11 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-xs text-gray-500 cursor-zoom-in"
              onClick={() => onImageClick(urls, 2)}
            >
              +{record.images.length - 2}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function TimelinePage() {
  const { currentBaby } = useBaby();
  const { isViewer } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [summary, setSummary] = useState<TimelineSummary | null>(null);
  const [prediction, setPrediction] = useState<FeedingPrediction | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const loadIdRef = useRef(0);
  const [showTypePanel, setShowTypePanel] = useState(false);
  const [viewerImages, setViewerImages] = useState<ViewerImage[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(isSubscribed());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setPushEnabled(isSubscribed());
  }, []);

  // 每分钟刷新一次“X分钟前”，由前端自行计算
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const ongoingRecords = useMemo(() => records.filter((r) => r.data?.ongoing), [records]);

  // 存在进行中的活动时，每秒刷新一次以实时显示已用时长。
  useEffect(() => {
    if (ongoingRecords.length === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ongoingRecords.length]);

  const handleAddType = (type: string, category: string) => {
    setShowTypePanel(false);
    navigate(`/record/new?type=${type}&category=${category}`);
  };

  // 长按开始一个进行中的活动（睡眠/洗澡）：直接落一条 ongoing 记录，不进表单。
  const handleStartOngoing = async (type: string, category: string) => {
    if (!currentBaby) return;
    const label = typeConfig[type]?.label || '活动';
    const existing = records.find((r) => r.type === type && r.data?.ongoing);
    if (existing) {
      toast(`${label}已在进行中`, 'info');
      setShowTypePanel(false);
      return;
    }
    const nowIso = new Date().toISOString();
    try {
      await api.post('/records', {
        babyId: currentBaby.id,
        category,
        type,
        data: { ongoing: true, startTime: nowIso },
        occurredAt: nowIso,
      }, generateIdempotencyKey());
      setShowTypePanel(false);
      toast(`${label}已开始`, 'success');
      loadData(true);
    } catch {
      toast('开始失败', 'error');
    }
  };

  // 结束一个进行中的活动：补充结束时间与时长并完成记录。
  const handleEndOngoing = async (record: RecordItem) => {
    const startTime = record.data?.startTime || record.occurredAt;
    const endIso = new Date().toISOString();
    const durationMinutes = Math.max(1, Math.round((Date.now() - new Date(startTime).getTime()) / 60000));
    try {
      await api.put(`/records/${record.id}`, {
        data: { ...record.data, ongoing: undefined, startTime, endTime: endIso, durationMinutes },
      });
      toast(`${typeConfig[record.type]?.label || '活动'}已结束（${durationMinutes}分钟）`, 'success');
      loadData(true);
    } catch {
      toast('结束失败', 'error');
    }
  };

  const handleEnablePush = async () => {
    if (pushEnabled) {
      // Already enabled — set a manual reminder for the predicted time
      if (prediction?.minutesUntilNext && prediction.minutesUntilNext > 0 && currentBaby) {
        const remindAt = new Date(Date.now() + prediction.minutesUntilNext * 60000);
        try {
          await api.post('/push/reminder', {
            babyId: currentBaby.id,
            remindAt: remindAt.toISOString(),
            source: 'feeding_manual',
            title: '🍼 喂奶提醒',
            body: '您设置的喂奶提醒时间已到',
          }, generateIdempotencyKey());
          toast('提醒已设置！将在预计喂奶时间通知您', 'success');
        } catch {
          toast('设置提醒失败', 'error');
        }
      }
      return;
    }
    const success = await subscribePush();
    setPushEnabled(success);
    if (success) {
      toast('通知已开启！喂奶提醒将自动推送', 'success');
    }
  };

  useEffect(() => {
    if (!currentBaby) return;
    loadData();
  }, [currentBaby, filter, search]);

  const loadData = async (invalidate = false) => {
    if (!currentBaby) return;
    const thisLoadId = ++loadIdRef.current;
    const params = new URLSearchParams({ babyId: currentBaby.id, pageSize: '50' });
    if (filter && filter !== 'all') params.set('category', filter);
    if (search) params.set('search', search);
    const cKey = `/timeline?${params}`;

    if (invalidate) {
      cacheInvalidate('/timeline');
    }

    type CachedRes = { success: boolean; data: TimelineResponse };
    let cached = cacheRead<CachedRes>(cKey);
    if (!cached) {
      cached = (await cacheReadAsync<CachedRes>(cKey)) ?? undefined;
    }
    if (thisLoadId !== loadIdRef.current) return;

    if (cached) {
      setRecords(cached.data.records);
      setSummary(cached.data.summary ?? null);
      setPrediction(cached.data.prediction ?? null);
      setHasMore(cached.data.hasMore);
      setLoading(false);
      setError(false);
    } else {
      setLoading(true);
    }

    try {
      const res = await api.get<{ success: boolean; data: TimelineResponse }>(cKey);
      if (thisLoadId !== loadIdRef.current) return;
      cacheWrite(cKey, res);
      setRecords(res.data.records);
      setSummary(res.data.summary ?? null);
      setPrediction(res.data.prediction ?? null);
      setHasMore(res.data.hasMore);
      setError(false);
    } catch {
      if (thisLoadId !== loadIdRef.current) return;
      if (!cached) setError(true);
    } finally {
      if (thisLoadId === loadIdRef.current) setLoading(false);
    }
  };

  useRefreshHandler(useCallback(async () => { await loadData(true); }, [currentBaby, filter, search]));

  useServerEvent(
    ['record.created', 'record.updated', 'record.deleted'],
    useCallback(() => { loadData(true); }, [currentBaby, filter, search]),
  );

  const loadMore = async () => {
    if (!currentBaby || loadingMore || !hasMore || records.length === 0) return;
    setLoadingMore(true);
    const lastRecord = records[records.length - 1];
    const beforeMs = new Date(lastRecord.occurredAt).getTime();
    const params = new URLSearchParams({ babyId: currentBaby.id, pageSize: '50', before: String(beforeMs) });
    if (filter && filter !== 'all') params.set('category', filter);
    if (search) params.set('search', search);
    try {
      const res = await api.get<{ success: boolean; data: TimelineResponse }>(`/timeline?${params}`);
      setRecords((prev) => [...prev, ...res.data.records]);
      setHasMore(res.data.hasMore);
    } catch {
      // silently fail — user can scroll again to retry
    } finally {
      setLoadingMore(false);
    }
  };


  type FlatRow = { kind: 'header'; group: string } | { kind: 'item'; record: RecordItem };

  const flatRows = useMemo(() => {
    const grouped = records.reduce<Record<string, RecordItem[]>>((acc, record) => {
      const date = dayjs(record.occurredAt);
      const today = dayjs().startOf('day');
      const yesterday = today.subtract(1, 'day');

      let group: string;
      if (date.isAfter(today)) group = '今天';
      else if (date.isAfter(yesterday)) group = '昨天';
      else group = date.format('MM月DD日');

      if (!acc[group]) acc[group] = [];
      acc[group].push(record);
      return acc;
    }, {});

    const rows: FlatRow[] = [];
    for (const [group, items] of Object.entries(grouped)) {
      rows.push({ kind: 'header', group });
      for (const record of items) {
        rows.push({ kind: 'item', record });
      }
    }
    return rows;
  }, [records]);

  const listRef = useRef<HTMLDivElement>(null);
  const scrollElRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = listRef.current?.closest('.keepalive-page') as HTMLElement | null;
    if (el) scrollElRef.current = el;
  }, []);

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollElRef.current,
    estimateSize: useCallback((i: number) => (flatRows[i]?.kind === 'header' ? 40 : 80), [flatRows]),
    overscan: 8,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });

  // Infinite scroll: load more when near bottom
  useEffect(() => {
    const el = scrollElRef.current;
    if (!el || !hasMore) return;
    const handleScroll = () => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) {
        loadMore();
      }
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [hasMore, loadingMore, records.length]);

  const onImageClickCb = useCallback((images: ViewerImage[], index: number) => {
    setViewerImages(images);
    setViewerIndex(index);
    setViewerOpen(true);
  }, []);

  return (
    <>
    <div className="space-y-3">
      {/* 进行中的活动（睡眠/洗澡）— 固定在顶部 */}
      {ongoingRecords.length > 0 && (
        <div className="sticky top-0 z-20 space-y-2 -mx-4 px-4 py-2 bg-gray-50/95 dark:bg-gray-900/95 backdrop-blur-sm">
          {ongoingRecords.map((record) => {
            const config = typeConfig[record.type] || typeConfig.other;
            const Icon = config.icon;
            const startTime = record.data?.startTime || record.occurredAt;
            const elapsed = formatElapsed(now - new Date(startTime).getTime());
            return (
              <div
                key={record.id}
                className="card flex items-center gap-3 bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-950/30 dark:to-blue-950/30 border border-indigo-200 dark:border-indigo-900/50"
              >
                <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${config.color}`}>
                  <Icon size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-base dark:text-gray-100">{config.label}进行中</span>
                    <span className="flex items-center gap-1 text-xs text-indigo-500 dark:text-indigo-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                      {dayjs(startTime).format('HH:mm')} 开始
                    </span>
                  </div>
                  <p className="text-lg font-semibold tabular-nums text-indigo-600 dark:text-indigo-300">{elapsed}</p>
                </div>
                {!isViewer && (
                <button
                  onClick={() => handleEndOngoing(record)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 active:bg-indigo-700 transition-colors flex-shrink-0"
                >
                  <Square size={14} fill="currentColor" />
                  结束
                </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card text-center py-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">上次喂养</p>
            <p className="text-base font-semibold mt-1 dark:text-gray-100">
              {summary.lastFeeding ? formatTimeAgo(minutesSince(summary.lastFeeding.time, now)) : '--'}
            </p>
          </div>
          <div className="card text-center py-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">上次换尿布</p>
            <p className="text-base font-semibold mt-1 dark:text-gray-100">
              {summary.lastDiaper ? formatTimeAgo(minutesSince(summary.lastDiaper.time, now)) : '--'}
            </p>
          </div>
          <div className="card text-center py-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">上次睡眠</p>
            <p className="text-base font-semibold mt-1 dark:text-gray-100">
              {summary.lastSleep ? formatTimeAgo(minutesSince(summary.lastSleep.time, now)) : '--'}
            </p>
          </div>
        </div>
      )}

      {/* Feeding Prediction */}
      {prediction?.minutesUntilNext != null && prediction.avgIntervalMinutes && (() => {
        const min = prediction.minutesUntilNext!;
        const interval = prediction.avgIntervalMinutes!;
        const ratio = min / interval;

        let cardBg: string, iconBg: string, iconColor: string, labelColor: string, badgeColor: string;
        if (min <= 0) {
          cardBg = 'bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/30 dark:to-rose-950/30 border border-red-200 dark:border-red-900/50';
          iconBg = 'bg-red-100 dark:bg-red-900/50';
          iconColor = 'text-red-600 dark:text-red-400';
          labelColor = 'text-red-600 dark:text-red-400';
          badgeColor = 'text-red-500 dark:text-red-400';
        } else if (ratio <= 0.25) {
          cardBg = 'bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/30 border border-orange-200 dark:border-orange-900/50';
          iconBg = 'bg-orange-100 dark:bg-orange-900/50';
          iconColor = 'text-orange-600 dark:text-orange-400';
          labelColor = 'text-orange-600 dark:text-orange-400';
          badgeColor = 'text-orange-500 dark:text-orange-400';
        } else if (ratio <= 0.5) {
          cardBg = 'bg-gradient-to-r from-yellow-50 to-amber-50 dark:from-yellow-950/30 dark:to-amber-950/30 border border-yellow-200 dark:border-yellow-900/50';
          iconBg = 'bg-yellow-100 dark:bg-yellow-900/50';
          iconColor = 'text-yellow-600 dark:text-yellow-500';
          labelColor = 'text-yellow-600 dark:text-yellow-500';
          badgeColor = 'text-yellow-600 dark:text-yellow-500';
        } else {
          cardBg = 'bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 border border-green-200 dark:border-green-900/50';
          iconBg = 'bg-green-100 dark:bg-green-900/50';
          iconColor = 'text-green-600 dark:text-green-400';
          labelColor = 'text-green-600 dark:text-green-400';
          badgeColor = 'text-green-500 dark:text-green-400';
        }

        return (
          <div className={`card flex items-center gap-3 ${cardBg}`}>
            <div className={`w-10 h-10 rounded-full ${iconBg} flex items-center justify-center flex-shrink-0`}>
              <Milk size={18} className={iconColor} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-medium ${labelColor}`}>
                预计下次喂奶
                {prediction.method === 'bottle' && ' (基于奶量)'}
                {prediction.method === 'breastfeed' && ' (基于哺乳时长)'}
              </p>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {(() => {
                  if (min <= 0) {
                    const overdue = Math.abs(min);
                    if (overdue < 60) return `已超时 ${overdue} 分钟，建议尽快喂奶`;
                    return `已超时 ${Math.floor(overdue / 60)}小时${overdue % 60 > 0 ? `${overdue % 60}分钟` : ''}，建议尽快喂奶`;
                  }
                  if (min < 60) return `约 ${min} 分钟后`;
                  return `约 ${Math.floor(min / 60)}小时${min % 60 > 0 ? `${min % 60}分钟` : ''}后`;
                })()}
              </p>
            </div>
            <span className={`text-xs whitespace-nowrap ${badgeColor}`}>
              间隔 {interval >= 60
                ? `${Math.floor(interval / 60)}h${interval % 60 > 0 ? `${interval % 60}m` : ''}`
                : `${interval}m`}
            </span>
            {isPushSupported() && (
              <button
                onClick={handleEnablePush}
                className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                  pushEnabled
                    ? 'bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
                }`}
                title={pushEnabled ? '设置提醒' : '开启推送提醒'}
              >
                {pushEnabled ? <Bell size={14} /> : <BellOff size={14} />}
              </button>
            )}
            {min > 0 && (
              <button
                onClick={() => addFeedingReminderToCalendar(min)}
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-900/50 dark:hover:text-blue-400 transition-colors"
                title="设置系统闹钟提醒"
              >
                <AlarmClock size={14} />
              </button>
            )}
          </div>
        );
      })()}

      {/* Search & Filter */}
      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="搜索备注、内容..."
            className="w-full h-10 pl-9 pr-3 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            onChange={(e) => {
              const val = e.target.value;
              if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
              searchTimerRef.current = setTimeout(() => setSearch(val), 300);
            }}
          />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-24 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="feeding">喂养</SelectItem>
            <SelectItem value="nursing">护理</SelectItem>
            <SelectItem value="activity">活动</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Timeline (virtualized) */}
      {loading ? (
        <TimelineSkeleton />
      ) : error ? (
        <div className="text-center py-12 text-gray-400">
          <p>加载失败</p>
          <button onClick={() => loadData(true)} className="mt-2 text-sm text-primary-500 hover:underline">重试</button>
        </div>
      ) : records.length === 0 ? (
        <div className="text-center py-12 text-gray-400">暂无记录，点击 + 添加</div>
      ) : (
        <div ref={listRef}>
          <div
            style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
          >
            {virtualizer.getVirtualItems().map((vItem) => {
              const row = flatRows[vItem.index];
              if (!row) return null;
              return (
                <div
                  key={vItem.key}
                  data-index={vItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vItem.start - (virtualizer.options.scrollMargin ?? 0)}px)`,
                  }}
                >
                  {row.kind === 'header' ? (
                    <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 pt-5 pb-2">{row.group}</h3>
                  ) : (
                    <div className="pb-2.5">
                      <RecordCardItem
                        record={row.record}
                        isViewer={isViewer}
                        onImageClick={onImageClickCb}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {loadingMore && (
            <div className="py-4 text-center text-sm text-gray-400">加载中...</div>
          )}
          {!hasMore && records.length > 0 && !loadingMore && (
            <div className="py-4 text-center text-xs text-gray-300 dark:text-gray-600">已加载全部记录</div>
          )}
        </div>
      )}
    </div>

      {/* FAB */}
      {!isViewer && (
      <button
        onClick={() => setShowTypePanel(true)}
        className="fixed right-4 bottom-24 md:bottom-8 w-14 h-14 bg-primary-500 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-primary-600 transition-colors z-40"
      >
        <Plus size={24} />
      </button>
      )}

      {/* Type Selection Panel */}
      {showTypePanel && (
        <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowTypePanel(false)} />
          <div className="relative w-full max-w-sm bg-white dark:bg-gray-800 rounded-t-2xl md:rounded-2xl p-6 pb-10 animate-slide-up">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold dark:text-gray-100">添加记录</h3>
              <button onClick={() => setShowTypePanel(false)} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-gray-400 dark:text-gray-500 mb-3">短按填写详情 · 按住睡眠/洗澡约 0.5 秒可直接开始（电脑/手机均支持）</p>
            <div className="grid grid-cols-4 gap-3">
              {allRecordTypes.map((item) => {
                const Icon = item.icon;
                const twoPhase = twoPhaseTypes.includes(item.type);
                if (twoPhase) {
                  return (
                    <TwoPhaseTypeButton
                      key={item.type}
                      label={item.label}
                      icon={Icon}
                      color={item.color}
                      onShortPress={() => handleAddType(item.type, item.category)}
                      onLongPress={() => handleStartOngoing(item.type, item.category)}
                    />
                  );
                }
                return (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => handleAddType(item.type, item.category)}
                    className="relative flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <div className={`w-13 h-13 rounded-full flex items-center justify-center ${item.color}`}>
                      <Icon size={24} />
                    </div>
                    <span className="text-sm text-gray-700 dark:text-gray-300">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <ImageViewer
        images={viewerImages}
        initialIndex={viewerIndex}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
      />
    </>
  );
}
