import { lazy, Suspense, useState, useEffect, useMemo, useRef } from 'react';
import { Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { useBaby } from './contexts/BabyContext';
import { KeepAliveActiveContext } from './hooks/useActivated';
import { usePullRefresh, PullRefreshProvider } from './hooks/usePullRefresh';
import { PullRefreshIndicator } from './components/PullRefreshIndicator';
import { useServerEventsConnection } from './hooks/useServerEvents';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import TimelinePage from './pages/TimelinePage';
import PlansPage from './pages/PlansPage';
import GrowthPage from './pages/GrowthPage';
import HealthPage from './pages/HealthPage';
import MomentsPage from './pages/MomentsPage';
import AdminPage from './pages/AdminPage';

const RecordFormPage = lazy(() => import('./pages/RecordFormPage'));
const PlanFormPage = lazy(() => import('./pages/PlanFormPage'));
const GrowthHistoryPage = lazy(() => import('./pages/GrowthHistoryPage'));
const HealthTrackingPage = lazy(() => import('./pages/HealthTrackingPage'));
const StatsPage = lazy(() => import('./pages/StatsPage'));
const BabySetupPage = lazy(() => import('./pages/BabySetupPage'));
const MilkInventoryPage = lazy(() => import('./pages/MilkInventoryPage'));
const MedicalVisitsPage = lazy(() => import('./pages/MedicalVisitsPage'));

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

function KeepAlivePageWrapper({
  active,
  Component,
}: {
  active: boolean;
  Component: React.ComponentType;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { pullDistance, refreshing, ctxValue } = usePullRefresh(containerRef);

  return (
    <div
      ref={containerRef}
      className="keepalive-page h-full overflow-y-auto custom-scrollbar pt-[72px] pb-[72px] md:pt-6 md:pb-0 px-4 md:px-8"
      data-active={active}
      style={{ display: active ? 'block' : 'none' }}
    >
      <div className="max-w-4xl mx-auto">
        <PullRefreshIndicator pullDistance={pullDistance} refreshing={refreshing} />
        <KeepAliveActiveContext.Provider value={active}>
          <PullRefreshProvider value={ctxValue}>
            <BabyBanner />
            <Component />
          </PullRefreshProvider>
        </KeepAliveActiveContext.Provider>
      </div>
    </div>
  );
}

function KeepAliveRoutes() {
  const location = useLocation();
  const { isAdmin } = useAuth();
  useServerEventsConnection(true);

  const keepAlivePages = useMemo(() => [
    { path: '/', key: 'timeline', Component: TimelinePage },
    { path: '/plans', key: 'plans', Component: PlansPage },
    { path: '/growth', key: 'growth', Component: GrowthPage },
    { path: '/health', key: 'health', Component: HealthPage },
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

  const nonKaScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isKeepAlivePage && nonKaScrollRef.current) {
      nonKaScrollRef.current.scrollTop = 0;
    }
  }, [location.pathname, isKeepAlivePage]);

  return (
    <>
      {keepAlivePages.map(({ path, key, Component, guard }) => {
        if (!visited.has(key)) return null;
        if (guard && !guard()) return null;
        const active = location.pathname === path;
        return (
          <KeepAlivePageWrapper key={key} active={active} Component={Component} />
        );
      })}

      {!isKeepAlivePage && (
        <div ref={nonKaScrollRef} className="h-full overflow-y-auto custom-scrollbar pt-0 pb-0 md:pt-6 px-4 md:px-8">
          <div className="max-w-4xl mx-auto">
            <Suspense fallback={<PageFallback />}>
              <Routes location={location}>
                <Route path="/record/new" element={<RecordFormPage />} />
                <Route path="/record/:id/edit" element={<RecordFormPage />} />
                <Route path="/plan/new" element={<PlanFormPage />} />
                <Route path="/plan/:id/edit" element={<PlanFormPage />} />
                <Route path="/growth/history" element={<GrowthHistoryPage />} />
                <Route path="/growth/health/:id" element={<HealthTrackingPage />} />
                <Route path="/health/:id" element={<HealthTrackingPage />} />
                <Route path="/stats" element={<StatsPage />} />
                <Route path="/milk-inventory" element={<MilkInventoryPage />} />
                <Route path="/medical-visits/new" element={<MedicalVisitsPage />} />
                <Route path="/medical-visits/:id" element={<MedicalVisitsPage />} />
                <Route path="/medical-visits/:id/edit" element={<MedicalVisitsPage />} />
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
