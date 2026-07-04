import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import TimelinePage from './pages/TimelinePage';

const RecordFormPage = lazy(() => import('./pages/RecordFormPage'));
const PlansPage = lazy(() => import('./pages/PlansPage'));
const PlanFormPage = lazy(() => import('./pages/PlanFormPage'));
const GrowthPage = lazy(() => import('./pages/GrowthPage'));
const GrowthHistoryPage = lazy(() => import('./pages/GrowthHistoryPage'));
const StatsPage = lazy(() => import('./pages/StatsPage'));
const BabySetupPage = lazy(() => import('./pages/BabySetupPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const MomentsPage = lazy(() => import('./pages/MomentsPage'));

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

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" />;
  return <>{children}</>;
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
                <Suspense fallback={<PageFallback />}>
                  <Routes>
                    <Route path="/" element={<TimelinePage />} />
                    <Route path="/moments" element={<MomentsPage />} />
                    <Route path="/record/new" element={<RecordFormPage />} />
                    <Route path="/record/:id/edit" element={<RecordFormPage />} />
                    <Route path="/plans" element={<PlansPage />} />
                    <Route path="/plan/new" element={<PlanFormPage />} />
                    <Route path="/plan/:id/edit" element={<PlanFormPage />} />
                    <Route path="/growth" element={<GrowthPage />} />
                    <Route path="/growth/history" element={<GrowthHistoryPage />} />
                    <Route path="/stats" element={<StatsPage />} />
                    <Route path="/admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
                  </Routes>
                </Suspense>
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </Suspense>
  );
}
