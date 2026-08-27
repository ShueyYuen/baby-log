import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { SecondaryHeader } from '../components/SecondaryHeader';
import { Skeleton } from '../components/ui/skeleton';
import AdminFilesSection from './AdminFilesSection';

export default function AdminFilesPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="absolute inset-0 glass-page-shell">
        <SecondaryHeader title={t('admin.filesTitle')} />
        <div className="glass-page-body custom-scrollbar space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
          </div>
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      </div>
    );
  }
  if (!isAdmin) return <Navigate to="/me" replace />;

  return <AdminFilesSection />;
}
