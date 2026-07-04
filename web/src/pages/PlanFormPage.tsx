import { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useBaby } from '../contexts/BabyContext';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { cacheRead } from '../lib/queryCache';
import { ArrowLeft, Bell } from 'lucide-react';
import { Button, Input, Textarea, DateTimePicker, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, useToast } from '../components/ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui';
import dayjs from 'dayjs';

const planTypes = [
  { value: 'vaccine', label: '疫苗接种' },
  { value: 'doctor', label: '就医' },
  { value: 'checkup', label: '体检' },
  { value: 'medicine', label: '吃药' },
  { value: 'custom', label: '自定义' },
];

// 常见婴幼儿疫苗候选名称（含国家免疫规划及常见自费疫苗），用于疫苗计划的快捷填充。
const vaccineSuggestions = [
  '乙肝疫苗',
  '卡介苗',
  '脊灰疫苗',
  '百白破疫苗',
  '麻腮风疫苗',
  '乙脑疫苗',
  '流脑疫苗',
  '甲肝疫苗',
  '白破疫苗',
  'Hib疫苗',
  '13价肺炎疫苗',
  '轮状病毒疫苗',
  '手足口（EV71）疫苗',
  '水痘疫苗',
  '流感疫苗',
];

export default function PlanFormPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { id } = useParams();
  const isEditing = !!id;
  const { currentBaby } = useBaby();
  const { isViewer } = useAuth();

  useEffect(() => {
    if (isViewer) navigate('/plans', { replace: true });
  }, [isViewer, navigate]);
  const [title, setTitle] = useState('');
  const [type, setType] = useState('vaccine');
  const [scheduledAt, setScheduledAt] = useState('');
  const [description, setDescription] = useState('');
  const [repeat, setRepeat] = useState('none');
  const [reminder, setReminder] = useState('30');
  const [loading, setLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (!isEditing || !currentBaby) return;

    const populatePlan = (plan: any) => {
      setTitle(plan.title);
      setType(plan.type);
      setScheduledAt(dayjs(plan.scheduledAt).format('YYYY-MM-DD HH:mm'));
      setDescription(plan.description || '');
      setRepeat(plan.repeat || 'none');
      setReminder(plan.reminder || '30');
    };

    // Try location state first (instant)
    const statePlan = (location.state as any)?.plan;
    if (statePlan) {
      populatePlan(statePlan);
      return;
    }

    // Try cache second
    const params = new URLSearchParams({ babyId: currentBaby.id });
    const cKey = `/plans?${params}`;
    const cached = cacheRead<{ success: boolean; data: any[] }>(cKey);
    const cachedPlan = cached?.data?.find((p: any) => p.id === id);
    if (cachedPlan) {
      populatePlan(cachedPlan);
      return;
    }

    // Fallback: fetch from backend
    api.get<{ success: boolean; data: any[] }>(`/plans?babyId=${currentBaby.id}`).then((res) => {
      const plan = res.data.find((p: any) => p.id === id);
      if (plan) populatePlan(plan);
    });
  }, [id, currentBaby]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBaby) return;
    setLoading(true);

    try {
      if (isEditing) {
        await api.put(`/plans/${id}`, {
          title,
          type,
          scheduledAt: new Date(scheduledAt).toISOString(),
          description: description || undefined,
          reminder,
          repeat,
        });
      } else {
        await api.post('/plans', {
          babyId: currentBaby.id,
          title,
          type,
          scheduledAt: new Date(scheduledAt).toISOString(),
          description: description || undefined,
          reminder,
          repeat,
        });
      }
      navigate('/plans', { replace: true });
    } catch {
      toast(isEditing ? '保存失败' : '创建失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{ viewTransitionName: id ? `plan-card-${id}` : undefined }}
      className="fixed inset-0 md:top-0 md:bottom-0 md:left-64 z-30 flex flex-col bg-gray-50 dark:bg-gray-900 form-expand-in"
    >
      <div className="flex items-center gap-3 px-4 md:px-8 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </Button>
        <h2 className="flex-1 text-xl font-semibold dark:text-gray-100">{isEditing ? '编辑计划' : '新建计划'}</h2>
        {isEditing && (
          <Button type="submit" form="plan-form" size="sm" disabled={loading}>
            {loading ? '保存中...' : '保存'}
          </Button>
        )}
      </div>

      <form id="plan-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">计划类型</label>
          <div className="flex flex-wrap gap-2">
            {planTypes.map((pt) => (
              <Button
                key={pt.value}
                type="button"
                variant={type === pt.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setType(pt.value)}
              >
                {pt.label}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">标题</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：乙肝疫苗第二针" required />
          {type === 'vaccine' && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {vaccineSuggestions.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setTitle(name)}
                  className="px-2.5 py-1 text-xs rounded-full border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">计划时间</label>
          <DateTimePicker value={scheduledAt} onChange={setScheduledAt} placeholder="选择计划时间" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">描述</label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="可选描述..." />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">重复</label>
          <Select value={repeat} onValueChange={setRepeat}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">不重复</SelectItem>
              <SelectItem value="daily">每天</SelectItem>
              <SelectItem value="weekly">每周</SelectItem>
              <SelectItem value="monthly">每月</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            <Bell size={14} className="inline mr-1" />提前提醒
          </label>
          <Select value={reminder} onValueChange={setReminder}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">不提醒</SelectItem>
              <SelectItem value="10">提前10分钟</SelectItem>
              <SelectItem value="30">提前30分钟</SelectItem>
              <SelectItem value="60">提前1小时</SelectItem>
              <SelectItem value="120">提前2小时</SelectItem>
              <SelectItem value="1440">提前1天</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {!isEditing && (
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? '创建中...' : '创建计划'}
          </Button>
        )}
        {isEditing && (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full py-2.5 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          >
            删除此计划
          </button>
        )}
      </form>

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>确定要删除此计划吗？此操作不可撤销。</DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 mt-4">
            <Button variant="outline" className="flex-1" onClick={() => setShowDeleteConfirm(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={async () => {
                try {
                  await api.delete(`/plans/${id}`);
                  navigate('/plans', { replace: true });
                } catch {
                  toast('删除失败', 'error');
                }
              }}
            >
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
