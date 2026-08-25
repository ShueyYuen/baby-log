import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Calendar,
  ChevronRight,
  Download,
  KeyRound,
  Languages,
  LogOut,
  Monitor,
  Moon,
  Plus,
  Refrigerator,
  Sun,
  Users,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useBaby } from '../contexts/BabyContext';
import { useI18n } from '../contexts/I18nContext';
import { useTheme } from '../contexts/ThemeContext';
import { LOCALES, type TranslateFn } from '../i18n';
import { api, type Member, type TimelineRecord } from '../lib/api';
import { formatBabyAge } from '../lib/baby-age';
import { formatRecordDetail } from '../lib/record-types';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input, useToast } from '../components/ui';

type ThemeOpt = 'light' | 'dark' | 'system' | 'night';

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function recordsToCsv(records: TimelineRecord[], t: TranslateFn): string {
  const header = 'occurredAt,category,type,detail,note,createdBy';
  const rows = records.map((r) => {
    const cells = [
      r.occurredAt,
      r.category,
      r.type,
      formatRecordDetail(r, t).replace(/"/g, '""'),
      (r.note || '').replace(/"/g, '""'),
      r.user?.displayName || '',
    ];
    return cells.map((c) => `"${c}"`).join(',');
  });
  return [header, ...rows].join('\n');
}

export default function MePage() {
  const { user, logout, isAdmin } = useAuth();
  const { babies, currentBaby, setCurrentBaby } = useBaby();
  const { theme, setTheme } = useTheme();
  const { t, locale, setLocale } = useI18n();
  const { toast } = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [pwOpen, setPwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api.members.list().then((res) => setMembers(res.data)).catch(() => {});
  }, []);

  const themeOptions: { value: ThemeOpt; icon: typeof Sun; label: string }[] = [
    { value: 'light', icon: Sun, label: t('theme.light') },
    { value: 'dark', icon: Moon, label: t('theme.dark') },
    { value: 'night', icon: Moon, label: t('theme.night') },
    { value: 'system', icon: Monitor, label: t('theme.system') },
  ];

  const changePassword = async () => {
    if (!currentPw || !newPw) return;
    setSavingPw(true);
    try {
      await api.auth.changePassword(currentPw, newPw);
      toast(t('auth.passwordUpdated'), 'success');
      setPwOpen(false);
      setCurrentPw('');
      setNewPw('');
    } catch (err: any) {
      toast(err.message || t('auth.changeFailed'), 'error');
    } finally {
      setSavingPw(false);
    }
  };

  const handleExport = async (format: 'json' | 'csv') => {
    if (!currentBaby) return;
    setExporting(true);
    try {
      const res = await api.export.baby(currentBaby.id);
      const stamp = new Date().toISOString().slice(0, 10);
      if (format === 'json') {
        downloadBlob(`baby-log-${currentBaby.name}-${stamp}.json`, JSON.stringify(res.data, null, 2), 'application/json');
      } else {
        downloadBlob(`baby-log-${currentBaby.name}-${stamp}.csv`, recordsToCsv(res.data.records || [], t), 'text/csv;charset=utf-8');
      }
      toast(t('me.downloadStarted'), 'success');
    } catch {
      toast(t('me.exportFailed'), 'error');
    } finally {
      setExporting(false);
    }
  };

  const links = [
    { to: '/plans', icon: Calendar, label: t('nav.plans') },
    { to: '/health', icon: Activity, label: t('nav.health') },
    { to: '/stats', icon: BarChart3, label: t('me.stats') },
    { to: '/milk-inventory', icon: Refrigerator, label: t('me.milkInventory') },
    ...(isAdmin ? [{ to: '/admin', icon: Users, label: t('me.userAdmin') }] : []),
  ];

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h2 className="text-xl font-semibold dark:text-gray-100">{t('me.title')}</h2>
        <p className="text-sm text-gray-400 mt-0.5">{user?.displayName}</p>
      </div>

      <section className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-500">{t('baby.section')}</h3>
          <Link to="/baby/setup" className="text-xs text-primary-500 inline-flex items-center gap-0.5">
            <Plus size={12} /> {t('baby.addShort')}
          </Link>
        </div>
        <div className="space-y-2">
          {babies.map((b) => {
            const active = currentBaby?.id === b.id;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => setCurrentBaby(b)}
                className={`w-full flex items-center gap-3 px-2 py-2 rounded-xl text-left ${
                  active ? 'bg-primary-50 dark:bg-primary-900/30' : ''
                }`}
              >
                {b.avatar ? (
                  <img src={b.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <span className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-600 text-sm font-medium flex items-center justify-center">
                    {b.name.slice(0, 1)}
                  </span>
                )}
                <span className="flex-1 min-w-0">
                  <span className="block font-medium dark:text-gray-100 truncate">{b.name}</span>
                  <span className="block text-xs text-gray-400">{formatBabyAge(b.birthDate, t)}</span>
                </span>
                {active && <span className="text-xs text-primary-500">{t('common.current')}</span>}
              </button>
            );
          })}
          {babies.length === 0 && (
            <p className="text-sm text-gray-400 py-2">{t('baby.none')}</p>
          )}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-medium text-gray-500 mb-2 px-1">{t('me.features')}</h3>
        <div className="card divide-y divide-gray-100 dark:divide-white/10 p-0 overflow-hidden">
          {links.map((item) => (
            <Link key={item.to} to={item.to} className="flex items-center gap-3 px-4 py-3 text-sm dark:text-gray-100">
              <item.icon size={18} className="text-gray-400" />
              <span className="flex-1">{item.label}</span>
              <ChevronRight size={16} className="text-gray-300" />
            </Link>
          ))}
        </div>
      </section>

      {members.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-gray-500 mb-2 px-1">{t('me.members')}</h3>
          <div className="card flex flex-wrap gap-2">
            {members.map((m) => (
              <span key={m.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full glass-chip text-xs dark:text-gray-200">
                {m.avatar ? (
                  <img src={m.avatar} alt="" className="w-4 h-4 rounded-full object-cover" />
                ) : null}
                {m.displayName}
              </span>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="text-sm font-medium text-gray-500 mb-2 px-1">{t('theme.section')}</h3>
        <div className="grid grid-cols-4 gap-2">
          {themeOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTheme(opt.value)}
              className={`card py-3 flex flex-col items-center gap-1 text-xs ${
                theme === opt.value ? 'border-primary-400 text-primary-600' : 'text-gray-500'
              }`}
            >
              <opt.icon size={16} />
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-2 px-1">{t('theme.nightHint')}</p>
      </section>

      <section>
        <h3 className="text-sm font-medium text-gray-500 mb-2 px-1">{t('language.section')}</h3>
        <div className="grid grid-cols-2 gap-2">
          {LOCALES.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setLocale(opt.value)}
              className={`card py-3 flex items-center justify-center gap-2 text-sm ${
                locale === opt.value ? 'border-primary-400 text-primary-600' : 'text-gray-500'
              }`}
            >
              <Languages size={16} />
              {opt.nativeLabel}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <button
          type="button"
          onClick={() => currentBaby && handleExport('json')}
          disabled={exporting || !currentBaby}
          className="card w-full flex items-center gap-3 text-sm dark:text-gray-100"
        >
          <Download size={18} className="text-gray-400" />
          {t('me.exportJson')}
        </button>
        <button
          type="button"
          onClick={() => currentBaby && handleExport('csv')}
          disabled={exporting || !currentBaby}
          className="card w-full flex items-center gap-3 text-sm dark:text-gray-100"
        >
          <Download size={18} className="text-gray-400" />
          {t('me.exportCsv')}
        </button>
        <button
          type="button"
          onClick={() => setPwOpen(true)}
          className="card w-full flex items-center gap-3 text-sm dark:text-gray-100"
        >
          <KeyRound size={18} className="text-gray-400" />
          {t('auth.changePassword')}
        </button>
        <button
          type="button"
          onClick={logout}
          className="card w-full flex items-center gap-3 text-sm text-red-500"
        >
          <LogOut size={18} />
          {t('auth.logoutFull')}
        </button>
      </section>

      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('auth.changePassword')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t('auth.currentPassword')}</label>
              <Input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t('auth.newPassword')}</label>
              <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder={t('auth.passwordHint')} />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="secondary" className="flex-1" onClick={() => setPwOpen(false)}>{t('common.cancel')}</Button>
              <Button className="flex-1" disabled={savingPw || !currentPw || !newPw} onClick={changePassword}>
                {savingPw ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
