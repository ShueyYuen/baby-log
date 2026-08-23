import { ReactNode, useState, useCallback, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { hapticTap } from '../lib/haptic';
import { Clock, Calendar, TrendingUp, Activity, Sun, Moon, Monitor, Users, Images, Camera } from 'lucide-react';
import { useBaby } from '../contexts/BabyContext';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { api } from '../lib/api';
import { cropAndResizeAvatar } from '../lib/avatar-crop';
import { Dialog, DialogContent, DialogHeader, DialogTitle, Button, Input, DateTimePicker, useToast } from './ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui';
import dayjs from 'dayjs';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const { currentBaby, loading: babyLoading, refreshBabies } = useBaby();
  const { user, logout, isAdmin, isViewer } = useAuth();
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();

  const [showBabyEdit, setShowBabyEdit] = useState(false);
  const [editName, setEditName] = useState('');
  const [editGender, setEditGender] = useState<string>('male');
  const [editBirthDate, setEditBirthDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [editAvatarPreview, setEditAvatarPreview] = useState<string | null>(null);
  const [editAvatarKey, setEditAvatarKey] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const babyAvatarInputRef = useRef<HTMLInputElement>(null);

  const openBabyEdit = () => {
    if (!currentBaby) return;
    setEditName(currentBaby.name);
    setEditGender(currentBaby.gender);
    setEditBirthDate(currentBaby.birthDate ? dayjs(currentBaby.birthDate).format('YYYY-MM-DDTHH:mm') : '');
    setEditAvatarPreview(currentBaby.avatar ?? null);
    setEditAvatarKey(null);
    setShowBabyEdit(true);
  };

  const handleBabyAvatarUpload = async (file: File) => {
    setAvatarUploading(true);
    try {
      const cropped = await cropAndResizeAvatar(file);
      const formData = new FormData();
      formData.append('file', cropped);
      const res = await api.post<{ success: boolean; data: { url: string; key: string } }>('/upload', formData);
      setEditAvatarPreview(res.data.url);
      setEditAvatarKey(res.data.key);
    } catch {
      toast('头像上传失败', 'error');
    } finally {
      setAvatarUploading(false);
    }
  };

  const saveBabyEdit = async () => {
    if (!currentBaby || !editName.trim()) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: editName.trim(),
        gender: editGender,
        birthDate: editBirthDate ? new Date(editBirthDate).toISOString() : undefined,
      };
      if (editAvatarKey) payload.avatar = editAvatarKey;
      await api.babies.update(currentBaby.id, payload);
      await refreshBabies();
      setShowBabyEdit(false);
    } catch {
      toast('保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const isSecondaryPage = /^\/(record|plan\/new|plan\/[^/]+\/edit|growth\/history|health\/[^/]+|milk-inventory|medical-visits\/|stats)/.test(location.pathname);

  const navItems = [
    { path: '/', icon: Clock, label: '时间线' },
    { path: '/plans', icon: Calendar, label: '计划' },
    { path: '/growth', icon: TrendingUp, label: '成长' },
    { path: '/health', icon: Activity, label: '病症' },
    { path: '/moments', icon: Images, label: '朋友圈' },
    ...(isAdmin ? [{ path: '/admin', icon: Users, label: '管理' }] : []),
  ];

  const themeOptions = [
    { value: 'light' as const, icon: Sun, label: '浅色' },
    { value: 'dark' as const, icon: Moon, label: '深色' },
    { value: 'system' as const, icon: Monitor, label: '跟随系统' },
  ];

  const babyNameLabel = babyLoading ? '…' : currentBaby?.name;

  return (
    <div className="h-screen overflow-hidden bg-transparent md:pl-64">
      {/* Ambient glow orbs — visible through glass panels */}
      <div className="glass-ambient-orbs" aria-hidden="true">
        <div className="glass-ambient-orb glass-ambient-orb-1" />
        <div className="glass-ambient-orb glass-ambient-orb-2" />
        <div className="glass-ambient-orb glass-ambient-orb-3" />
        <div className="glass-ambient-orb glass-ambient-orb-4" />
      </div>

      {/* Desktop Sidebar */}
      <aside className="glass-sidebar hidden md:flex fixed left-0 top-0 h-full w-64 border-r glass-divider flex-col z-50">
        <div className="p-6 border-b glass-divider">
          <h1 className="text-xl font-bold text-primary-600">宝宝日志</h1>
          {currentBaby ? (
              <button
                onClick={openBabyEdit}
                className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mt-1.5 hover:text-primary-600 dark:hover:text-primary-400 transition-colors cursor-pointer"
              >
                {currentBaby.avatar ? (
                  <img src={currentBaby.avatar} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <span className="w-7 h-7 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-600 text-xs font-medium flex items-center justify-center flex-shrink-0">
                    {currentBaby.name.slice(0, 1)}
                  </span>
                )}
                <span>{babyNameLabel}</span>
              </button>
          ) : babyLoading ? (
            <span className="text-sm text-gray-400 mt-1">…</span>
          ) : (
            <Link to="/baby/setup" className="text-sm text-primary-500 hover:text-primary-600 mt-1 inline-block">
              添加宝宝
            </Link>
          )}
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`glass-nav-item flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                  active
                    ? 'bg-primary-50 text-primary-600 glass-nav-item-active'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-white/40 hover:backdrop-blur-sm'
                }`}
              >
                <item.icon size={20} />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Theme Toggle */}
        <div className="p-4 border-t glass-divider">
          <div className="flex items-center gap-1 glass-theme-toggle rounded-lg p-1">
            {themeOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-xs transition-all ${
                  theme === opt.value
                    ? 'text-gray-800 shadow-sm glass-theme-btn-active dark:text-gray-100'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                }`}
                title={opt.label}
              >
                <opt.icon size={14} />
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 border-t glass-divider">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-300">{user?.displayName}</span>
            <button onClick={logout} className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
              退出
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className={`glass-topbar md:hidden fixed top-0 left-0 right-0 border-b glass-divider z-50 px-4 py-3.5 flex items-center justify-between ${isSecondaryPage ? 'hidden' : ''}`}>
        <h1 className="text-lg font-bold text-primary-600">宝宝日志</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')}
            className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            title="切换主题"
          >
            {theme === 'dark' ? <Moon size={18} /> : theme === 'light' ? <Sun size={18} /> : <Monitor size={18} />}
          </button>
          {currentBaby ? (
              <button
                onClick={openBabyEdit}
                className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
              >
                {currentBaby.avatar ? (
                  <img src={currentBaby.avatar} alt="" className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <span className="w-6 h-6 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-600 text-[10px] font-medium flex items-center justify-center flex-shrink-0">
                    {currentBaby.name.slice(0, 1)}
                  </span>
                )}
                <span>{babyNameLabel}</span>
              </button>
          ) : babyLoading ? (
            <span className="text-sm text-gray-400">…</span>
          ) : (
            <Link to="/baby/setup" className="text-sm text-primary-500 hover:text-primary-600">
              添加宝宝
            </Link>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="h-full overflow-hidden glass-main-area">
        {children}
      </main>

      {/* Mobile Bottom Nav */}
      <nav className={`glass-bottomnav md:hidden fixed bottom-0 left-0 right-0 border-t glass-divider z-50 flex ${isSecondaryPage ? 'hidden' : ''}`}>
        {navItems.map((item) => {
          const active = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={hapticTap}
              className={`flex-1 flex flex-col items-center py-2.5 transition-transform active:scale-90 ${
                active ? 'text-primary-500' : 'text-gray-400 dark:text-gray-500'
              }`}
            >
              <item.icon size={22} />
              <span className="text-[11px] mt-1 font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Baby Edit Dialog */}
      <Dialog open={showBabyEdit} onOpenChange={setShowBabyEdit}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑宝宝信息</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">头像</label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => babyAvatarInputRef.current?.click()}
                  disabled={avatarUploading}
                  className="relative w-16 h-16 rounded-full overflow-hidden glass-avatar-placeholder flex items-center justify-center flex-shrink-0"
                >
                  {editAvatarPreview ? (
                    <img src={editAvatarPreview} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Camera size={22} className="text-gray-400" />
                  )}
                </button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={avatarUploading}
                  onClick={() => babyAvatarInputRef.current?.click()}
                >
                  {avatarUploading ? '上传中...' : editAvatarPreview ? '更换头像' : '选择图片'}
                </Button>
                <input
                  ref={babyAvatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleBabyAvatarUpload(f);
                    e.target.value = '';
                  }}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">姓名</label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="宝宝姓名" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">性别</label>
              <Select value={editGender} onValueChange={setEditGender}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">男</SelectItem>
                  <SelectItem value="female">女</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">出生日期</label>
              <DateTimePicker value={editBirthDate} onChange={(v) => setEditBirthDate(v)} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setShowBabyEdit(false)}>取消</Button>
              <Button onClick={saveBabyEdit} disabled={saving || !editName.trim()}>
                {saving ? '保存中...' : '保存'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
