import { useState, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useBaby } from '../contexts/BabyContext';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { cacheRead, cacheWrite, cacheInvalidate } from '../lib/queryCache';
import { useRefreshHandler } from '../hooks/usePullRefresh';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import { Calendar, CheckCircle, Clock, Plus, CalendarPlus } from 'lucide-react';
import { Button, Card, CardContent, Badge, ConfirmDialog } from '../components/ui';
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
                <Badge variant="secondary">重复</Badge>
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

export default function PlansPage() {
  const { currentBaby } = useBaby();
  const { isViewer } = useAuth();
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
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

  useRefreshHandler(useCallback(async () => { await loadPlans(1, true); }, [currentBaby, statusFilter]));

  const updateStatus = async (id: string, status: string) => {
    try {
      await api.put(`/plans/${id}`, { status });
      loadPlans(1, true);
    } catch {
      // ignore
    }
  };


  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold dark:text-gray-100">计划安排</h2>
        {!isViewer && (
        <Button asChild size="sm">
          <Link to="/plan/new">
            <Plus size={16} /> 新计划
          </Link>
        </Button>
        )}
      </div>

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
