import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera } from 'lucide-react';
import { api, generateIdempotencyKey } from '../lib/api';
import { cropAndResizeAvatar } from '../lib/avatar-crop';
import { useBaby } from '../contexts/BabyContext';
import { DateTimePicker } from '../components/ui';

export default function BabySetupPage() {
  const [name, setName] = useState('');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [birthDate, setBirthDate] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarKey, setAvatarKey] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const { refreshBabies } = useBaby();
  const navigate = useNavigate();

  const handleAvatarUpload = async (file: File) => {
    setAvatarUploading(true);
    setError('');
    try {
      const cropped = await cropAndResizeAvatar(file);
      const formData = new FormData();
      formData.append('file', cropped);
      const res = await api.post<{ success: boolean; data: { url: string; key: string } }>('/upload', formData);
      setAvatarPreview(res.data.url);
      setAvatarKey(res.data.key);
    } catch (err: any) {
      setError(err.message || '头像上传失败');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!birthDate) {
      setError('请选择出生日期和时间');
      return;
    }

    setLoading(true);

    try {
      await api.babies.create(
        {
          name,
          gender,
          birthDate: new Date(birthDate).toISOString(),
          ...(avatarKey ? { avatar: avatarKey } : {}),
        },
        generateIdempotencyKey(),
      );
      await refreshBabies();
      navigate('/');
    } catch (err: any) {
      setError(err.message || '添加失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-baby-blue to-white dark:from-gray-900 dark:to-gray-800 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">添加宝宝</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2">请填写宝宝的基本信息</p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm p-3 rounded-lg">{error}</div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">头像（可选）</label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={avatarUploading}
                className="w-16 h-16 rounded-full overflow-hidden glass-avatar-placeholder flex items-center justify-center flex-shrink-0"
              >
                {avatarPreview ? (
                  <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Camera size={22} className="text-gray-400" />
                )}
              </button>
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={avatarUploading}
                className="text-sm text-primary-600 dark:text-primary-400"
              >
                {avatarUploading ? '上传中...' : avatarPreview ? '更换头像' : '选择图片'}
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleAvatarUpload(f);
                  e.target.value = '';
                }}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">宝宝名字</label>
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
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">性别</label>
            <div className="flex gap-4">
              <label className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition-colors ${gender === 'male' ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-300' : 'glass-toggle-btn dark:text-gray-300'}`}>
                <input type="radio" value="male" checked={gender === 'male'} onChange={() => setGender('male')} className="hidden" />
                <span>男孩</span>
              </label>
              <label className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition-colors ${gender === 'female' ? 'border-pink-400 bg-pink-50 dark:bg-pink-900/30 dark:text-pink-300' : 'glass-toggle-btn dark:text-gray-300'}`}>
                <input type="radio" value="female" checked={gender === 'female'} onChange={() => setGender('female')} className="hidden" />
                <span>女孩</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">出生日期</label>
            <DateTimePicker
              value={birthDate}
              onChange={setBirthDate}
              placeholder="选择出生日期和时间"
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
