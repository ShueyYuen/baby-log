import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { ArrowLeft, Plus, Refrigerator, Snowflake, Check, Trash2 } from 'lucide-react';
import { useBaby } from '../contexts/BabyContext';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import type { TranslateFn } from '../i18n';
import { api, generateIdempotencyKey, type MilkInventoryItem } from '../lib/api';
import { cacheInvalidate, cacheRead, cacheWrite } from '../lib/queryCache';
import { useRefreshHandler } from '../hooks/usePullRefresh';
import { useActivated } from '../hooks/useActivated';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
  useToast,
  ScrollDateTimePicker,
  DateTimePicker,
} from '../components/ui';
import { Skeleton } from '../components/ui/skeleton';

dayjs.extend(relativeTime);

type ExpiryState = 'ok' | 'warning' | 'expired';

function getExpiryState(item: MilkInventoryItem): ExpiryState {
  if (item.status === 'expired') return 'expired';
  const msLeft = new Date(item.expiresAt).getTime() - Date.now();
  if (msLeft <= 0) return 'expired';
  if (msLeft <= 24 * 60 * 60 * 1000) return 'warning';
  return 'ok';
}

function formatRemaining(expiresAt: string, t: TranslateFn): string {
  const msLeft = new Date(expiresAt).getTime() - Date.now();
  if (msLeft <= 0) return t('milkInv.expired');
  const hours = Math.floor(msLeft / (60 * 60 * 1000));
  if (hours < 24) return hours > 0 ? t('milkInv.remainingHours', { n: hours }) : t('milkInv.remainingLtHour');
  const days = Math.floor(hours / 24);
  return t('milkInv.remainingDays', { n: days });
}

function MilkItemCard({
  item,
  isViewer,
  onStatusChange,
}: {
  item: MilkInventoryItem;
  isViewer: boolean;
  onStatusChange: (id: string, status: 'used' | 'discarded') => void;
}) {
  const { t } = useI18n();
  const expiry = getExpiryState(item);
  const borderClass =
    expiry === 'expired'
      ? 'border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20'
      : expiry === 'warning'
        ? 'border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20'
        : 'glass-toggle-btn';

  return (
    <div className={`rounded-xl border p-3 ${borderClass}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{item.amountMl} ml</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {t('milkInv.storedAt', { time: dayjs(item.storedAt).format('MM/DD HH:mm') })}
          </p>
          <p
            className={`text-xs mt-1 font-medium ${
              expiry === 'expired'
                ? 'text-red-600 dark:text-red-400'
                : expiry === 'warning'
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            {formatRemaining(item.expiresAt, t)}
          </p>
          {item.note && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 truncate">{item.note}</p>
          )}
        </div>
        {expiry === 'expired' && (
          <Badge variant="danger" className="shrink-0">{t('milkInv.expired')}</Badge>
        )}
        {expiry === 'warning' && (
          <Badge className="shrink-0 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 hover:bg-amber-100">
            {t('milkInv.expiring')}
          </Badge>
        )}
      </div>
      {!isViewer && (item.status === 'available' || item.status === 'expired') ? (
        <div className="flex gap-2 mt-3">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 gap-1 text-xs text-green-700 dark:text-green-400 hover:!text-green-700"
            onClick={() => onStatusChange(item.id, 'used')}
          >
            <Check size={14} />
            {t('milkInv.used')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="flex-1 gap-1 text-xs"
            onClick={() => onStatusChange(item.id, 'discarded')}
          >
            <Trash2 size={14} />
            {t('milkInv.discard')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default function MilkInventoryPage() {
  const { currentBaby } = useBaby();
  const { isViewer } = useAuth();
  const { t } = useI18n();
  const { toast } = useToast();
  const [items, setItems] = useState<MilkInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addAmount, setAddAmount] = useState('120');
  const [addStorage, setAddStorage] = useState<'fridge' | 'freezer'>('fridge');
  const [addStoredAt, setAddStoredAt] = useState(() => dayjs().format('YYYY-MM-DDTHH:mm'));
  const [addNote, setAddNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async (invalidate = false) => {
    if (!currentBaby) return;
    const cKey = `/milk-inventory?babyId=${currentBaby.id}&status=all`;
    if (invalidate) cacheInvalidate('/milk-inventory');

    const cached = cacheRead<{ success: boolean; data: MilkInventoryItem[] }>(cKey);
    if (cached) {
      setItems(cached.data);
      setLoading(false);
    } else {
      setLoading(true);
    }

    try {
      const res = await api.milkInventory.list(currentBaby.id, 'all');
      cacheWrite(cKey, res);
      setItems(res.data);
    } catch {
      if (!cached) toast(t('milkInv.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [currentBaby, toast, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useActivated(useCallback(() => { loadData(true); }, [loadData]));
  useRefreshHandler(useCallback(async () => { await loadData(true); }, [loadData]));

  const fridgeItems = useMemo(() => items.filter((i) => i.storageType === 'fridge'), [items]);
  const freezerItems = useMemo(() => items.filter((i) => i.storageType === 'freezer'), [items]);
  const fridgeTotal = useMemo(() => fridgeItems.reduce((s, i) => s + i.amountMl, 0), [fridgeItems]);
  const freezerTotal = useMemo(() => freezerItems.reduce((s, i) => s + i.amountMl, 0), [freezerItems]);

  const handleStatusChange = async (id: string, status: 'used' | 'discarded') => {
    try {
      await api.milkInventory.update(id, { status });
      toast(status === 'used' ? t('milkInv.markedUsed') : t('milkInv.markedDiscarded'), 'success');
      loadData(true);
    } catch {
      toast(t('milkInv.actionFailed'), 'error');
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBaby) return;
    const amount = parseFloat(addAmount);
    if (!amount || amount <= 0) {
      toast(t('milkInv.invalidAmount'), 'error');
      return;
    }
    setSubmitting(true);
    try {
      await api.milkInventory.create(
        {
          babyId: currentBaby.id,
          amountMl: amount,
          storageType: addStorage,
          storedAt: new Date(addStoredAt).toISOString(),
          note: addNote || undefined,
        },
        generateIdempotencyKey(),
      );
      toast(t('milkInv.added'), 'success');
      setShowAddDialog(false);
      setAddAmount('120');
      setAddNote('');
      setAddStoredAt(dayjs().format('YYYY-MM-DDTHH:mm'));
      loadData(true);
    } catch {
      toast(t('milkInv.addFailed'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && items.length === 0) {
    return (
      <div className="space-y-4 py-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-20 rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/">
            <ArrowLeft size={20} />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold dark:text-gray-100">{t('milkInv.title')}</h1>
        {!isViewer && (
          <Button size="sm" className="ml-auto" onClick={() => setShowAddDialog(true)}>
            <Plus size={16} />
            {t('milkInv.add')}
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="py-4">
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <div className="flex items-center justify-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 mb-1">
                <Refrigerator size={16} />
                {t('milkInv.fridge')}
              </div>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{Math.round(fridgeTotal)} ml</p>
              <p className="text-xs text-gray-400 mt-0.5">{t('milkInv.bags', { n: fridgeItems.length })}</p>
            </div>
            <div>
              <div className="flex items-center justify-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 mb-1">
                <Snowflake size={16} />
                {t('milkInv.freezer')}
              </div>
              <p className="text-2xl font-bold text-cyan-600 dark:text-cyan-400">{Math.round(freezerTotal)} ml</p>
              <p className="text-xs text-gray-400 mt-0.5">{t('milkInv.bags', { n: freezerItems.length })}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Refrigerator size={18} className="text-blue-500" />
              {t('milkInv.fridgeZone')}
              <span className="text-xs font-normal text-gray-400">{t('milkInv.fridgeHint')}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {fridgeItems.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">{t('milkInv.noFridge')}</p>
            ) : (
              fridgeItems.map((item) => (
                <MilkItemCard key={item.id} item={item} isViewer={isViewer} onStatusChange={handleStatusChange} />
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Snowflake size={18} className="text-cyan-500" />
              {t('milkInv.freezerZone')}
              <span className="text-xs font-normal text-gray-400">{t('milkInv.freezerHint')}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {freezerItems.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">{t('milkInv.noFreezer')}</p>
            ) : (
              freezerItems.map((item) => (
                <MilkItemCard key={item.id} item={item} isViewer={isViewer} onStatusChange={handleStatusChange} />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('milkInv.add')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('milkInv.storage')}</label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setAddStorage('fridge')}
                  className={`flex-1 py-2.5 rounded-lg border-2 text-sm flex items-center justify-center gap-1.5 ${
                    addStorage === 'fridge'
                      ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : 'glass-toggle-btn dark:text-gray-300'
                  }`}
                >
                  <Refrigerator size={16} />
                  {t('milk.fridge')}
                </button>
                <button
                  type="button"
                  onClick={() => setAddStorage('freezer')}
                  className={`flex-1 py-2.5 rounded-lg border-2 text-sm flex items-center justify-center gap-1.5 ${
                    addStorage === 'freezer'
                      ? 'border-cyan-400 bg-cyan-50 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300'
                      : 'glass-toggle-btn dark:text-gray-300'
                  }`}
                >
                  <Snowflake size={16} />
                  {t('milk.freezer')}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('milkInv.amount')}</label>
              <Input type="number" value={addAmount} onChange={(e) => setAddAmount(e.target.value)} min={1} step={5} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('milkInv.storedTime')}</label>
              <ScrollDateTimePicker value={addStoredAt} onChange={setAddStoredAt} className="md:hidden" />
              <DateTimePicker value={addStoredAt} onChange={setAddStoredAt} placeholder={t('milkInv.pickStoredTime')} className="hidden md:flex" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('common.note')}</label>
              <Textarea value={addNote} onChange={(e) => setAddNote(e.target.value)} rows={2} placeholder={t('milkInv.notePlaceholder')} />
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setShowAddDialog(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" className="flex-1" disabled={submitting}>
                {submitting ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
