import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBaby } from '../contexts/BabyContext';
import { api } from '../lib/api';
import { ArrowLeft } from 'lucide-react';
import { Button, Input, Textarea, DateTimePicker } from '../components/ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui';

const planTypes = [
  { value: 'vaccine', label: '疫苗接种' },
  { value: 'doctor', label: '就医' },
  { value: 'checkup', label: '体检' },
  { value: 'medicine', label: '吃药' },
  { value: 'custom', label: '自定义' },
];

export default function PlanFormPage() {
  const navigate = useNavigate();
  const { currentBaby } = useBaby();
  const [title, setTitle] = useState('');
  const [type, setType] = useState('vaccine');
  const [scheduledAt, setScheduledAt] = useState('');
  const [description, setDescription] = useState('');
  const [repeat, setRepeat] = useState('none');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBaby) return;
    setLoading(true);

    try {
      await api.post('/plans', {
        babyId: currentBaby.id,
        title,
        type,
        scheduledAt: new Date(scheduledAt).toISOString(),
        description: description || undefined,
        repeat,
      });
      navigate('/plans');
    } catch {
      alert('创建失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </Button>
        <h2 className="text-xl font-semibold dark:text-gray-100">新建计划</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
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

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? '创建中...' : '创建计划'}
        </Button>
      </form>
    </div>
  );
}
