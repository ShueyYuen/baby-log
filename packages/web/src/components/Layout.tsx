import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Clock, Calendar, TrendingUp, BarChart3, Sun, Moon, Monitor, Users } from 'lucide-react';
import { useBaby } from '../contexts/BabyContext';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { api } from '../lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, Button, Input, DatePicker } from './ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui';
import dayjs from 'dayjs';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const { currentBaby, refreshBabies } = useBaby();
  const { user, logout, isAdmin } = useAuth();
  const { theme, setTheme } = useTheme();

  const [showBabyEdit, setShowBabyEdit] = useState(false);
  const [editName, setEditName] = useState('');
  const [editGender, setEditGender] = useState<string>('male');
  const [editBirthDate, setEditBirthDate] = useState('');
  const [saving, setSaving] = useState(false);

  const openBabyEdit = () => {
    if (!currentBaby) return;
    setEditName(currentBaby.name);
    setEditGender(currentBaby.gender);
    setEditBirthDate(currentBaby.birthDate ? dayjs(currentBaby.birthDate).format('YYYY-MM-DD') : '');
    setShowBabyEdit(true);
  };

  const saveBabyEdit = async () => {
    if (!currentBaby || !editName.trim()) return;
    setSaving(true);
    try {
      await api.put(`/babies/${currentBaby.id}`, {
        name: editName.trim(),
        gender: editGender,
        birthDate: editBirthDate || undefined,
      });
      await refreshBabies();
      setShowBabyEdit(false);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const navItems = [
    { path: '/', icon: Clock, label: '时间线' },
    { path: '/plans', icon: Calendar, label: '计划' },
    { path: '/growth', icon: TrendingUp, label: '成长' },
    { path: '/stats', icon: BarChart3, label: '统计' },
    ...(isAdmin ? [{ path: '/admin', icon: Users, label: '管理' }] : []),
  ];

  const themeOptions = [
    { value: 'light' as const, icon: Sun, label: '浅色' },
    { value: 'dark' as const, icon: Moon, label: '深色' },
    { value: 'system' as const, icon: Monitor, label: '跟随系统' },
  ];

  if (!currentBaby) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-4 dark:text-gray-100">请先添加宝宝信息</h2>
          <Link to="/baby/setup" className="btn-primary">
            添加宝宝
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-gray-50 dark:bg-gray-900 md:pl-64">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex fixed left-0 top-0 h-full w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex-col z-50">
        <div className="p-6 border-b border-gray-100 dark:border-gray-700">
          <h1 className="text-xl font-bold text-primary-600">宝宝日志</h1>
          <button
            onClick={openBabyEdit}
            className="text-sm text-gray-500 dark:text-gray-400 mt-1 hover:text-primary-600 dark:hover:text-primary-400 transition-colors cursor-pointer"
          >
            {currentBaby.name}
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  active
                    ? 'bg-primary-50 text-primary-600 dark:bg-primary-900/30'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                <item.icon size={20} />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Theme Toggle */}
        <div className="p-4 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
            {themeOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-xs transition-colors ${
                  theme === opt.value
                    ? 'bg-white dark:bg-gray-600 text-gray-800 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                }`}
                title={opt.label}
              >
                <opt.icon size={14} />
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-300">{user?.displayName}</span>
            <button onClick={logout} className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
              退出
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="md:hidden fixed top-0 left-0 right-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 z-50 px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-bold text-primary-600">宝宝日志</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')}
            className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            title="切换主题"
          >
            {theme === 'dark' ? <Moon size={18} /> : theme === 'light' ? <Sun size={18} /> : <Monitor size={18} />}
          </button>
          <button
            onClick={openBabyEdit}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
          >
            {currentBaby.name}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="h-full pt-16 pb-20 md:pt-6 md:pb-6 px-4 md:px-8 overflow-y-auto custom-scrollbar">
        <div className="max-w-4xl mx-auto">
          {children}
        </div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 z-50 flex">
        {navItems.map((item) => {
          const active = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex-1 flex flex-col items-center py-2 ${
                active ? 'text-primary-500' : 'text-gray-400 dark:text-gray-500'
              }`}
            >
              <item.icon size={20} />
              <span className="text-xs mt-1">{item.label}</span>
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
              <DatePicker value={editBirthDate} onChange={(v) => setEditBirthDate(v)} />
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
