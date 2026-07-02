import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import TimelinePage from './pages/TimelinePage';
import RecordFormPage from './pages/RecordFormPage';
import PlansPage from './pages/PlansPage';
import PlanFormPage from './pages/PlanFormPage';
import GrowthPage from './pages/GrowthPage';
import GrowthHistoryPage from './pages/GrowthHistoryPage';
import StatsPage from './pages/StatsPage';
import BabySetupPage from './pages/BabySetupPage';
import AdminPage from './pages/AdminPage';

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
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<TimelinePage />} />
                <Route path="/record/new" element={<RecordFormPage />} />
                <Route path="/record/:id/edit" element={<RecordFormPage />} />
                <Route path="/plans" element={<PlansPage />} />
                <Route path="/plan/new" element={<PlanFormPage />} />
                <Route path="/plan/:id/edit" element={<PlanFormPage />} />
                <Route path="/growth" element={<GrowthPage />} />
                <Route path="/growth/history" element={<GrowthHistoryPage />} />
                <Route path="/stats" element={<StatsPage />} />
                <Route path="/baby/setup" element={<BabySetupPage />} />
                <Route path="/admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
