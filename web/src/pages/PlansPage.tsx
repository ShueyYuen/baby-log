import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useBaby } from '../contexts/BabyContext';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { cacheRead, cacheWrite, cacheInvalidate } from '../lib/queryCache';
import { useRefreshHandler } from '../hooks/usePullRefresh';
import { useServerEvent } from '../hooks/useServerEvents';
import { useActivated } from '../hooks/useActivated';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import { Calendar, CheckCircle, Clock, Plus, CalendarPlus, List, ChevronLeft, ChevronRight, Syringe } from 'lucide-react';
import { Button, Card, CardContent, Badge, ConfirmDialog, useToast, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui';
import { addPlanToCalendar } from '../lib/calendar';
import { PlansSkeleton } from '../components/ui/skeleton';
import { generateIdempotencyKey } from '../lib/api';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

interface PlanImage {
  url: string;
  key: string;
  rawUrl?: string;
  mediaType?: string;
}

interface PlanItem {
  id: string;
  title: string;
  type: string;
  scheduledAt: string;
  description?: string;
  reminder?: string;
  status: string;
  repeat: string;
  images?: PlanImage[];
}

const typeLabels: Record<string, string> = {
  vaccine: '疫苗接种',
  doctor: '就医',
  checkup: '体检',
  medicine: '吃药',
  custom: '自定义',
};

const repeatLabels: Record<string, string> = {
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
  yearly: '每年',
};

const statusConfig: Record<string, { label: string; variant: 'warning' | 'success' | 'secondary' | 'info' }> = {
  pending: { label: '待完成', variant: 'warning' },
  completed: { label: '已完成', variant: 'success' },
  cancelled: { label: '已取消', variant: 'secondary' },
  postponed: { label: '已延期', variant: 'info' },
};

const LINKABLE_PLAN_TYPES = new Set(['vaccine', 'medicine', 'checkup', 'doctor']);

const recordCategoryLabels: Record<string, string> = {
  feeding: '喂养',
  nursing: '护理',
  activity: '活动',
};

const recordTypeLabels: Record<string, string> = {
  breastfeed: '母乳',
  bottle: '瓶喂',
  solid: '辅食',
  water: '喝水',
  diaper: '换尿布',
  bath: '洗澡',
  supplement: '营养补充',
  temperature: '体温',
  sleep: '睡眠',
  play: '玩耍',
  other: '其他',
};

function getLinkedRecordMapping(planType: string): { category: string; type: string; data: Record<string, string> } | null {
  switch (planType) {
    case 'vaccine':
      return { category: 'nursing', type: 'supplement', data: { name: '' } };
    case 'medicine':
      return { category: 'activity', type: 'other', data: { note: '' } };
    case 'checkup':
    case 'doctor':
      return { category: 'activity', type: 'other', data: { note: '' } };
    default:
      return null;
  }
}

function buildLinkedRecordPayload(plan: PlanItem, mapping: { category: string; type: string; data: Record<string, string> }) {
  const data =
    mapping.type === 'supplement'
      ? { name: plan.title }
      : { note: plan.title };
  return {
    category: mapping.category,
    type: mapping.type,
    data,
    occurredAt: new Date(plan.scheduledAt).toISOString(),
    note: plan.description || plan.title,
  };
}

const VACCINE_SCHEDULE = [
  { title: '乙肝疫苗(第1剂)', years: 0, months: 0 },
  { title: '卡介苗', years: 0, months: 0 },
  { title: '乙肝疫苗(第2剂)', years: 0, months: 1 },
  { title: '脊灰灭活疫苗(第1剂)', years: 0, months: 2 },
  { title: '脊灰减毒疫苗(第2剂)', years: 0, months: 3 },
  { title: '百白破疫苗(第1剂)', years: 0, months: 3 },
  { title: '脊灰减毒疫苗(第3剂)', years: 0, months: 4 },
  { title: '百白破疫苗(第2剂)', years: 0, months: 4 },
  { title: '百白破疫苗(第3剂)', years: 0, months: 5 },
  { title: '乙肝疫苗(第3剂)', years: 0, months: 6 },
  { title: 'A群流脑多糖疫苗(第1剂)', years: 0, months: 6 },
  { title: '麻腮风疫苗(第1剂)', years: 0, months: 8 },
  { title: '乙脑减毒疫苗(第1剂)', years: 0, months: 8 },
  { title: 'A群流脑多糖疫苗(第2剂)', years: 0, months: 9 },
  { title: '甲肝减毒疫苗', years: 0, months: 18 },
  { title: '麻腮风疫苗(第2剂)', years: 0, months: 18 },
  { title: '百白破疫苗(第4剂)', years: 0, months: 18 },
  { title: '乙脑减毒疫苗(第2剂)', years: 2, months: 0 },
  { title: 'A群C群流脑多糖疫苗(第1剂)', years: 3, months: 0 },
  { title: '脊灰减毒疫苗(第4剂)', years: 4, months: 0 },
  { title: '白破疫苗', years: 6, months: 0 },
  { title: 'A群C群流脑多糖疫苗(第2剂)', years: 6, months: 0 },
] as const;

function vaccineScheduledDate(birthDate: string, years: number, months: number) {
  let d = dayjs(birthDate);
  if (years > 0) d = d.add(years, 'year');
  else if (months > 0) d = d.add(months, 'month');
  return d;
}

interface PlanCardItemProps {
  plan: PlanItem;
  isViewer: boolean;
  onComplete: (plan: PlanItem) => void;
  onCalendar: (title: string, scheduledAt: string, description: string | undefined, reminder: number) => void;
}

function PlanCardItem({ plan, isViewer, onComplete, onCalendar }: PlanCardItemProps) {
  const navigate = useNavigate();
  const href = `/plan/${plan.id}/edit`;

  const handleClick = () => {
    if (isViewer) return;
    const doNavigate = () => navigate(href, { state: { plan } });
    if (document.startViewTransition) {
      document.startViewTransition(() => { flushSync(doNavigate); });
    } else {
      doNavigate();
    }
  };

  return (
    <Card
      style={{ viewTransitionName: `plan-card-${plan.id}` }}
      className={`transition-colors ${!isViewer ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 active:bg-gray-100 dark:active:bg-gray-700' : ''}`}
      onClick={handleClick}
    >
      <CardContent>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant={statusConfig[plan.status]?.variant || 'secondary'}>
                {typeLabels[plan.type] || plan.type}
              </Badge>
              {plan.repeat !== 'none' && (
                <Badge variant="secondary">🔄 {repeatLabels[plan.repeat] || '重复'}</Badge>
              )}
            </div>
            <h3 className="font-medium text-base dark:text-gray-100">{plan.title}</h3>
            {plan.description && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{plan.description}</p>
            )}
            {plan.images && plan.images.length > 0 && (
              <div className="flex gap-1.5 mt-2 overflow-x-auto">
                {plan.images.map((img, i) => (
                  <img key={i} src={img.url} alt="" className="w-14 h-14 rounded-md object-cover flex-shrink-0" />
                ))}
              </div>
            )}
            <div className="flex items-center gap-1.5 text-sm text-gray-400 dark:text-gray-500 mt-2">
              <Calendar size={14} />
              <span>{dayjs(plan.scheduledAt).format('YYYY-MM-DD HH:mm')}</span>
              <Clock size={14} className="ml-2" />
              <span>{dayjs(plan.scheduledAt).fromNow()}</span>
            </div>
          </div>

          {plan.status === 'pending' && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); onCalendar(plan.title, plan.scheduledAt, plan.description, parseInt(plan.reminder || '30') || 30); }}
                className="p-1.5 rounded-md text-gray-300 dark:text-gray-600 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
                title="添加到系统日历"
              >
                <CalendarPlus size={20} />
              </button>
              {!isViewer && (
                <button
                  onClick={(e) => { e.stopPropagation(); onComplete(plan); }}
                  className="p-1.5 rounded-md text-gray-300 dark:text-gray-600 hover:text-green-500 dark:hover:text-green-400 transition-colors"
                  title="标记完成"
                >
                  <CheckCircle size={22} />
                </button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

const typeColors: Record<string, string> = {
  vaccine: 'bg-green-400',
  doctor: 'bg-red-400',
  checkup: 'bg-blue-400',
  medicine: 'bg-orange-400',
  custom: 'bg-purple-400',
};

function CalendarView({
  currentBaby,
  isViewer,
  onComplete,
  onCalendar,
}: {
  currentBaby: { id: string } | null;
  isViewer: boolean;
  onComplete: (plan: PlanItem) => void;
  onCalendar: (title: string, scheduledAt: string, description: string | undefined, reminder: number) => void;
}) {
  const [viewMonth, setViewMonth] = useState(dayjs().startOf('month'));
  const [calPlans, setCalPlans] = useState<PlanItem[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(dayjs().format('YYYY-MM-DD'));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!currentBaby) return;
    const load = async () => {
      setLoading(true);
      const from = viewMonth.toISOString();
      const to = viewMonth.add(1, 'month').toISOString();
      try {
        type PlansRes = { success: boolean; data: { items: PlanItem[] } | PlanItem[] };
        const res = await api.get<PlansRes>(
          `/plans?babyId=${currentBaby.id}&from=${from}&to=${to}&pageSize=100`
        );
        const items = Array.isArray(res.data) ? res.data : res.data.items;
        setCalPlans(items);
      } catch { /* ignore */ }
      setLoading(false);
    };
    load();
  }, [currentBaby, viewMonth]);

  const plansByDate = useMemo(() => {
    const map = new Map<string, PlanItem[]>();
    for (const p of calPlans) {
      const d = dayjs(p.scheduledAt).format('YYYY-MM-DD');
      const arr = map.get(d) || [];
      arr.push(p);
      map.set(d, arr);
    }
    return map;
  }, [calPlans]);

  const calendarDays = useMemo(() => {
    const first = viewMonth.startOf('month');
    const startDay = first.day();
    const daysInMonth = viewMonth.daysInMonth();
    const days: (dayjs.Dayjs | null)[] = [];
    for (let i = 0; i < startDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(first.add(d - 1, 'day'));
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [viewMonth]);

  const today = dayjs().format('YYYY-MM-DD');

  const selectedPlans = selectedDate ? (plansByDate.get(selectedDate) || []) : [];

  return (
    <div className="space-y-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setViewMonth((m) => m.subtract(1, 'month'))}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <ChevronLeft size={18} className="text-gray-500" />
        </button>
        <h3 className="font-semibold text-base dark:text-gray-100">
          {viewMonth.format('YYYY年 M月')}
        </h3>
        <button
          onClick={() => setViewMonth((m) => m.add(1, 'month'))}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <ChevronRight size={18} className="text-gray-500" />
        </button>
      </div>

      {/* Calendar grid */}
      <Card>
        <CardContent className="p-2">
          <div className="grid grid-cols-7 gap-0">
            {WEEKDAYS.map((d) => (
              <div key={d} className="text-center text-xs text-gray-400 dark:text-gray-500 py-1.5 font-medium">
                {d}
              </div>
            ))}
            {calendarDays.map((day, idx) => {
              if (!day) {
                return <div key={`empty-${idx}`} className="aspect-square" />;
              }
              const dateStr = day.format('YYYY-MM-DD');
              const dayPlans = plansByDate.get(dateStr) || [];
              const isToday = dateStr === today;
              const isSelected = dateStr === selectedDate;
              const hasPending = dayPlans.some((p) => p.status === 'pending');

              return (
                <button
                  key={dateStr}
                  className={`aspect-square flex flex-col items-center justify-center rounded-lg transition-colors relative ${
                    isSelected
                      ? 'bg-primary-100 dark:bg-primary-900/30 ring-2 ring-primary-400'
                      : hasPending
                      ? 'bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30'
                      : dayPlans.length > 0
                      ? 'bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                  onClick={() => setSelectedDate(dateStr)}
                >
                  <span
                    className={`text-sm leading-none ${
                      isToday
                        ? 'w-6 h-6 rounded-full bg-primary-500 text-white flex items-center justify-center font-semibold'
                        : hasPending
                        ? 'font-semibold text-amber-700 dark:text-amber-300'
                        : 'dark:text-gray-200'
                    }`}
                  >
                    {day.date()}
                  </span>
                  {dayPlans.length > 0 && (
                    <div className="flex gap-0.5 mt-0.5 absolute bottom-1">
                      {dayPlans.slice(0, 4).map((p, i) => (
                        <span
                          key={i}
                          className={`w-1.5 h-1.5 rounded-full ${
                            p.status === 'completed'
                              ? 'bg-gray-300 dark:bg-gray-600'
                              : typeColors[p.type] || 'bg-gray-400'
                          }`}
                        />
                      ))}
                      {dayPlans.length > 4 && (
                        <span className="text-[8px] text-gray-400 leading-none">+{dayPlans.length - 4}</span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Selected date plans */}
      {selectedDate && (
        <div>
          <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
            {dayjs(selectedDate).format('M月D日 dddd')}
            {selectedPlans.length > 0 && ` · ${selectedPlans.length}项`}
          </h4>
          {selectedPlans.length === 0 ? (
            <p className="text-center text-gray-300 dark:text-gray-600 py-4 text-sm">无计划</p>
          ) : (
            <div className="space-y-2">
              {selectedPlans.map((plan) => (
                <PlanCardItem
                  key={plan.id}
                  plan={plan}
                  isViewer={isViewer}
                  onComplete={onComplete}
                  onCalendar={onCalendar}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-4">
          <div className="w-5 h-5 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}

export default function PlansPage() {
  const { currentBaby } = useBaby();
  const { isViewer } = useAuth();
  const { toast } = useToast();
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [completingPlan, setCompletingPlan] = useState<PlanItem | null>(null);
  const [linkRecordPlan, setLinkRecordPlan] = useState<PlanItem | null>(null);
  const [creatingRecord, setCreatingRecord] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [vaccineDialogOpen, setVaccineDialogOpen] = useState(false);
  const [vaccineGenerating, setVaccineGenerating] = useState(false);
  const [existingVaccineTitles, setExistingVaccineTitles] = useState<Set<string>>(new Set());
  const sentinelRef = useRef<HTMLDivElement>(null);
  const PAGE_SIZE = 20;

  useEffect(() => {
    if (!currentBaby) {
      setLoading(false);
      return;
    }
    loadPlans(1, true);
  }, [currentBaby, statusFilter]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || loadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          loadPlans(page + 1, false);
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, page]);

  const loadPlans = async (p: number, replace: boolean) => {
    if (!currentBaby) return;
    const params = new URLSearchParams({ babyId: currentBaby.id, page: String(p), pageSize: String(PAGE_SIZE) });
    if (statusFilter) params.set('status', statusFilter);
    const cKey = `/plans?${params}`;

    if (replace) cacheInvalidate(`/plans`);

    type PlansRes = { success: boolean; data: { items: PlanItem[]; total: number; hasMore: boolean } | PlanItem[] };
    const extract = (d: PlansRes['data']) => Array.isArray(d) ? d : d.items;
    const extractHasMore = (d: PlansRes['data']) => Array.isArray(d) ? false : (d as { hasMore: boolean }).hasMore;

    if (p === 1) {
      const cached = cacheRead<PlansRes>(cKey);
      if (cached) {
        setPlans(extract(cached.data));
        setHasMore(extractHasMore(cached.data));
        setLoading(false);
      } else {
        setLoading(true);
      }
    } else {
      setLoadingMore(true);
    }

    try {
      const res = await api.get<PlansRes>(cKey);
      cacheWrite(cKey, res);
      const items = extract(res.data);
      setHasMore(extractHasMore(res.data));
      setPlans((prev) => replace ? items : [...prev, ...items]);
      setPage(p);
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useActivated(useCallback(() => { loadPlans(1, true); }, [currentBaby, statusFilter]));
  useRefreshHandler(useCallback(async () => { await loadPlans(1, true); }, [currentBaby, statusFilter]));

  useServerEvent(
    ['plan.created', 'plan.updated', 'plan.deleted'],
    useCallback(() => { loadPlans(1, true); }, [currentBaby, statusFilter]),
  );

  const updateStatus = async (plan: PlanItem, status: string) => {
    const isRepeat = plan.repeat !== 'none';
    try {
      await api.put(`/plans/${plan.id}`, { status });
      if (status === 'completed' && isRepeat) {
        toast('已自动创建下一期计划', 'success');
      }
      loadPlans(1, true);
      if (status === 'completed' && LINKABLE_PLAN_TYPES.has(plan.type)) {
        setLinkRecordPlan(plan);
      }
    } catch {
      // ignore
    }
  };

  const createLinkedRecord = async () => {
    if (!linkRecordPlan || !currentBaby) return;
    const mapping = getLinkedRecordMapping(linkRecordPlan.type);
    if (!mapping) return;
    setCreatingRecord(true);
    try {
      await api.post('/records', {
        babyId: currentBaby.id,
        ...buildLinkedRecordPayload(linkRecordPlan, mapping),
      });
      cacheInvalidate('/timeline');
      toast('记录已创建', 'success');
      setLinkRecordPlan(null);
    } catch {
      toast('创建记录失败', 'error');
    } finally {
      setCreatingRecord(false);
    }
  };

  const openVaccineDialog = async () => {
    if (!currentBaby) return;
    setVaccineDialogOpen(true);
    try {
      type PlansRes = { success: boolean; data: { items: PlanItem[] } | PlanItem[] };
      const res = await api.get<PlansRes>(`/plans?babyId=${currentBaby.id}&pageSize=100`);
      const items = Array.isArray(res.data) ? res.data : res.data.items;
      setExistingVaccineTitles(new Set(items.filter((p) => p.type === 'vaccine').map((p) => p.title)));
    } catch {
      setExistingVaccineTitles(new Set());
    }
  };

  const vaccinePreview = useMemo(() => {
    if (!currentBaby?.birthDate) return [];
    const now = dayjs();
    return VACCINE_SCHEDULE.map((entry) => {
      const scheduled = vaccineScheduledDate(currentBaby.birthDate, entry.years, entry.months);
      return {
        ...entry,
        scheduledAt: scheduled,
        expired: scheduled.isBefore(now, 'day'),
        exists: existingVaccineTitles.has(entry.title),
      };
    });
  }, [currentBaby?.birthDate, existingVaccineTitles]);

  const vaccineToCreateCount = useMemo(
    () => vaccinePreview.filter((v) => !v.exists).length,
    [vaccinePreview],
  );

  const generateVaccinePlans = async () => {
    if (!currentBaby) return;
    setVaccineGenerating(true);
    try {
      type VaccineRes = { success: boolean; data: { created: number } };
      const res = await api.post<VaccineRes>(
        '/plans/vaccine-template',
        { babyId: currentBaby.id },
        generateIdempotencyKey(),
      );
      const created = res.data.created;
      if (created > 0) {
        toast(`成功创建 ${created} 条疫苗计划`, 'success');
      } else {
        toast('所有疫苗计划已存在，未创建新计划', 'info');
      }
      setVaccineDialogOpen(false);
      cacheInvalidate('/plans');
      loadPlans(1, true);
    } catch {
      toast('生成疫苗计划失败', 'error');
    } finally {
      setVaccineGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold dark:text-gray-100">计划安排</h2>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
            <button
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-gray-400'}`}
              onClick={() => setViewMode('list')}
              title="列表视图"
            >
              <List size={16} />
            </button>
            <button
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'calendar' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-gray-400'}`}
              onClick={() => setViewMode('calendar')}
              title="日历视图"
            >
              <Calendar size={16} />
            </button>
          </div>
          {!isViewer && (
          <Button asChild size="sm">
            <Link to="/plan/new">
              <Plus size={16} /> 新计划
            </Link>
          </Button>
          )}
        </div>
      </div>

      {viewMode === 'list' ? (
        <>
          {/* Status Filter */}
          <div className="flex items-center gap-2 flex-wrap">
            {[
              { value: 'pending', label: '待完成' },
              { value: 'completed', label: '已完成' },
              { value: '', label: '全部' },
            ].map((item) => (
              <Button
                key={item.value}
                variant={statusFilter === item.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter(item.value)}
              >
                {item.label}
              </Button>
            ))}
            {!isViewer && (
              <Button
                variant="outline"
                size="sm"
                onClick={openVaccineDialog}
                disabled={!currentBaby?.birthDate}
                title={!currentBaby?.birthDate ? '请先设置宝宝出生日期' : undefined}
              >
                <Syringe size={16} /> 生成疫苗计划
              </Button>
            )}
          </div>

          {/* Plans List */}
          {loading ? (
            <PlansSkeleton />
          ) : plans.length === 0 ? (
            <div className="text-center py-12 text-gray-400">暂无计划</div>
          ) : (
            <div className="space-y-3">
              {plans.map((plan) => (
                <PlanCardItem
                  key={plan.id}
                  plan={plan}
                  isViewer={isViewer}
                  onComplete={(plan) => setCompletingPlan(plan)}
                  onCalendar={(title, scheduledAt, description, reminder) => addPlanToCalendar(title, scheduledAt, description, reminder)}
                />
              ))}
              {loadingMore && (
                <div className="flex justify-center py-4">
                  <div className="w-5 h-5 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {hasMore && !loadingMore && (
                <div ref={sentinelRef} className="h-4" />
              )}
              {!hasMore && plans.length > 0 && !loadingMore && (
                <div className="py-4 text-center text-xs text-gray-300 dark:text-gray-600">
                  已加载全部计划
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <CalendarView
          currentBaby={currentBaby}
          isViewer={isViewer}
          onComplete={(plan) => setCompletingPlan(plan)}
          onCalendar={(title, scheduledAt, description, reminder) => addPlanToCalendar(title, scheduledAt, description, reminder)}
        />
      )}

      <ConfirmDialog
        open={!!completingPlan}
        onOpenChange={(open) => { if (!open) setCompletingPlan(null); }}
        title="标记完成"
        description="确定将此计划标记为已完成？"
        confirmLabel="完成"
        variant="default"
        onConfirm={() => {
          if (completingPlan) {
            updateStatus(completingPlan, 'completed');
            setCompletingPlan(null);
          }
        }}
      />

      <Dialog open={!!linkRecordPlan} onOpenChange={(open) => { if (!open) setLinkRecordPlan(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>同步创建记录</DialogTitle>
            <DialogDescription>
              计划「{linkRecordPlan?.title}」已完成，是否创建对应记录？
            </DialogDescription>
          </DialogHeader>
          {linkRecordPlan && (() => {
            const mapping = getLinkedRecordMapping(linkRecordPlan.type);
            if (!mapping) return null;
            return (
              <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1.5 py-2">
                <p>计划类型：{typeLabels[linkRecordPlan.type] || linkRecordPlan.type}</p>
                <p>记录类型：{recordTypeLabels[mapping.type]}（{recordCategoryLabels[mapping.category]}）</p>
                <p>标题：{linkRecordPlan.title}</p>
                <p>时间：{dayjs(linkRecordPlan.scheduledAt).format('YYYY-MM-DD HH:mm')}</p>
              </div>
            );
          })()}
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setLinkRecordPlan(null)}
              disabled={creatingRecord}
            >
              跳过
            </Button>
            <Button
              className="flex-1"
              onClick={createLinkedRecord}
              disabled={creatingRecord}
            >
              {creatingRecord ? '创建中...' : '创建记录'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={vaccineDialogOpen} onOpenChange={setVaccineDialogOpen}>
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>生成疫苗计划</DialogTitle>
            <DialogDescription>
              根据国家免疫规划，基于宝宝出生日期自动生成 {VACCINE_SCHEDULE.length} 项疫苗接种计划。已过期的疫苗也会生成，方便补种记录。
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 -mx-1 px-1 space-y-1.5 min-h-0">
            {vaccinePreview.map((item) => (
              <div
                key={item.title}
                className={`flex items-center justify-between text-sm py-1.5 px-2 rounded-md ${
                  item.exists ? 'opacity-50' : ''
                }`}
              >
                <span className="flex-1 min-w-0 truncate dark:text-gray-200">{item.title}</span>
                <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                  <span className="text-gray-400 dark:text-gray-500 text-xs">
                    {item.scheduledAt.format('YYYY-MM-DD')}
                  </span>
                  {item.expired && !item.exists && (
                    <Badge variant="secondary" className="text-xs">已过期</Badge>
                  )}
                  {item.exists && (
                    <Badge variant="secondary" className="text-xs">已存在</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setVaccineDialogOpen(false)}
              disabled={vaccineGenerating}
            >
              取消
            </Button>
            <Button
              className="flex-1"
              onClick={generateVaccinePlans}
              disabled={vaccineGenerating || vaccineToCreateCount === 0}
            >
              {vaccineGenerating ? '生成中...' : `确认生成 (${vaccineToCreateCount})`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
