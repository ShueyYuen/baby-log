import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Clock, Calendar, TrendingUp, BarChart3, Plus } from 'lucide-react';
import { useBaby } from '../contexts/BabyContext';
import { useAuth } from '../contexts/AuthContext';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const { currentBaby } = useBaby();
  const { user, logout } = useAuth();

  const navItems = [
    { path: '/', icon: Clock, label: '时间线' },
    { path: '/plans', icon: Calendar, label: '计划' },
    { path: '/growth', icon: TrendingUp, label: '成长' },
    { path: '/stats', icon: BarChart3, label: '统计' },
  ];

  if (!currentBaby) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-4">请先添加宝宝信息</h2>
          <Link to="/baby/setup" className="btn-primary">
            添加宝宝
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20 md:pb-0 md:pl-64">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex fixed left-0 top-0 h-full w-64 bg-white border-r border-gray-200 flex-col z-50">
        <div className="p-6 border-b border-gray-100">
          <h1 className="text-xl font-bold text-primary-600">宝宝日志</h1>
          <p className="text-sm text-gray-500 mt-1">{currentBaby.name}</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  active ? 'bg-primary-50 text-primary-600' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <item.icon size={20} />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gray-100">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">{user?.displayName}</span>
            <button onClick={logout} className="text-sm text-gray-400 hover:text-gray-600">
              退出
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="md:hidden fixed top-0 left-0 right-0 bg-white border-b border-gray-200 z-50 px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-bold text-primary-600">宝宝日志</h1>
        <span className="text-sm text-gray-500">{currentBaby.name}</span>
      </header>

      {/* Main Content */}
      <main className="pt-16 md:pt-0 px-4 md:px-8 py-6 max-w-4xl mx-auto">
        {children}
      </main>

      {/* FAB for adding records */}
      <Link
        to="/record/new"
        className="fixed right-4 bottom-24 md:bottom-8 w-14 h-14 bg-primary-500 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-primary-600 transition-colors z-40"
      >
        <Plus size={24} />
      </Link>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 flex">
        {navItems.map((item) => {
          const active = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex-1 flex flex-col items-center py-2 ${
                active ? 'text-primary-500' : 'text-gray-400'
              }`}
            >
              <item.icon size={20} />
              <span className="text-xs mt-1">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
