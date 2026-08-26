import { lazy, Suspense, useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Routes, Route, Navigate, useLocation, Link, type Location } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { useBaby } from './contexts/BabyContext';
import { useI18n } from './contexts/I18nContext';
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
import MePage from './pages/MePage';
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
  const { t } = useI18n();
  if (loading) return <div className="flex items-center justify-center h-screen">{t('common.loading')}</div>;
  if (!user) return <Navigate to="/login" />;
  return <>{children}</>;
}

function BabyBanner() {
  const { currentBaby, loading } = useBaby();
  const { t } = useI18n();
  if (loading || currentBaby) return null;
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/30">
      <p className="text-sm text-amber-800 dark:text-amber-200">{t('baby.noneBanner')}</p>
      <Link to="/baby/setup" className="shrink-0 text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400">
        {t('baby.goAdd')}
      </Link>
    </div>
  );
}

const PAGE_TRANSITION_MS = 320;

const TAB_ORDER = ['/', '/plans', '/growth', '/moments', '/me', '/health', '/admin'];

const KA_PATH_TO_KEY: Record<string, string> = {
  '/': 'today',
  '/growth': 'growth',
  '/me': 'me',
  '/plans': 'plans',
  '/health': 'health',
  '/moments': 'moments',
  '/admin': 'admin',
};

function tabIndex(pathname: string) {
  return TAB_ORDER.indexOf(pathname);
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function transitionDuration() {
  return prefersReducedMotion() ? 0 : PAGE_TRANSITION_MS;
}

type MotionDir = 'forward' | 'back';
type MotionPhase = 'in' | 'out' | 'shown' | 'hidden';

function KeepAlivePageWrapper({
  active,
  held,
  direction,
  animateOnMount,
  Component,
}: {
  active: boolean;
  held: boolean;
  direction: MotionDir;
  animateOnMount: boolean;
  Component: React.ComponentType;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { pullDistance, refreshing, ctxValue } = usePullRefresh(containerRef);
  const [phase, setPhase] = useState<MotionPhase>(() =>
    active ? (animateOnMount ? 'in' : 'shown') : 'hidden',
  );
  const prevActive = useRef(active);
  const prevHeld = useRef(held);

  useLayoutEffect(() => {
    const wasActive = prevActive.current;
    const wasHeld = prevHeld.current;
    if (active === wasActive && held === wasHeld) return;
    prevActive.current = active;
    prevHeld.current = held;

    if (active && !wasActive) {
      setPhase(wasHeld ? 'shown' : 'in');
    } else if (!active && wasActive) {
      setPhase(held ? 'hidden' : 'out');
    } else if (!active && wasHeld && !held) {
      setPhase('hidden');
    }
  }, [active, held]);

  useEffect(() => {
    if (phase !== 'in' && phase !== 'out') return;
    const t = window.setTimeout(
      () => setPhase(phase === 'in' ? 'shown' : 'hidden'),
      transitionDuration(),
    );
    return () => clearTimeout(t);
  }, [phase]);

  return (
    <div
      ref={containerRef}
      className="keepalive-page absolute inset-0 overflow-y-auto custom-scrollbar pt-[72px] pb-[72px] md:pt-6 md:pb-0"
      data-active={active}
      data-phase={phase}
      data-dir={direction}
      onAnimationEnd={(e) => {
        if (e.target !== e.currentTarget) return;
        if (phase === 'in') setPhase('shown');
        if (phase === 'out') setPhase('hidden');
      }}
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
    { path: '/', key: 'today', Component: TimelinePage },
    { path: '/growth', key: 'growth', Component: GrowthPage },
    { path: '/me', key: 'me', Component: MePage },
    { path: '/plans', key: 'plans', Component: PlansPage },
    { path: '/health', key: 'health', Component: HealthPage },
    { path: '/moments', key: 'moments', Component: MomentsPage },
    { path: '/admin', key: 'admin', Component: AdminPage, guard: () => isAdmin },
  ], [isAdmin]);

  const [visited, setVisited] = useState<Set<string>>(() => {
    const key = KA_PATH_TO_KEY[location.pathname];
    return key ? new Set([key]) : new Set();
  });

  const activeKeepAlive = keepAlivePages.find((p) => p.path === location.pathname);
  const isKeepAlivePage = !!activeKeepAlive;

  if (activeKeepAlive && (!activeKeepAlive.guard || activeKeepAlive.guard()) && !visited.has(activeKeepAlive.key)) {
    setVisited(new Set([...visited, activeKeepAlive.key]));
  }

  const isFirstPaint = useRef(true);
  useLayoutEffect(() => {
    isFirstPaint.current = false;
  }, []);

  const directionRef = useRef<MotionDir>('forward');
  const prevPathRef = useRef(location.pathname);
  if (prevPathRef.current !== location.pathname) {
    const from = tabIndex(prevPathRef.current);
    const to = tabIndex(location.pathname);
    if (from >= 0 && to >= 0 && from !== to) {
      directionRef.current = to > from ? 'forward' : 'back';
    }
    prevPathRef.current = location.pathname;
  }
  const direction = directionRef.current;

  const lastKaKeyRef = useRef(activeKeepAlive?.key ?? KA_PATH_TO_KEY[location.pathname] ?? 'today');
  if (activeKeepAlive) lastKaKeyRef.current = activeKeepAlive.key;

  const [secondary, setSecondary] = useState<{ loc: Location; mode: 'in' | 'out' | 'idle' } | null>(
    () => (isKeepAlivePage ? null : { loc: location, mode: 'in' }),
  );
  const secondaryRef = useRef(secondary);
  secondaryRef.current = secondary;

  useLayoutEffect(() => {
    if (!isKeepAlivePage) {
      setSecondary((prev) => ({
        loc: location,
        mode: !prev || prev.mode === 'out' ? 'in' : prev.mode,
      }));
      return;
    }
    if (!secondaryRef.current) return;
    setSecondary((prev) => (prev ? { ...prev, mode: 'out' } : null));
    const t = window.setTimeout(() => {
      setSecondary((prev) => (prev?.mode === 'out' ? null : prev));
    }, transitionDuration());
    return () => clearTimeout(t);
  }, [isKeepAlivePage, location]);

  const nonKaScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isKeepAlivePage && nonKaScrollRef.current) {
      const body = nonKaScrollRef.current.querySelector('.glass-page-body');
      if (body) body.scrollTop = 0;
    }
  }, [location.pathname, isKeepAlivePage]);

  return (
    <div className="relative h-full overflow-hidden">
      {keepAlivePages.map(({ path, key, Component, guard }) => {
        if (!visited.has(key)) return null;
        if (guard && !guard()) return null;
        const active = location.pathname === path;
        const held = !isKeepAlivePage && lastKaKeyRef.current === key;
        return (
          <KeepAlivePageWrapper
            key={key}
            active={active}
            held={held}
            direction={direction}
            animateOnMount={!isFirstPaint.current}
            Component={Component}
          />
        );
      })}

      {secondary && (
        <div
          ref={nonKaScrollRef}
          className={`secondary-pane absolute inset-0 z-10 overflow-hidden ${
            secondary.mode === 'out' ? 'is-exiting' : secondary.mode === 'in' ? 'is-entering' : ''
          }`}
          onAnimationEnd={(e) => {
            if (e.target !== e.currentTarget) return;
            if (secondary.mode === 'in') {
              setSecondary((prev) => (prev?.mode === 'in' ? { ...prev, mode: 'idle' } : prev));
            }
          }}
        >
          <div className="secondary-pane-inner h-full">
            <Suspense fallback={<PageFallback />}>
              <Routes location={secondary.loc}>
                <Route path="/records" element={<Navigate to="/" replace />} />
                <Route path="/record/new" element={<RecordFormPage />} />
                <Route path="/record/:id/edit" element={<RecordFormPage />} />
                <Route path="/plan/new" element={<PlanFormPage />} />
                <Route path="/plan/:id/edit" element={<PlanFormPage />} />
                <Route path="/growth/history" element={<GrowthHistoryPage />} />
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
    </div>
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
