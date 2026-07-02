import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useBaby } from '../contexts/BabyContext';
import { api } from '../lib/api';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import { Calendar, CheckCircle, Clock, Plus } from 'lucide-react';
import { Button, Card, CardContent, Badge } from '../components/ui';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

interface PlanItem {
  id: string;
  title: string;
  type: string;
  scheduledAt: string;
  description?: string;
  status: string;
  repeat: string;
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

export default function PlansPage() {
  const { currentBaby } = useBaby();
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');

  useEffect(() => {
    if (!currentBaby) return;
    loadPlans();
  }, [currentBaby, statusFilter]);

  const loadPlans = async () => {
    if (!currentBaby) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ babyId: currentBaby.id });
      if (statusFilter) params.set('status', statusFilter);
      const res = await api.get<{ success: boolean; data: PlanItem[] }>(`/plans?${params}`);
      setPlans(res.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      await api.put(`/plans/${id}`, { status });
      loadPlans();
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold dark:text-gray-100">计划安排</h2>
        <Button asChild size="sm">
          <Link to="/plan/new">
            <Plus size={16} /> 新计划
          </Link>
        </Button>
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
        <div className="text-center py-12 text-gray-400">加载中...</div>
      ) : plans.length === 0 ? (
        <div className="text-center py-12 text-gray-400">暂无计划</div>
      ) : (
        <div className="space-y-3">
          {plans.map((plan) => (
            <Card key={plan.id}>
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
                    <h3 className="font-medium dark:text-gray-100">{plan.title}</h3>
                    {plan.description && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{plan.description}</p>
                    )}
                    <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 mt-2">
                      <Calendar size={12} />
                      <span>{dayjs(plan.scheduledAt).format('YYYY-MM-DD HH:mm')}</span>
                      <Clock size={12} className="ml-2" />
                      <span>{dayjs(plan.scheduledAt).fromNow()}</span>
                    </div>
                  </div>

                  {plan.status === 'pending' && (
                    <button
                      onClick={() => updateStatus(plan.id, 'completed')}
                      className="p-2 text-gray-300 dark:text-gray-600 hover:text-green-500 dark:hover:text-green-400 transition-colors"
                      title="标记完成"
                    >
                      <CheckCircle size={24} />
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
