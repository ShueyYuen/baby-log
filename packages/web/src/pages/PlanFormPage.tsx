import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBaby } from '../contexts/BabyContext';
import { api } from '../lib/api';
import { ArrowLeft } from 'lucide-react';

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
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={20} />
        </button>
        <h2 className="text-xl font-semibold">新建计划</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">计划类型</label>
          <div className="flex flex-wrap gap-2">
            {planTypes.map((pt) => (
              <button
                key={pt.value}
                type="button"
                onClick={() => setType(pt.value)}
                className={`px-4 py-1.5 rounded-full text-sm ${
                  type === pt.value ? 'bg-primary-100 text-primary-700 border border-primary-300' : 'bg-white text-gray-600 border border-gray-200'
                }`}
              >
                {pt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">标题</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="input" placeholder="如：乙肝疫苗第二针" required />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">计划时间</label>
          <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="input" required />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="input" rows={3} placeholder="可选描述..." />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">重复</label>
          <select value={repeat} onChange={(e) => setRepeat(e.target.value)} className="input">
            <option value="none">不重复</option>
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
            <option value="monthly">每月</option>
          </select>
        </div>

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? '创建中...' : '创建计划'}
        </button>
      </form>
    </div>
  );
}
