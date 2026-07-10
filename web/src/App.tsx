import { lazy, Suspense, useState, useEffect, useMemo } from 'react';
import { Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { useBaby } from './contexts/BabyContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import TimelinePage from './pages/TimelinePage';
import PlansPage from './pages/PlansPage';
import GrowthPage from './pages/GrowthPage';
import StatsPage from './pages/StatsPage';
import MomentsPage from './pages/MomentsPage';
import AdminPage from './pages/AdminPage';

const RecordFormPage = lazy(() => import('./pages/RecordFormPage'));
const PlanFormPage = lazy(() => import('./pages/PlanFormPage'));
const GrowthHistoryPage = lazy(() => import('./pages/GrowthHistoryPage'));
const HealthTrackingPage = lazy(() => import('./pages/HealthTrackingPage'));
const BabySetupPage = lazy(() => import('./pages/BabySetupPage'));

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-40">
      <div className="w-6 h-6 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen">加载中...</div>;
  if (!user) return <Navigate to="/login" />;
  return <>{children}</>;
}

function BabyBanner() {
  const { currentBaby, loading } = useBaby();
  if (loading || currentBaby) return null;
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/30">
      <p className="text-sm text-amber-800 dark:text-amber-200">还没有宝宝信息，添加后即可开始记录</p>
      <Link to="/baby/setup" className="shrink-0 text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400">
        去添加
      </Link>
    </div>
  );
}

function KeepAliveRoutes() {
  const location = useLocation();
  const { isAdmin } = useAuth();

  const keepAlivePages = useMemo(() => [
    { path: '/', key: 'timeline', Component: TimelinePage },
    { path: '/plans', key: 'plans', Component: PlansPage },
    { path: '/growth', key: 'growth', Component: GrowthPage },
    { path: '/stats', key: 'stats', Component: StatsPage },
    { path: '/moments', key: 'moments', Component: MomentsPage },
    { path: '/admin', key: 'admin', Component: AdminPage, guard: () => isAdmin },
  ], [isAdmin]);

  const [visited, setVisited] = useState<Set<string>>(() => new Set());

  const activeKeepAlive = keepAlivePages.find((p) => p.path === location.pathname);

  useEffect(() => {
    if (activeKeepAlive && (!activeKeepAlive.guard || activeKeepAlive.guard())) {
      setVisited((prev) => {
        if (prev.has(activeKeepAlive.key)) return prev;
        return new Set([...prev, activeKeepAlive.key]);
      });
    }
  }, [activeKeepAlive?.key]);

  const isKeepAlivePage = !!activeKeepAlive;

  return (
    <>
      {keepAlivePages.map(({ path, key, Component, guard }) => {
        if (!visited.has(key)) return null;
        if (guard && !guard()) return null;
        const active = location.pathname === path;
        return (
          <div
            key={key}
            className="keepalive-page h-full overflow-y-auto custom-scrollbar pt-[72px] pb-[72px] md:pt-0 md:pb-0 px-4 md:px-8"
            style={{ display: active ? 'block' : 'none' }}
          >
            <div className="max-w-4xl mx-auto">
              <BabyBanner />
              <Component />
            </div>
          </div>
        );
      })}

      {!isKeepAlivePage && (
        <div className="h-full overflow-y-auto custom-scrollbar pt-0 pb-0 px-4 md:px-8">
          <div className="max-w-4xl mx-auto">
            <Suspense fallback={<PageFallback />}>
              <Routes location={location}>
                <Route path="/record/new" element={<RecordFormPage />} />
                <Route path="/record/:id/edit" element={<RecordFormPage />} />
                <Route path="/plan/new" element={<PlanFormPage />} />
                <Route path="/plan/:id/edit" element={<PlanFormPage />} />
                <Route path="/growth/history" element={<GrowthHistoryPage />} />
                <Route path="/growth/health/:id" element={<HealthTrackingPage />} />
              </Routes>
            </Suspense>
          </div>
        </div>
      )}
    </>
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/baby/setup" element={<ProtectedRoute><BabySetupPage /></ProtectedRoute>} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Layout>
                <KeepAliveRoutes />
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </Suspense>
  );
}
