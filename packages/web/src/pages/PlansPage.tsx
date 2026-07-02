import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useBaby } from '../contexts/BabyContext';
import { api } from '../lib/api';
import dayjs from 'dayjs';
import { Calendar, CheckCircle, Clock, Plus } from 'lucide-react';

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

const statusColors: Record<string, string> = {
  pending: 'text-orange-500 bg-orange-50',
  completed: 'text-green-500 bg-green-50',
  cancelled: 'text-gray-400 bg-gray-50',
  postponed: 'text-blue-500 bg-blue-50',
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
        <h2 className="text-xl font-semibold">计划安排</h2>
        <Link to="/plan/new" className="btn-primary flex items-center gap-1 text-sm">
          <Plus size={16} /> 新计划
        </Link>
      </div>

      {/* Status Filter */}
      <div className="flex gap-2">
        {[
          { value: 'pending', label: '待完成' },
          { value: 'completed', label: '已完成' },
          { value: '', label: '全部' },
        ].map((item) => (
          <button
            key={item.value}
            onClick={() => setStatusFilter(item.value)}
            className={`px-4 py-1.5 rounded-full text-sm ${
              statusFilter === item.value
                ? 'bg-primary-500 text-white'
                : 'bg-white text-gray-600 border border-gray-200'
            }`}
          >
            {item.label}
          </button>
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
            <div key={plan.id} className="card">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[plan.status] || ''}`}>
                      {typeLabels[plan.type] || plan.type}
                    </span>
                    {plan.repeat !== 'none' && (
                      <span className="text-xs text-gray-400">重复</span>
                    )}
                  </div>
                  <h3 className="font-medium">{plan.title}</h3>
                  {plan.description && (
                    <p className="text-sm text-gray-500 mt-1">{plan.description}</p>
                  )}
                  <div className="flex items-center gap-1 text-xs text-gray-400 mt-2">
                    <Calendar size={12} />
                    <span>{dayjs(plan.scheduledAt).format('YYYY-MM-DD HH:mm')}</span>
                    <Clock size={12} className="ml-2" />
                    <span>{dayjs(plan.scheduledAt).fromNow()}</span>
                  </div>
                </div>

                {plan.status === 'pending' && (
                  <button
                    onClick={() => updateStatus(plan.id, 'completed')}
                    className="p-2 text-gray-300 hover:text-green-500 transition-colors"
                    title="标记完成"
                  >
                    <CheckCircle size={24} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
