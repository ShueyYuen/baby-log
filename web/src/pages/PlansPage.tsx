import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useBaby } from '../contexts/BabyContext';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import type { TranslateFn } from '../i18n';
import { api } from '../lib/api';
import { cacheRead, cacheWrite, cacheInvalidate } from '../lib/queryCache';
import { useRefreshHandler } from '../hooks/usePullRefresh';
import { useServerEvent } from '../hooks/useServerEvents';
import { useActivated } from '../hooks/useActivated';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { Calendar, CheckCircle, Clock, Plus, CalendarPlus, List, ChevronLeft, ChevronRight, Syringe } from 'lucide-react';
import { Button, Card, CardContent, Badge, ConfirmDialog, useToast, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, MediaThumbs, toViewerImages } from '../components/ui';
import { addPlanToCalendar } from '../lib/calendar';
import { PlansSkeleton } from '../components/ui/skeleton';
import { generateIdempotencyKey } from '../lib/api';

dayjs.extend(relativeTime);

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

function planTypeLabels(t: TranslateFn): Record<string, string> {
  return {
    vaccine: t('plans.types.vaccine'),
    doctor: t('plans.types.doctor'),
    checkup: t('plans.types.checkup'),
    medicine: t('plans.types.medicine'),
    custom: t('plans.types.custom'),
  };
}

function planRepeatLabels(t: TranslateFn): Record<string, string> {
  return {
    daily: t('plans.repeats.daily'),
    weekly: t('plans.repeats.weekly'),
    monthly: t('plans.repeats.monthly'),
    yearly: t('plans.repeats.yearly'),
  };
}

function planStatusConfig(t: TranslateFn): Record<string, { label: string; variant: 'warning' | 'success' | 'secondary' | 'info' }> {
  return {
    pending: { label: t('plans.status.pending'), variant: 'warning' },
    completed: { label: t('plans.status.completed'), variant: 'success' },
    cancelled: { label: t('plans.status.cancelled'), variant: 'secondary' },
    postponed: { label: t('plans.status.postponed'), variant: 'info' },
  };
}

const LINKABLE_PLAN_TYPES = new Set(['vaccine', 'medicine', 'checkup', 'doctor']);
const MEDICAL_PLAN_TYPES = new Set(['vaccine', 'doctor', 'checkup']);

function recordCategoryLabels(t: TranslateFn): Record<string, string> {
  return {
    feeding: t('categories.feeding'),
    nursing: t('categories.nursing'),
    activity: t('categories.activity'),
  };
}

function recordTypeLabels(t: TranslateFn): Record<string, string> {
  return {
    breastfeed: t('recordTypes.breastfeed'),
    bottle: t('recordTypes.bottle'),
    solid: t('recordTypes.solid'),
    water: t('recordTypes.water'),
    diaper: t('recordTypes.diaper'),
    bath: t('recordTypes.bath'),
    supplement: t('recordTypes.supplement'),
    temperature: t('recordTypes.temperature'),
    sleep: t('recordTypes.sleep'),
    play: t('recordTypes.play'),
    other: t('recordTypes.other'),
  };
}

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
  { key: 'hepb1', years: 0, months: 0 },
  { key: 'bcg', years: 0, months: 0 },
  { key: 'hepb2', years: 0, months: 1 },
  { key: 'ipv1', years: 0, months: 2 },
  { key: 'opv2', years: 0, months: 3 },
  { key: 'dtp1', years: 0, months: 3 },
  { key: 'opv3', years: 0, months: 4 },
  { key: 'dtp2', years: 0, months: 4 },
  { key: 'dtp3', years: 0, months: 5 },
  { key: 'hepb3', years: 0, months: 6 },
  { key: 'mpsvA1', years: 0, months: 6 },
  { key: 'mmr1', years: 0, months: 8 },
  { key: 'je1', years: 0, months: 8 },
  { key: 'mpsvA2', years: 0, months: 9 },
  { key: 'hepA', years: 0, months: 18 },
  { key: 'mmr2', years: 0, months: 18 },
  { key: 'dtp4', years: 0, months: 18 },
  { key: 'je2', years: 2, months: 0 },
  { key: 'mpsvAC1', years: 3, months: 0 },
  { key: 'opv4', years: 4, months: 0 },
  { key: 'dt', years: 6, months: 0 },
  { key: 'mpsvAC2', years: 6, months: 0 },
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
  const { t } = useI18n();
  const typeLabels = planTypeLabels(t);
  const repeatLabels = planRepeatLabels(t);
  const statusConfig = planStatusConfig(t);
  const href = `/plan/${plan.id}/edit`;
  const viewerImages = useMemo(
    () => toViewerImages(plan.images || []),
    [plan.images]
  );

  const handleClick = (e: React.MouseEvent) => {
    if (isViewer) return;
    if ((e.target as HTMLElement).closest('img, button, [data-media-thumbs]')) return;
    navigate(href, { state: { plan } });
  };

  return (
    <Card
      className={`transition-all ${!isViewer ? 'cursor-pointer hover:!bg-white/50 dark:hover:!bg-white/[0.06] active:!bg-white/60 dark:active:!bg-white/[0.03]' : ''}`}
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
                <Badge variant="secondary">🔄 {repeatLabels[plan.repeat] || t('plans.repeat')}</Badge>
              )}
            </div>
            <h3 className="font-medium text-base dark:text-gray-100">{plan.title}</h3>
            {plan.description && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{plan.description}</p>
            )}
            {viewerImages.length > 0 && (
              <MediaThumbs
                images={viewerImages}
                className="mt-2"
                thumbClassName="w-14 h-14 rounded-md"
              />
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
                title={t('plans.addToCalendar')}
              >
                <CalendarPlus size={20} />
              </button>
              {!isViewer && (
                <button
                  onClick={(e) => { e.stopPropagation(); onComplete(plan); }}
                  className="p-1.5 rounded-md text-gray-300 dark:text-gray-600 hover:text-green-500 dark:hover:text-green-400 transition-colors"
                  title={t('plans.markDone')}
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

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

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
  const { toast } = useToast();
  const { t } = useI18n();
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
      } catch {
        toast(t('plans.loadCalendarFailed'), 'error');
      }
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
          className="p-2 rounded-lg glass-icon-btn transition-colors"
        >
          <ChevronLeft size={18} className="text-gray-500" />
        </button>
        <h3 className="font-semibold text-base dark:text-gray-100">
          {viewMonth.format(t('dateFmt.monthYear'))}
        </h3>
        <button
          onClick={() => setViewMonth((m) => m.add(1, 'month'))}
          className="p-2 rounded-lg glass-icon-btn transition-colors"
        >
          <ChevronRight size={18} className="text-gray-500" />
        </button>
      </div>

      {/* Calendar grid */}
      <Card>
        <CardContent className="p-2">
          <div className="grid grid-cols-7 gap-0">
            {WEEKDAY_KEYS.map((d) => (
              <div key={d} className="text-center text-xs text-gray-400 dark:text-gray-500 py-1.5 font-medium">
                {t(`weekdays.${d}`)}
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
                      ? 'glass-info-strip hover:!bg-white/50 dark:hover:!bg-white/[0.06]'
                      : 'hover:bg-white/40 dark:hover:bg-white/[0.04]'
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
            {dayjs(selectedDate).format(t('dateFmt.weekdayDate'))}
            {selectedPlans.length > 0 && ` · ${t('plans.itemCount', { n: selectedPlans.length })}`}
          </h4>
          {selectedPlans.length === 0 ? (
            <p className="text-center text-gray-300 dark:text-gray-600 py-4 text-sm">{t('plans.none')}</p>
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
  const { t } = useI18n();
  const typeLabels = planTypeLabels(t);
  const recordTypeLabelMap = recordTypeLabels(t);
  const recordCategoryLabelMap = recordCategoryLabels(t);
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
      toast(t('plans.loadListFailed'), 'error');
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
      await api.plansCrud.update(plan.id, { status });
      if (status === 'completed' && isRepeat) {
        toast(t('plans.nextCreated'), 'success');
      }
      loadPlans(1, true);
      if (status === 'completed' && LINKABLE_PLAN_TYPES.has(plan.type)) {
        setLinkRecordPlan(plan);
      }
    } catch {
      toast(t('plans.statusFailed'), 'error');
    }
  };

  const createLinkedRecord = async () => {
    if (!linkRecordPlan || !currentBaby) return;
    setCreatingRecord(true);
    try {
      if (MEDICAL_PLAN_TYPES.has(linkRecordPlan.type)) {
        await api.medicalVisits.create(
          {
            babyId: currentBaby.id,
            visitDate: new Date(linkRecordPlan.scheduledAt).toISOString(),
            department: linkRecordPlan.type === 'vaccine' ? t('planForm.departmentVaccine') : '',
            diagnosis: linkRecordPlan.title,
            notes: linkRecordPlan.description || '',
          },
          generateIdempotencyKey(),
        );
        toast(t('plans.visitCreated'), 'success');
      } else {
        const mapping = getLinkedRecordMapping(linkRecordPlan.type);
        if (!mapping) return;
        await api.recordsCrud.create({
          babyId: currentBaby.id,
          ...buildLinkedRecordPayload(linkRecordPlan, mapping),
        });
        cacheInvalidate('/timeline');
        toast(t('plans.recordCreated'), 'success');
      }
      setLinkRecordPlan(null);
    } catch {
      toast(t('plans.createRecordFailed'), 'error');
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
      const title = t(`vaccines.${entry.key}`);
      return {
        ...entry,
        title,
        scheduledAt: scheduled,
        expired: scheduled.isBefore(now, 'day'),
        exists: existingVaccineTitles.has(title),
      };
    });
  }, [currentBaby?.birthDate, existingVaccineTitles, t]);

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
        toast(t('plans.vaccinesCreated', { n: created }), 'success');
      } else {
        toast(t('plans.vaccinesExist'), 'info');
      }
      setVaccineDialogOpen(false);
      cacheInvalidate('/plans');
      loadPlans(1, true);
    } catch {
      toast(t('plans.vaccinesFailed'), 'error');
    } finally {
      setVaccineGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold dark:text-gray-100">{t('plans.title')}</h2>
        <div className="flex items-center gap-2">
          <div className="flex glass-info-strip rounded-lg p-0.5">
            <button
              className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-white/60 dark:bg-white/[0.1] shadow-sm backdrop-blur-sm' : 'text-gray-400'}`}
              onClick={() => setViewMode('list')}
              title={t('plans.listView')}
            >
              <List size={16} />
            </button>
            <button
              className={`p-1.5 rounded-md transition-all ${viewMode === 'calendar' ? 'bg-white/60 dark:bg-white/[0.1] shadow-sm backdrop-blur-sm' : 'text-gray-400'}`}
              onClick={() => setViewMode('calendar')}
              title={t('plans.calendarView')}
            >
              <Calendar size={16} />
            </button>
          </div>
          {!isViewer && (
          <Button asChild size="sm">
            <Link to="/plan/new">
              <Plus size={16} /> {t('plans.newPlan')}
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
              { value: 'pending', label: t('plans.status.pending') },
              { value: 'completed', label: t('plans.status.completed') },
              { value: '', label: t('common.all') },
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
                title={!currentBaby?.birthDate ? t('plans.needBirthDate') : undefined}
              >
                <Syringe size={16} /> {t('plans.generateVaccines')}
              </Button>
            )}
          </div>

          {/* Plans List */}
          {loading ? (
            <PlansSkeleton />
          ) : plans.length === 0 ? (
            <div className="text-center py-12 text-gray-400">{t('plans.empty')}</div>
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
                  {t('plans.loadedAll')}
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
        title={t('plans.markDone')}
        description={t('plans.markDoneDesc')}
        confirmLabel={t('plans.complete')}
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
            <DialogTitle>{t('plans.syncRecord')}</DialogTitle>
            <DialogDescription>
              {t('plans.syncRecordDesc', {
                title: linkRecordPlan?.title ?? '',
                kind: linkRecordPlan && MEDICAL_PLAN_TYPES.has(linkRecordPlan.type) ? t('plans.medicalVisit') : t('plans.dailyRecord'),
              })}
            </DialogDescription>
          </DialogHeader>
          {linkRecordPlan && (() => {
            const mapping = getLinkedRecordMapping(linkRecordPlan.type);
            if (!mapping) return null;
            return (
              <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1.5 py-2">
                <p>{t('plans.planType', { type: typeLabels[linkRecordPlan.type] || linkRecordPlan.type })}</p>
                <p>{t('plans.willCreate', {
                  what: MEDICAL_PLAN_TYPES.has(linkRecordPlan.type)
                    ? t('plans.medicalVisit')
                    : t('plans.willCreateTyped', {
                        type: recordTypeLabelMap[mapping.type],
                        category: recordCategoryLabelMap[mapping.category],
                      }),
                })}</p>
                <p>{t('plans.planTitle', { title: linkRecordPlan.title })}</p>
                <p>{t('plans.planTime', { time: dayjs(linkRecordPlan.scheduledAt).format('YYYY-MM-DD HH:mm') })}</p>
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
              {t('common.skip')}
            </Button>
            <Button
              className="flex-1"
              onClick={createLinkedRecord}
              disabled={creatingRecord}
            >
              {creatingRecord ? t('common.creating') : t('plans.createRecord')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={vaccineDialogOpen} onOpenChange={setVaccineDialogOpen}>
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('plans.generateTitle')}</DialogTitle>
            <DialogDescription>
              {t('plans.generateDesc', { n: VACCINE_SCHEDULE.length })}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 -mx-1 px-1 space-y-1.5 min-h-0 custom-scrollbar">
            {vaccinePreview.map((item) => (
              <div
                key={item.key}
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
                    <Badge variant="secondary" className="text-xs">{t('plans.expired')}</Badge>
                  )}
                  {item.exists && (
                    <Badge variant="secondary" className="text-xs">{t('plans.exists')}</Badge>
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
              {t('common.cancel')}
            </Button>
            <Button
              className="flex-1"
              onClick={generateVaccinePlans}
              disabled={vaccineGenerating || vaccineToCreateCount === 0}
            >
              {vaccineGenerating ? t('plans.generating') : t('plans.confirmGenerate', { n: vaccineToCreateCount })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
