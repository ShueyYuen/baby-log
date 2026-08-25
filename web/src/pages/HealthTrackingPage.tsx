import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useBaby } from '../contexts/BabyContext';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { api, generateIdempotencyKey, toStoredMedia, type HealthCondition, type HealthEntry, type HealthAnnotationsMap, type RecordImage, type UploadMomentResult } from '../lib/api';
import { useServerEvent } from '../hooks/useServerEvents';
import dayjs from 'dayjs';
import { ArrowLeft, Plus, Pencil, Trash2, ImagePlus, X, AlertCircle, CheckCircle2, Ruler } from 'lucide-react';
import { Button, Input, Card, CardContent, Dialog, DialogContent, DialogHeader, DialogTitle, Badge, DatePicker, ConfirmDialog, ImageViewer, MediaCover, toViewerImages, useToast } from '../components/ui';
import { Textarea } from '../components/ui';
import { VisibilityPicker } from '../components/ui/visibility-picker';
import { ImageAnnotator, type Annotation } from '../components/ImageAnnotator';

interface EntryPreview {
  file?: File;
  url: string;
  result?: UploadMomentResult;
  progress?: number;
  error?: boolean;
  cancelled?: boolean;
  type: 'image' | 'video';
  existing?: RecordImage;
  visibleTo?: string[];
}

const CONCURRENT = 2;
const STEP = 5;

function UploadRing({ progress, error }: { progress: number; error?: boolean }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  const off = c - (progress / 100) * c;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
      {error ? (
        <AlertCircle size={14} className="text-red-400" />
      ) : (
        <div className="relative w-8 h-8">
          <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
            <circle cx="18" cy="18" r={r} fill="none" stroke="white" strokeWidth="2.5" opacity={0.3} />
            <circle cx="18" cy="18" r={r} fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} className="transition-[stroke-dashoffset] duration-200" />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-white text-[8px] font-semibold">{progress}%</span>
        </div>
      )}
    </div>
  );
}

function recordImageToPreview(img: RecordImage): EntryPreview {
  return {
    url: img.url,
    type: (img.mediaType === 'video' ? 'video' : 'image') as 'image' | 'video',
    existing: img,
    visibleTo: img.visibleTo,
    result: { url: img.url, key: img.key, rawUrl: img.rawUrl, rawKey: img.rawKey, posterKey: img.posterKey, posterUrl: img.posterUrl, mediaType: img.mediaType || 'image' },
  };
}

function ViewAnnotationPanel({ entry, imageIdx, onImageIdxChange, isViewer, onSave, onClose }: {
  entry: HealthEntry;
  imageIdx: number;
  onImageIdxChange: (idx: number) => void;
  isViewer: boolean;
  onSave: (annotations: HealthAnnotationsMap) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [localAnnotations, setLocalAnnotations] = useState<HealthAnnotationsMap>(entry.annotations || {});
  const currentImg = entry.images[imageIdx];
  const imgKey = currentImg?.key || '';

  return (
    <div className="space-y-3">
      {entry.images.length > 1 && (
        <div className="flex gap-1 overflow-x-auto pb-2">
          {entry.images.map((img, i) => (
            img.mediaType !== 'video' && (
              <img
                key={i}
                src={img.url}
                alt=""
                className={`w-10 h-10 rounded object-cover cursor-pointer border-2 ${i === imageIdx ? 'border-primary-500' : 'border-transparent'}`}
                onClick={() => onImageIdxChange(i)}
              />
            )
          ))}
        </div>
      )}
      <ImageAnnotator
        imageUrl={currentImg.url}
        annotations={(localAnnotations[imgKey] || []) as Annotation[]}
        onChange={(annos) => setLocalAnnotations((prev) => ({ ...prev, [imgKey]: annos }))}
        readonly={isViewer}
      />
      {!isViewer && (
        <div className="flex gap-3">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="button" className="flex-1" onClick={() => onSave(localAnnotations)}>{t('tracking.saveAnnotation')}</Button>
        </div>
      )}
    </div>
  );
}

export default function HealthTrackingPage() {
  const { id: conditionId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentBaby, loading: babyLoading } = useBaby();
  const { isViewer } = useAuth();
  const { t } = useI18n();
  const { toast } = useToast();

  const [condition, setCondition] = useState<HealthCondition | null>(null);
  const [entries, setEntries] = useState<HealthEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Entry form state
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [entryDate, setEntryDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [entryNote, setEntryNote] = useState('');
  const [entryPreviews, setEntryPreviews] = useState<EntryPreview[]>([]);
  const [entryUploading, setEntryUploading] = useState(false);
  const entryCancelledRef = useRef<Set<number>>(new Set());
  const [editingEntry, setEditingEntry] = useState<HealthEntry | null>(null);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [formAnnotations, setFormAnnotations] = useState<HealthAnnotationsMap>({});

  // Annotation dialog within form
  const [annotatingIdx, setAnnotatingIdx] = useState<number | null>(null);

  // Annotation dialog for viewing existing entries
  const [viewAnnotationEntry, setViewAnnotationEntry] = useState<HealthEntry | null>(null);
  const [viewAnnotationImgIdx, setViewAnnotationImgIdx] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerImages, setViewerImages] = useState<ReturnType<typeof toViewerImages>>([]);

  // Edit condition state
  const [showEditCondition, setShowEditCondition] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [deletingCondition, setDeletingCondition] = useState(false);

  useEffect(() => {
    if (babyLoading || !conditionId) {
      return;
    }
    if (!currentBaby) {
      setLoading(false);
      return;
    }
    setLoading(true);
    loadConditionAndEntries();
  }, [conditionId, currentBaby, babyLoading]);

  // Auto-load when sentinel enters viewport
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || loadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          loadMore();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, page]);

  const loadConditionAndEntries = async () => {
    if (!conditionId || !currentBaby) return;
    try {
      const conditionsRes = await api.healthConditions.list(currentBaby.id);
      const cond = conditionsRes.data.find((c) => c.id === conditionId);
      if (!cond) {
        setCondition(null);
        setLoading(false);
        return;
      }
      setCondition(cond);
      try {
        const entriesRes = await api.healthConditions.listEntries(conditionId, 1);
        setEntries(entriesRes.data.items);
        setHasMore(entriesRes.data.hasMore);
        setPage(1);
      } catch (e) {
        console.error('Failed to load entries:', e);
      }
    } catch (e) {
      console.error('Failed to load condition:', e);
    } finally {
      setLoading(false);
    }
  };

  useServerEvent('health.change', useCallback(() => {
    if (conditionId) loadEntries(1, true);
  }, [conditionId]));

  const loadEntries = async (p: number, replace: boolean) => {
    if (!conditionId) return;
    try {
      const res = await api.healthConditions.listEntries(conditionId, p);
      if (replace) {
        setEntries(res.data.items);
      } else {
        setEntries((prev) => [...prev, ...res.data.items]);
      }
      setHasMore(res.data.hasMore);
      setPage(p);
    } finally {
      setLoadingMore(false);
    }
  };

  const loadMore = () => {
    if (loadingMore) return;
    setLoadingMore(true);
    loadEntries(page + 1, false);
  };

  const toggleStatus = async () => {
    if (!condition) return;
    const newStatus = condition.status === 'active' ? 'resolved' : 'active';
    try {
      const res = await api.healthConditions.update(condition.id, { status: newStatus });
      setCondition(res.data);
      toast(newStatus === 'resolved' ? t('tracking.markedResolved') : t('tracking.reactivated'), 'success');
    } catch {
      toast(t('tracking.actionFailed'), 'error');
    }
  };

  const updateCondition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!condition || !editName.trim()) return;
    try {
      const res = await api.healthConditions.update(condition.id, {
        name: editName.trim(),
        description: editDesc.trim() || null,
      });
      setCondition(res.data);
      setShowEditCondition(false);
      toast(t('tracking.updated'), 'success');
    } catch {
      toast(t('tracking.updateFailed'), 'error');
    }
  };

  const deleteCondition = async () => {
    if (!condition) return;
    try {
      await api.healthConditions.delete(condition.id);
      toast(t('tracking.deleted'), 'success');
      navigate('/health');
    } catch {
      toast(t('tracking.deleteFailed'), 'error');
    }
    setDeletingCondition(false);
  };

  // Entry operations
  const handleEntryUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const allowed = Array.from(files);
    const startIdx = entryPreviews.length;

    const placeholders: EntryPreview[] = allowed.map((f) => ({
      file: f, url: '', type: f.type.startsWith('video/') ? 'video' as const : 'image' as const, progress: 0,
    }));
    setEntryPreviews((prev) => [...prev, ...placeholders]);
    entryCancelledRef.current = new Set();
    setEntryUploading(true);

    for (let i = 0; i < allowed.length; i++) {
      const blobUrl = URL.createObjectURL(allowed[i]);
      setEntryPreviews((prev) => {
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

      if (entryCancelledRef.current.has(fileIdx)) {
        await uploadNext();
        return;
      }

      try {
        const result = await api.healthConditions.uploadMedia(allowed[myIdx], (pct) => {
          if (entryCancelledRef.current.has(fileIdx)) return;
          const stepped = Math.floor(pct / STEP) * STEP;
          if (stepped <= lastR[myIdx]) return;
          lastR[myIdx] = stepped;
          setEntryPreviews((prev) => { const n = [...prev]; if (n[fileIdx]) n[fileIdx] = { ...n[fileIdx], progress: stepped }; return n; });
        });
        if (!entryCancelledRef.current.has(fileIdx)) {
          setEntryPreviews((prev) => { const n = [...prev]; if (n[fileIdx]) n[fileIdx] = { ...n[fileIdx], result, progress: undefined }; return n; });
        }
      } catch {
        if (!entryCancelledRef.current.has(fileIdx)) {
          setEntryPreviews((prev) => { const n = [...prev]; if (n[fileIdx]) n[fileIdx] = { ...n[fileIdx], error: true, progress: undefined }; return n; });
        }
      }
      await uploadNext();
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENT, allowed.length) }, () => uploadNext()));
    setEntryUploading(false);
  }, [entryPreviews.length]);

  const removeEntryPreview = useCallback((idx: number) => {
    entryCancelledRef.current.add(idx);
    setEntryPreviews((prev) => {
      const next = [...prev];
      if (next[idx]) {
        if (next[idx].file) URL.revokeObjectURL(next[idx].url);
        next[idx] = { ...next[idx], cancelled: true };
      }
      return next;
    });
  }, []);

  const entryUploadingCount = entryPreviews.filter(
    (p) => p.file && !p.result && !p.error && !p.cancelled,
  ).length;

  useEffect(() => {
    if (entryUploading && entryUploadingCount === 0) {
      setEntryUploading(false);
    }
  }, [entryUploading, entryUploadingCount]);

  const openNewEntry = () => {
    setEditingEntry(null);
    setEntryDate(dayjs().format('YYYY-MM-DD'));
    setEntryNote('');
    setEntryPreviews([]);
    setFormAnnotations({});
    setShowEntryForm(true);
  };

  const openEditEntry = (entry: HealthEntry) => {
    setEditingEntry(entry);
    setEntryDate(dayjs(entry.date).format('YYYY-MM-DD'));
    setEntryNote(entry.note || '');
    setEntryPreviews((entry.images || []).map(recordImageToPreview));
    setFormAnnotations(entry.annotations || {});
    setShowEntryForm(true);
  };

  const saveEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!conditionId || entryUploading) return;
    const completed = entryPreviews.filter((p) => p.result && !p.cancelled).map((p) => toStoredMedia(p.result!, { visibleTo: p.visibleTo }));

    const hasAnnotations = Object.keys(formAnnotations).some((k) => formAnnotations[k].length > 0);

    try {
      if (editingEntry) {
        await api.healthConditions.updateEntry(conditionId, editingEntry.id, {
          date: new Date(entryDate).toISOString(),
          note: entryNote.trim() || null,
          images: completed,
          annotations: hasAnnotations ? formAnnotations : null,
        } as any);
      } else {
        await api.healthConditions.createEntry(
          conditionId,
          {
            date: new Date(entryDate).toISOString(),
            note: entryNote.trim() || undefined,
            images: completed.length > 0 ? completed : undefined,
            annotations: hasAnnotations ? formAnnotations : undefined,
          } as any,
          generateIdempotencyKey()
        );
      }
      setShowEntryForm(false);
      setEntryPreviews([]);
      setFormAnnotations({});
      loadEntries(1, true);
      toast(editingEntry ? t('tracking.recordUpdated') : t('tracking.recordAdded'), 'success');
    } catch {
      toast(t('tracking.saveFailed'), 'error');
    }
  };

  const deleteEntry = async (entryId: string) => {
    if (!conditionId) return;
    try {
      await api.healthConditions.deleteEntry(conditionId, entryId);
      toast(t('tracking.recordDeleted'), 'success');
      loadEntries(1, true);
    } catch {
      toast(t('tracking.deleteFailed'), 'error');
    }
    setDeletingEntryId(null);
  };

  const openAnnotator = (entry: HealthEntry, imageIdx: number) => {
    setViewAnnotationEntry(entry);
    setViewAnnotationImgIdx(imageIdx);
  };

  const saveViewAnnotations = async (annotations: HealthAnnotationsMap) => {
    if (!viewAnnotationEntry || !conditionId) return;
    try {
      const hasAnnotations = Object.keys(annotations).some((k) => annotations[k].length > 0);
      await api.healthConditions.updateEntry(conditionId, viewAnnotationEntry.id, {
        annotations: hasAnnotations ? annotations : null,
      } as any);
      setViewAnnotationEntry(null);
      loadEntries(1, true);
      toast(t('tracking.annotationSaved'), 'success');
    } catch {
      toast(t('tracking.saveFailed'), 'error');
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/health')} className="p-1.5 rounded-md text-gray-500 hover:text-gray-700 glass-icon-btn transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h2 className="text-xl font-semibold dark:text-gray-100">{t('common.loading')}</h2>
        </div>
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!condition) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/health')} className="p-1.5 rounded-md text-gray-500 hover:text-gray-700 glass-icon-btn transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h2 className="text-xl font-semibold dark:text-gray-100">{t('common.notFound')}</h2>
        </div>
        <p className="text-center text-gray-400 py-8">{t('tracking.notFound')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/health')}
          className="p-1.5 rounded-md text-gray-500 hover:text-gray-700 glass-icon-btn transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-semibold dark:text-gray-100 truncate">{condition.name}</h2>
          {condition.description && (
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{condition.description}</p>
          )}
        </div>
        <Badge variant={condition.status === 'active' ? 'default' : 'secondary'}>
          {condition.status === 'active' ? t('health.tracking') : t('health.resolved')}
        </Badge>
      </div>

      {/* Actions */}
      {!isViewer && (
        <div className="flex gap-2">
          <Button size="sm" onClick={openNewEntry}>
            <Plus size={14} /> {t('tracking.addRecord')}
          </Button>
          <Button size="sm" variant="outline" onClick={toggleStatus}>
            <CheckCircle2 size={14} /> {condition.status === 'active' ? t('tracking.markResolved') : t('tracking.reactivate')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setEditName(condition.name); setEditDesc(condition.description || ''); setShowEditCondition(true); }}>
            <Pencil size={14} />
          </Button>
          <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600" onClick={() => setDeletingCondition(true)}>
            <Trash2 size={14} />
          </Button>
        </div>
      )}

      {/* Timeline Entries */}
      {entries.length === 0 ? (
        <p className="text-center text-gray-400 py-8">{t('tracking.noRecords')}</p>
      ) : (
        <div className="relative pl-6">
          {/* Timeline vertical line */}
          <div className="absolute left-2.5 top-2 bottom-2 w-px glass-timeline-line" />

          {entries.map((entry, entryIdx) => {
            const images = (entry.images || []).filter((img) => img.mediaType !== 'video');
            const videos = (entry.images || []).filter((img) => img.mediaType === 'video');
            const hasAnnotations = (img: RecordImage) => entry.annotations && entry.annotations[img.key]?.length > 0;

            return (
              <div key={entry.id} className={`relative ${entryIdx < entries.length - 1 ? 'pb-6' : ''}`}>
                {/* Timeline dot — centered on the line at left-2.5 (10px) */}
                <div className="absolute -left-5 top-1 w-3 h-3 rounded-full glass-timeline-dot" />

                {/* Date + actions */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                    {dayjs(entry.date).format(t('dateFmt.ymd'))}
                  </span>
                  {!isViewer && (
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => openEditEntry(entry)} className="p-1 rounded text-gray-400 hover:text-primary-500 glass-icon-btn transition-colors">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => setDeletingEntryId(entry.id)} className="p-1 rounded text-gray-400 hover:text-red-500 glass-icon-btn transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Images with annotations — displayed prominently */}
                {images.length > 0 && (
                  <div className="space-y-2 mb-2">
                    {images.map((img, i) => (
                      <div key={i} className="rounded-lg overflow-hidden cursor-pointer" onClick={() => openAnnotator(entry, (entry.images || []).indexOf(img))}>
                        {hasAnnotations(img) ? (
                          <ImageAnnotator
                            imageUrl={img.url}
                            annotations={(entry.annotations![img.key] || []) as Annotation[]}
                            readonly
                          />
                        ) : (
                          <img src={img.url} alt="" className="w-full rounded-lg" loading="lazy" />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Videos */}
                {videos.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {videos.map((vid, vi) => (
                      <button
                        key={vi}
                        type="button"
                        className="w-20 h-20 rounded-lg overflow-hidden glass-media-thumb p-0 border-0 cursor-zoom-in"
                        onClick={() => {
                          if (vid.processing) return;
                          const all = toViewerImages(entry.images || []);
                          setViewerImages(all);
                          setViewerIndex(Math.max(0, (entry.images || []).indexOf(vid)));
                          setViewerOpen(true);
                        }}
                      >
                        <MediaCover src={vid.url} mediaType="video" posterSrc={vid.posterUrl} processing={vid.processing} playSize={16} />
                      </button>
                    ))}
                  </div>
                )}

                {/* Note */}
                {entry.note && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{entry.note}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {loadingMore && (
        <div className="flex justify-center py-4">
          <div className="w-5 h-5 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {hasMore && !loadingMore && (
        <div ref={sentinelRef} className="h-4" />
      )}
      {!hasMore && entries.length > 0 && !loadingMore && (
        <div className="py-4 text-center text-xs text-gray-300 dark:text-gray-600">
          {t('tracking.loadedAll')}
        </div>
      )}

      {/* Entry Form Dialog */}
      <Dialog open={showEntryForm} onOpenChange={(open) => { if (!open) { setShowEntryForm(false); setEntryPreviews([]); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingEntry ? t('tracking.editRecord') : t('tracking.addRecord')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={saveEntry} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('common.date')}</label>
              <DatePicker value={entryDate} onChange={setEntryDate} placeholder={t('datePicker.pickDate')} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('common.record')}</label>
              <Textarea value={entryNote} onChange={(e) => setEntryNote(e.target.value)} placeholder={t('tracking.notePlaceholder')} rows={3} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('common.photosVideosSlash')}</label>
              <div className="flex flex-wrap gap-2">
                {entryPreviews.map((p, idx) => p.cancelled ? null : (
                  <div key={idx} className="relative w-16 h-16 rounded-lg overflow-hidden glass-media-thumb">
                    {!p.url ? null : (
                      <MediaCover src={p.url} mediaType={p.type} posterSrc={p.result?.posterUrl} playSize={14} />
                    )}
                    {p.file && !p.result && <UploadRing progress={p.progress ?? 0} error={p.error} />}
                    <button type="button" onClick={() => removeEntryPreview(idx)} className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 rounded-full flex items-center justify-center">
                      <X size={10} className="text-white" />
                    </button>
                    {p.result && p.type === 'image' && (
                      <button
                        type="button"
                        onClick={() => setAnnotatingIdx(idx)}
                        className={`absolute bottom-0.5 right-0.5 flex items-center gap-0.5 rounded-md px-1.5 py-1 text-xs transition-colors ${formAnnotations[p.result.key]?.length ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'glass-chip text-gray-500 dark:text-gray-400'}`}
                        title={t('tracking.annotate')}
                      >
                        <Ruler size={12} />
                      </button>
                    )}
                    {p.result && (
                      <div className="absolute bottom-0.5 left-0.5">
                        <VisibilityPicker
                          value={p.visibleTo}
                          onChange={(vt) => setEntryPreviews((prev) => prev.map((item, i) => i === idx ? { ...item, visibleTo: vt } : item))}
                        />
                      </div>
                    )}
                  </div>
                ))}
                <label className="w-16 h-16 rounded-lg glass-upload-zone flex items-center justify-center cursor-pointer transition-colors">
                  <input type="file" accept="image/*,video/*" className="hidden" multiple disabled={entryUploading} onChange={(e) => { handleEntryUpload(e.target.files); e.target.value = ''; }} />
                  {entryUploading && entryUploadingCount > 0 ? <span className="text-[10px] text-gray-400 animate-pulse">{t('common.uploading')}</span> : <ImagePlus size={16} className="text-gray-400" />}
                </label>
              </div>
            </div>

            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={() => { setShowEntryForm(false); setEntryPreviews([]); setFormAnnotations({}); }}>{t('common.cancel')}</Button>
              <Button type="submit" className="flex-1" disabled={entryUploading}>{t('common.save')}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Annotation modal for form images */}
      <Dialog open={annotatingIdx !== null && !!entryPreviews[annotatingIdx!]?.result && !entryPreviews[annotatingIdx!]?.cancelled && entryPreviews[annotatingIdx!]?.type === 'image'} onOpenChange={(open) => { if (!open) setAnnotatingIdx(null); }}>
        <DialogContent className="max-w-lg sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('tracking.annotate')}</DialogTitle>
          </DialogHeader>
          {annotatingIdx !== null && entryPreviews[annotatingIdx]?.result && (
            <div className="space-y-3">
              <ImageAnnotator
                imageUrl={entryPreviews[annotatingIdx].url}
                annotations={(formAnnotations[entryPreviews[annotatingIdx].result!.key] || []) as Annotation[]}
                onChange={(annos) => {
                  const key = entryPreviews[annotatingIdx!].result!.key;
                  setFormAnnotations((prev) => ({ ...prev, [key]: annos }));
                }}
              />
              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setAnnotatingIdx(null)}>{t('common.close')}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Condition Dialog */}
      <Dialog open={showEditCondition} onOpenChange={setShowEditCondition}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('tracking.editInfo')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={updateCondition} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('common.name')}</label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('common.descriptionOptional')}</label>
              <Textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={2} />
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setShowEditCondition(false)}>{t('common.cancel')}</Button>
              <Button type="submit" className="flex-1">{t('common.save')}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deletingEntryId}
        onOpenChange={(open) => { if (!open) setDeletingEntryId(null); }}
        title={t('tracking.deleteRecord')}
        description={t('tracking.deleteRecordDesc')}
        confirmLabel={t('common.delete')}
        variant="danger"
        onConfirm={() => deletingEntryId && deleteEntry(deletingEntryId)}
      />

      <ConfirmDialog
        open={deletingCondition}
        onOpenChange={setDeletingCondition}
        title={t('tracking.deleteTracking')}
        description={t('tracking.deleteTrackingDesc')}
        confirmLabel={t('common.delete')}
        variant="danger"
        onConfirm={deleteCondition}
      />

      {/* Annotation Dialog (viewing existing entries) */}
      <Dialog open={!!viewAnnotationEntry} onOpenChange={(open) => { if (!open) setViewAnnotationEntry(null); }}>
        <DialogContent className="max-w-lg sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('tracking.photoAnnotation')}</DialogTitle>
          </DialogHeader>
          {viewAnnotationEntry && viewAnnotationEntry.images[viewAnnotationImgIdx] && (
            <ViewAnnotationPanel
              entry={viewAnnotationEntry}
              imageIdx={viewAnnotationImgIdx}
              onImageIdxChange={setViewAnnotationImgIdx}
              isViewer={isViewer}
              onSave={saveViewAnnotations}
              onClose={() => setViewAnnotationEntry(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <ImageViewer
        images={viewerImages}
        initialIndex={viewerIndex}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
      />
    </div>
  );
}
