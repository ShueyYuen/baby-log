import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { SecondaryHeader } from '../components/SecondaryHeader';
import AdminFilesSection from './AdminFilesSection';

export default function AdminFilesPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="absolute inset-0 glass-page-shell">
        <SecondaryHeader title={t('admin.filesTitle')} />
        <div className="glass-page-body custom-scrollbar flex justify-center">
          <p className="text-sm text-gray-500">{t('common.loading')}</p>
        </div>
      </div>
    );
  }
  if (!isAdmin) return <Navigate to="/me" replace />;

  return (
    <div className="absolute inset-0 glass-page-shell">
      <SecondaryHeader title={t('admin.filesTitle')} />
      <div className="glass-page-body custom-scrollbar">
        <AdminFilesSection />
      </div>
    </div>
  );
}
