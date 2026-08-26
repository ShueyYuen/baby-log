import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useBaby } from '../contexts/BabyContext';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { api, generateIdempotencyKey, type UploadMomentResult, type RecordImage } from '../lib/api';
import { cacheRead } from '../lib/queryCache';
import { Bell, ImagePlus, X, AlertCircle } from 'lucide-react';
import { SecondaryHeader } from '../components/SecondaryHeader';
import { Button, Input, Textarea, DateTimePicker, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, ImageViewer, useToast } from '../components/ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui';
import dayjs from 'dayjs';

interface ImagePreview {
  file?: File;
  url: string;
  result?: UploadMomentResult;
  progress?: number;
  error?: boolean;
  cancelled?: boolean;
  existing?: RecordImage;
}

const CONCURRENT = 3;
const STEP = 5;

const planTypeValues = ['vaccine', 'doctor', 'checkup', 'medicine', 'custom'] as const;

const vaccineSuggestionKeys = [
  'hepb',
  'bcg',
  'polio',
  'dtp',
  'mmr',
  'je',
  'mening',
  'hepAShort',
  'dt',
  'hib',
  'pcv13',
  'rotavirus',
  'ev71',
  'varicella',
  'influenza',
] as const;

export default function PlanFormPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { id } = useParams();
  const isEditing = !!id;
  const { currentBaby } = useBaby();
  const { isViewer } = useAuth();
  const { t } = useI18n();

  useEffect(() => {
    if (isViewer) navigate('/plans', { replace: true });
  }, [isViewer, navigate]);
  const [title, setTitle] = useState('');
  const [type, setType] = useState('vaccine');
  const [scheduledAt, setScheduledAt] = useState('');
  const [description, setDescription] = useState('');
  const [repeat, setRepeat] = useState('none');
  const [reminder, setReminder] = useState('30');
  const [loading, setLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [imagePreviews, setImagePreviews] = useState<ImagePreview[]>([]);
  const [uploading, setUploading] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIdx, setViewerIdx] = useState(0);
  const imageCancelledRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!isEditing || !currentBaby) return;

    const populatePlan = (plan: any) => {
      setTitle(plan.title);
      setType(plan.type);
      setScheduledAt(dayjs(plan.scheduledAt).format('YYYY-MM-DD HH:mm'));
      setDescription(plan.description || '');
      setRepeat(plan.repeat || 'none');
      setReminder(plan.reminder || '30');
      if (plan.images?.length) {
        setImagePreviews(plan.images.map((img: RecordImage) => ({
          url: img.url,
          existing: img,
          result: { url: img.url, key: img.key, rawUrl: img.rawUrl || '', rawKey: img.rawKey || '', mediaType: img.mediaType || 'image' },
        })));
      }
    };

    // Try location state first (instant)
    const statePlan = (location.state as any)?.plan;
    if (statePlan) {
      populatePlan(statePlan);
      return;
    }

    // Try cache second
    const params = new URLSearchParams({ babyId: currentBaby.id });
    const cKey = `/plans?${params}`;
    const cached = cacheRead<{ success: boolean; data: any[] }>(cKey);
    const cachedPlan = cached?.data?.find((p: any) => p.id === id);
    if (cachedPlan) {
      populatePlan(cachedPlan);
      return;
    }

    // Fallback: fetch from backend
    api.get<{ success: boolean; data: { items: any[] } | any[] }>(`/plans?babyId=${currentBaby.id}`).then((res) => {
      const items = Array.isArray(res.data) ? res.data : res.data.items;
      const plan = items.find((p: any) => p.id === id);
      if (plan) populatePlan(plan);
    });
  }, [id, currentBaby]);

  const handleImageUpload = useCallback(async (files: FileList | File[]) => {
    const allowed = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (!allowed.length) return;
    const startIdx = imagePreviews.length;

    const placeholders: ImagePreview[] = allowed.map((f) => ({
      file: f, url: '', progress: 0,
    }));
    setImagePreviews((prev) => [...prev, ...placeholders]);
    imageCancelledRef.current = new Set();
    setUploading(true);

    for (let i = 0; i < allowed.length; i++) {
      const blobUrl = URL.createObjectURL(allowed[i]);
      setImagePreviews((prev) => {
        const next = [...prev]; const idx = startIdx + i;
        if (next[idx]) next[idx] = { ...next[idx], url: blobUrl };
        return next;
      });
    }

    let queueIdx = 0;
    const lastR: number[] = new Array(allowed.length).fill(-1);
    const uploadNext = async (): Promise<void> => {
      const myIdx = queueIdx++;
      if (myIdx >= allowed.length) return;
      const fileIdx = startIdx + myIdx;

      if (imageCancelledRef.current.has(fileIdx)) {
        await uploadNext();
        return;
      }

      try {
        const result = await api.plans.uploadMedia(allowed[myIdx], (pct) => {
          if (imageCancelledRef.current.has(fileIdx)) return;
          const stepped = Math.floor(pct / STEP) * STEP;
          if (stepped <= lastR[myIdx]) return;
          lastR[myIdx] = stepped;
          setImagePreviews((prev) => { const n = [...prev]; if (n[fileIdx]) n[fileIdx] = { ...n[fileIdx], progress: stepped }; return n; });
        });
        if (!imageCancelledRef.current.has(fileIdx)) {
          setImagePreviews((prev) => { const n = [...prev]; if (n[fileIdx]) n[fileIdx] = { ...n[fileIdx], result, progress: undefined }; return n; });
        }
      } catch {
        if (!imageCancelledRef.current.has(fileIdx)) {
          setImagePreviews((prev) => { const n = [...prev]; if (n[fileIdx]) n[fileIdx] = { ...n[fileIdx], error: true, progress: undefined }; return n; });
        }
      }
      await uploadNext();
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENT, allowed.length) }, () => uploadNext()));
    setUploading(false);
  }, [imagePreviews.length]);

  const removeImage = useCallback((idx: number) => {
    imageCancelledRef.current.add(idx);
    setImagePreviews((prev) => {
      const next = [...prev];
      if (next[idx]) {
        if (next[idx].file) URL.revokeObjectURL(next[idx].url);
        next[idx] = { ...next[idx], cancelled: true };
      }
      return next;
    });
  }, []);

  const uploadingCount = imagePreviews.filter(
    (p) => p.file && !p.result && !p.error && !p.cancelled,
  ).length;

  useEffect(() => {
    if (uploading && uploadingCount === 0) {
      setUploading(false);
    }
  }, [uploading, uploadingCount]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBaby) return;
    setLoading(true);

    const images = imagePreviews
      .filter((p) => p.result && !p.error && !p.cancelled)
      .map((p) => ({ key: p.result!.key, rawKey: p.result!.rawKey, mediaType: p.result!.mediaType || 'image' }));

    try {
      if (isEditing) {
        await api.plansCrud.update(id!, {
          title,
          type,
          scheduledAt: new Date(scheduledAt).toISOString(),
          description: description || undefined,
          reminder,
          repeat,
          images,
        });
      } else {
        await api.plansCrud.create({
          babyId: currentBaby.id,
          title,
          type,
          scheduledAt: new Date(scheduledAt).toISOString(),
          description: description || undefined,
          reminder,
          repeat,
          images,
        }, generateIdempotencyKey());
      }
      navigate('/plans', { replace: true });
    } catch {
      toast(isEditing ? t('planForm.saveFailed') : t('planForm.createFailed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="absolute inset-0 flex flex-col glass-page-shell"
    >
      <SecondaryHeader
        title={isEditing ? t('planForm.edit') : t('planForm.create')}
        onBack={() => navigate(-1)}
        actions={
          isEditing ? (
            <Button type="submit" form="plan-form" size="sm" disabled={loading}>
              {loading ? t('common.saving') : t('common.save')}
            </Button>
          ) : undefined
        }
      />

      <form id="plan-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto py-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('planForm.type')}</label>
          <div className="flex flex-wrap gap-2">
            {planTypeValues.map((value) => (
              <Button
                key={value}
                type="button"
                variant={type === value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setType(value)}
              >
                {t(`plans.types.${value}`)}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('common.title')}</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('planForm.titlePlaceholder')} required />
          {type === 'vaccine' && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {vaccineSuggestionKeys.map((key) => {
                const name = t(`vaccines.${key}`);
                return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTitle(name)}
                  className="px-2.5 py-1 text-xs rounded-full glass-chip text-gray-600 dark:text-gray-300 hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                >
                  {name}
                </button>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('planForm.scheduledAt')}</label>
          <DateTimePicker value={scheduledAt} onChange={setScheduledAt} placeholder={t('planForm.pickTime')} />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('common.description')}</label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder={t('planForm.descPlaceholder')} />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('common.images')}</label>
          <div className="flex flex-wrap gap-2">
            {imagePreviews.map((p, i) => p.cancelled ? null : (
              <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden glass-media-thumb flex-shrink-0">
                {p.url ? (
                  <img
                    src={p.url}
                    alt=""
                    className="w-full h-full object-cover cursor-zoom-in"
                    onClick={() => {
                      const viewable = imagePreviews.filter((x) => !x.cancelled && x.url);
                      const idx = viewable.findIndex((x) => x === p);
                      if (idx >= 0) {
                        setViewerIdx(idx);
                        setViewerOpen(true);
                      }
                    }}
                  />
                ) : (
                  <div className="w-full h-full glass-media-thumb animate-pulse" />
                )}
                {p.progress != null && !p.error && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <span className="text-white text-xs font-semibold">{p.progress}%</span>
                  </div>
                )}
                {p.error && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <AlertCircle size={14} className="text-red-400" />
                  </div>
                )}
                <button type="button" onClick={() => removeImage(i)} className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80">
                  <X size={12} />
                </button>
              </div>
            ))}
            <label className="w-20 h-20 rounded-lg glass-upload-zone flex items-center justify-center cursor-pointer transition-colors">
              <ImagePlus size={20} className="text-gray-400" />
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  if (e.target.files?.length) handleImageUpload(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('plans.repeat')}</label>
          <Select value={repeat} onValueChange={setRepeat}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('plans.repeats.none')}</SelectItem>
              <SelectItem value="daily">{t('plans.repeats.daily')}</SelectItem>
              <SelectItem value="weekly">{t('plans.repeats.weekly')}</SelectItem>
              <SelectItem value="monthly">{t('plans.repeats.monthly')}</SelectItem>
              <SelectItem value="yearly">{t('plans.repeats.yearly')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            <Bell size={14} className="inline mr-1" />{t('planForm.reminder')}
          </label>
          <Select value={reminder} onValueChange={setReminder}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">{t('planForm.noReminder')}</SelectItem>
              <SelectItem value="10">{t('planForm.remind10')}</SelectItem>
              <SelectItem value="30">{t('planForm.remind30')}</SelectItem>
              <SelectItem value="60">{t('planForm.remind60')}</SelectItem>
              <SelectItem value="120">{t('planForm.remind120')}</SelectItem>
              <SelectItem value="1440">{t('planForm.remind1440')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {!isEditing && (
          <Button type="submit" disabled={loading || uploading} className="w-full">
            {loading ? t('common.creating') : uploading ? t('common.uploading') : t('planForm.createPlan')}
          </Button>
        )}
        {isEditing && (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full py-2.5 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          >
            {t('common.delete')}
          </button>
        )}
      </form>

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('planForm.confirmDelete')}</DialogTitle>
            <DialogDescription>{t('planForm.confirmDeleteDesc')}</DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 mt-4">
            <Button variant="outline" className="flex-1" onClick={() => setShowDeleteConfirm(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={async () => {
                try {
                  await api.plansCrud.delete(id!);
                  navigate('/plans', { replace: true });
                } catch {
                  toast(t('planForm.deleteFailed'), 'error');
                }
              }}
            >
              {t('common.delete')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ImageViewer
        images={imagePreviews
          .filter((p) => !p.cancelled && p.url)
          .map((p) => ({ url: p.result?.url || p.url, rawUrl: p.result?.rawUrl }))}
        initialIndex={viewerIdx}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
      />
    </div>
  );
}
