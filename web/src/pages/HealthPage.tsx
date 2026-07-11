import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBaby } from '../contexts/BabyContext';
import { useAuth } from '../contexts/AuthContext';
import { api, generateIdempotencyKey, type HealthCondition, type MedicalVisit } from '../lib/api';
import { cacheRead, cacheWrite, cacheInvalidate } from '../lib/queryCache';
import { useRefreshHandler } from '../hooks/usePullRefresh';
import { useServerEvent } from '../hooks/useServerEvents';
import { useActivated } from '../hooks/useActivated';
import dayjs from 'dayjs';
import { Plus, Activity, CheckCircle2, Hospital, ChevronRight, Search, X } from 'lucide-react';
import { Button, Input, Card, CardContent, Badge, Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, useToast } from '../components/ui';
import { Textarea } from '../components/ui';

export default function HealthPage() {
  const { currentBaby } = useBaby();
  const { isViewer } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [conditions, setConditions] = useState<HealthCondition[]>([]);
  const [visits, setVisits] = useState<MedicalVisit[]>([]);
  const [visitsTotal, setVisitsTotal] = useState(0);
  const [visitsHasMore, setVisitsHasMore] = useState(false);
  const [visitsPage, setVisitsPage] = useState(1);
  const [visitsLoading, setVisitsLoading] = useState(false);
  const [visitsQuery, setVisitsQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const loadConditions = useCallback(async () => {
    if (!currentBaby) return;
    const cKey = `/health-conditions?babyId=${currentBaby.id}`;
    const cached = cacheRead<{ data: HealthCondition[] }>(cKey);
    if (cached) {
      setConditions(cached.data);
    }
    try {
      const res = await api.healthConditions.list(currentBaby.id);
      cacheWrite(cKey, res);
      setConditions(res.data);
    } catch { /* ignore */ }
  }, [currentBaby]);

  const fetchVisits = useCallback(async (p = 1, q = '', append = false) => {
    if (!currentBaby) return;
    setVisitsLoading(true);
    try {
      const res = await api.medicalVisits.list(currentBaby.id, {
        q: q || undefined,
        page: p,
        pageSize: 20,
      });
      const data = res.data;
      if (append) {
        setVisits(prev => [...prev, ...data.items]);
      } else {
        setVisits(data.items);
      }
      setVisitsHasMore(data.hasMore);
      setVisitsTotal(data.total);
      setVisitsPage(p);
    } catch { /* ignore */ }
    setVisitsLoading(false);
  }, [currentBaby]);

  const loadAll = useCallback(async () => {
    await Promise.all([loadConditions(), fetchVisits(1, '')]);
  }, [loadConditions, fetchVisits]);

  useEffect(() => {
    if (!currentBaby) { setLoading(false); return; }
    loadAll().finally(() => setLoading(false));
  }, [currentBaby, loadAll]);

  useActivated(useCallback(() => { loadAll(); }, [loadAll]));
  useRefreshHandler(useCallback(async () => { await loadAll(); }, [loadAll]));
  useServerEvent(
    ['health.change'],
    useCallback(() => {
      if (currentBaby) cacheInvalidate(`/health-conditions?babyId=${currentBaby.id}`);
      loadAll();
    }, [currentBaby, loadAll]),
  );

  const createCondition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBaby || !name.trim()) return;
    try {
      await api.healthConditions.create(
        { babyId: currentBaby.id, name: name.trim(), description: desc.trim() || undefined },
        generateIdempotencyKey()
      );
      setShowForm(false);
      setName('');
      setDesc('');
      if (currentBaby) cacheInvalidate(`/health-conditions?babyId=${currentBaby.id}`);
      loadConditions();
      toast('病症追踪已创建', 'success');
    } catch {
      toast('创建失败', 'error');
    }
  };

  const handleVisitSearch = useCallback((value: string) => {
    setVisitsQuery(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setActiveQuery(value);
      fetchVisits(1, value);
    }, 400);
  }, [fetchVisits]);

  const clearSearch = useCallback(() => {
    setVisitsQuery('');
    setActiveQuery('');
    fetchVisits(1, '');
  }, [fetchVisits]);

  const activeConditions = conditions.filter(c => c.status === 'active');
  const resolvedConditions = conditions.filter(c => c.status === 'resolved');

  if (loading) {
    return (
      <div className="space-y-4 py-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-16 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      {/* Health Conditions Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold dark:text-gray-100">病症追踪</h2>
        {!isViewer && (
          <Dialog open={showForm} onOpenChange={setShowForm}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus size={14} className="mr-1" /> 新增
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>新增病症追踪</DialogTitle>
              </DialogHeader>
              <form onSubmit={createCondition} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">名称</label>
                  <Input value={name} onChange={e => setName(e.target.value)} placeholder="如：斜颈、睾丸大小" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">描述（可选）</label>
                  <Textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="简要描述症状或追踪目的..." rows={2} />
                </div>
                <div className="flex gap-3">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setShowForm(false)}>取消</Button>
                  <Button type="submit" className="flex-1">创建</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Active Conditions */}
      {activeConditions.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2 px-1">进行中</h3>
          <div className="space-y-2">
            {activeConditions.map(c => (
              <Card key={c.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/health/${c.id}`)}>
                <CardContent className="flex items-center gap-3 py-3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-orange-50 dark:bg-orange-900/30">
                    <Activity size={16} className="text-orange-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-base dark:text-gray-100">{c.name}</h4>
                    <p className="text-sm text-gray-400">{c.entryCount} 条记录</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Resolved Conditions */}
      {resolvedConditions.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2 px-1">已康复</h3>
          <div className="space-y-2">
            {resolvedConditions.map(c => (
              <Card key={c.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/health/${c.id}`)}>
                <CardContent className="flex items-center gap-3 py-3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-green-50 dark:bg-green-900/30">
                    <CheckCircle2 size={16} className="text-green-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-base dark:text-gray-100">{c.name}</h4>
                    <p className="text-sm text-gray-400">{c.entryCount} 条记录 · 已康复</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {conditions.length === 0 && (
        <div className="text-center py-8">
          <Activity size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
          <p className="text-sm text-gray-400 dark:text-gray-500">暂无追踪项目</p>
          {!isViewer && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">点击右上角"新增"开始追踪</p>
          )}
        </div>
      )}

      {/* Medical Visits Section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold dark:text-gray-100">就诊记录</h2>
          {!isViewer && (
            <Button size="sm" onClick={() => navigate('/medical-visits/new')}>
              <Plus size={14} className="mr-1" /> 新增
            </Button>
          )}
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={visitsQuery}
            onChange={e => handleVisitSearch(e.target.value)}
            placeholder="搜索医院、诊断、处方..."
            className="w-full h-10 pl-9 pr-9 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          {visitsQuery && (
            <button onClick={clearSearch} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          )}
        </div>

        {activeQuery && !visitsLoading && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
            搜索 &quot;{activeQuery}&quot;，共 {visitsTotal} 条结果
          </p>
        )}

        {visitsLoading && visits.length === 0 ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
            ))}
          </div>
        ) : visits.length === 0 ? (
          <div className="text-center py-8">
            <Hospital size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
            <p className="text-sm text-gray-400 dark:text-gray-500">
              {activeQuery ? '没有找到匹配的记录' : '暂无就诊记录'}
            </p>
            {!activeQuery && !isViewer && (
              <Button className="mt-3" size="sm" onClick={() => navigate('/medical-visits/new')}>
                添加就诊记录
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {visits.map(v => (
              <button
                key={v.id}
                onClick={() => navigate(`/medical-visits/${v.id}`)}
                className="w-full text-left bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 hover:border-primary-300 dark:hover:border-primary-600 transition-colors"
              >
                <div className="flex gap-3 items-center">
                  {v.images?.[0]?.url ? (
                    <img src={v.images[0].url} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                      <Hospital size={20} className="text-blue-400" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                        {v.hospital || '就诊记录'}
                      </span>
                      {v.department && (
                        <Badge variant="secondary" className="text-[10px] shrink-0">
                          {v.department}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {dayjs(v.visitDate).format('YYYY-MM-DD')}
                      {v.doctor ? ` · ${v.doctor}` : ''}
                    </p>
                    {v.diagnosis && (
                      <p className="text-xs text-gray-600 dark:text-gray-300 truncate mt-0.5">{v.diagnosis}</p>
                    )}
                  </div>
                  <ChevronRight size={16} className="text-gray-300 dark:text-gray-600 shrink-0" />
                </div>
              </button>
            ))}
            {visitsHasMore && (
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => fetchVisits(visitsPage + 1, activeQuery, true)}
                disabled={visitsLoading}
              >
                {visitsLoading ? '加载中...' : '加载更多'}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
