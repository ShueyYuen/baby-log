import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useBaby } from '../contexts/BabyContext';

export default function BabySetupPage() {
  const [name, setName] = useState('');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [birthDate, setBirthDate] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { refreshBabies } = useBaby();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await api.post('/babies', { name, gender, birthDate });
      await refreshBabies();
      navigate('/');
    } catch (err: any) {
      setError(err.message || '添加失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-baby-blue to-white flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-800">添加宝宝</h1>
          <p className="text-gray-500 mt-2">请填写宝宝的基本信息</p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4">
          {error && (
            <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">宝宝名字</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              placeholder="如：小宝"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">性别</label>
            <div className="flex gap-4">
              <label className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition-colors ${gender === 'male' ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}`}>
                <input type="radio" value="male" checked={gender === 'male'} onChange={() => setGender('male')} className="hidden" />
                <span>男孩</span>
              </label>
              <label className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition-colors ${gender === 'female' ? 'border-pink-400 bg-pink-50' : 'border-gray-200'}`}>
                <input type="radio" value="female" checked={gender === 'female'} onChange={() => setGender('female')} className="hidden" />
                <span>女孩</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">出生日期</label>
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              className="input"
              required
            />
          </div>

          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? '添加中...' : '添加宝宝'}
          </button>
        </form>
      </div>
    </div>
  );
}
