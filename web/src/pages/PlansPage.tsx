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
import { Calendar, CheckCircle, Clock, Plus, CalendarPlus, List, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, Card, CardContent, Badge, ConfirmDialog, useToast } from '../components/ui';
import { addPlanToCalendar } from '../lib/calendar';
import { PlansSkeleton } from '../components/ui/skeleton';

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

interface PlanCardItemProps {
  plan: PlanItem;
  isViewer: boolean;
  onComplete: (id: string) => void;
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
                  onClick={(e) => { e.stopPropagation(); onComplete(plan.id); }}
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
  onComplete: (id: string) => void;
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
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
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

  const updateStatus = async (id: string, status: string) => {
    const plan = plans.find((p) => p.id === id);
    const isRepeat = plan && plan.repeat !== 'none';
    try {
      await api.put(`/plans/${id}`, { status });
      if (status === 'completed' && isRepeat) {
        toast('已自动创建下一期计划', 'success');
      }
      loadPlans(1, true);
    } catch {
      // ignore
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
          <div className="flex gap-2">
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
                  onComplete={(id) => setCompletingId(id)}
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
          onComplete={(id) => setCompletingId(id)}
          onCalendar={(title, scheduledAt, description, reminder) => addPlanToCalendar(title, scheduledAt, description, reminder)}
        />
      )}

      <ConfirmDialog
        open={!!completingId}
        onOpenChange={(open) => { if (!open) setCompletingId(null); }}
        title="标记完成"
        description="确定将此计划标记为已完成？"
        confirmLabel="完成"
        variant="default"
        onConfirm={() => {
          if (completingId) {
            updateStatus(completingId, 'completed');
            setCompletingId(null);
          }
        }}
      />
    </div>
  );
}
