import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useBaby } from '../contexts/BabyContext';
import { useAuth } from '../contexts/AuthContext';
import { api, generateIdempotencyKey, type HealthCondition, type HealthEntry, type RecordImage, type UploadMomentResult } from '../lib/api';
import dayjs from 'dayjs';
import { ArrowLeft, Plus, Pencil, Trash2, ImagePlus, Play, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button, Input, Card, CardContent, Dialog, DialogContent, DialogHeader, DialogTitle, Badge, DatePicker, ConfirmDialog, useToast } from '../components/ui';
import { Textarea } from '../components/ui';
import { VisibilityPicker } from '../components/ui/visibility-picker';

interface EntryPreview {
  file?: File;
  url: string;
  result?: UploadMomentResult;
  progress?: number;
  error?: boolean;
  type: 'image' | 'video';
  existing?: RecordImage;
  visibleTo?: string[];
}

const CONCURRENT = 5;
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
    result: { url: img.url, key: img.key, rawUrl: img.rawUrl, rawKey: img.rawKey, mediaType: img.mediaType || 'image' },
  };
}

export default function HealthTrackingPage() {
  const { id: conditionId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentBaby } = useBaby();
  const { isViewer } = useAuth();
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
  const [editingEntry, setEditingEntry] = useState<HealthEntry | null>(null);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);

  // Edit condition state
  const [showEditCondition, setShowEditCondition] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [deletingCondition, setDeletingCondition] = useState(false);

  useEffect(() => {
    if (!conditionId || !currentBaby) {
      setLoading(false);
      return;
    }
    loadConditionAndEntries();
  }, [conditionId, currentBaby]);

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
      const [conditionsRes, entriesRes] = await Promise.all([
        api.healthConditions.list(currentBaby.id),
        api.healthConditions.listEntries(conditionId, 1),
      ]);
      const cond = conditionsRes.data.find((c) => c.id === conditionId);
      setCondition(cond || null);
      setEntries(entriesRes.data.items);
      setHasMore(entriesRes.data.hasMore);
      setPage(1);
    } finally {
      setLoading(false);
    }
  };

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
      toast(newStatus === 'resolved' ? '已标记为康复' : '已重新激活', 'success');
    } catch {
      toast('操作失败', 'error');
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
      toast('已更新', 'success');
    } catch {
      toast('更新失败', 'error');
    }
  };

  const deleteCondition = async () => {
    if (!condition) return;
    try {
      await api.healthConditions.delete(condition.id);
      toast('已删除', 'success');
      navigate('/growth');
    } catch {
      toast('删除失败', 'error');
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
      try {
        const result = await api.moments.uploadMediaSingle(allowed[myIdx], (pct) => {
          const stepped = Math.floor(pct / STEP) * STEP;
          if (stepped <= lastR[myIdx]) return;
          lastR[myIdx] = stepped;
          setEntryPreviews((prev) => { const n = [...prev]; if (n[fileIdx]) n[fileIdx] = { ...n[fileIdx], progress: stepped }; return n; });
        });
        setEntryPreviews((prev) => { const n = [...prev]; if (n[fileIdx]) n[fileIdx] = { ...n[fileIdx], result, progress: undefined }; return n; });
      } catch {
        setEntryPreviews((prev) => { const n = [...prev]; if (n[fileIdx]) n[fileIdx] = { ...n[fileIdx], error: true, progress: undefined }; return n; });
      }
      await uploadNext();
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENT, allowed.length) }, () => uploadNext()));
    setEntryUploading(false);
  }, [entryPreviews.length]);

  const removeEntryPreview = useCallback((idx: number) => {
    setEntryPreviews((prev) => {
      const next = [...prev]; const removed = next.splice(idx, 1)[0];
      if (removed.url && removed.file) URL.revokeObjectURL(removed.url);
      return next;
    });
  }, []);

  const openNewEntry = () => {
    setEditingEntry(null);
    setEntryDate(dayjs().format('YYYY-MM-DD'));
    setEntryNote('');
    setEntryPreviews([]);
    setShowEntryForm(true);
  };

  const openEditEntry = (entry: HealthEntry) => {
    setEditingEntry(entry);
    setEntryDate(dayjs(entry.date).format('YYYY-MM-DD'));
    setEntryNote(entry.note || '');
    setEntryPreviews((entry.images || []).map(recordImageToPreview));
    setShowEntryForm(true);
  };

  const saveEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!conditionId || entryUploading) return;
    const completed = entryPreviews.filter((p) => p.result).map((p) => ({
      key: p.result!.key,
      rawKey: p.result!.rawKey,
      mediaType: p.result!.mediaType,
      visibleTo: p.visibleTo?.length ? p.visibleTo : undefined,
    }));

    try {
      if (editingEntry) {
        await api.healthConditions.updateEntry(conditionId, editingEntry.id, {
          date: new Date(entryDate).toISOString(),
          note: entryNote.trim() || null,
          images: completed,
        });
      } else {
        await api.healthConditions.createEntry(
          conditionId,
          { date: new Date(entryDate).toISOString(), note: entryNote.trim() || undefined, images: completed.length > 0 ? completed : undefined },
          generateIdempotencyKey()
        );
      }
      setShowEntryForm(false);
      setEntryPreviews([]);
      loadEntries(1, true);
      toast(editingEntry ? '记录已更新' : '记录已添加', 'success');
    } catch {
      toast('保存失败', 'error');
    }
  };

  const deleteEntry = async (entryId: string) => {
    if (!conditionId) return;
    try {
      await api.healthConditions.deleteEntry(conditionId, entryId);
      toast('记录已删除', 'success');
      loadEntries(1, true);
    } catch {
      toast('删除失败', 'error');
    }
    setDeletingEntryId(null);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/growth')} className="p-1.5 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h2 className="text-xl font-semibold dark:text-gray-100">加载中...</h2>
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
          <button onClick={() => navigate('/growth')} className="p-1.5 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h2 className="text-xl font-semibold dark:text-gray-100">未找到</h2>
        </div>
        <p className="text-center text-gray-400 py-8">病症追踪项目不存在</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/growth')}
          className="p-1.5 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
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
          {condition.status === 'active' ? '追踪中' : '已康复'}
        </Badge>
      </div>

      {/* Actions */}
      {!isViewer && (
        <div className="flex gap-2">
          <Button size="sm" onClick={openNewEntry}>
            <Plus size={14} /> 添加记录
          </Button>
          <Button size="sm" variant="outline" onClick={toggleStatus}>
            <CheckCircle2 size={14} /> {condition.status === 'active' ? '标记康复' : '重新激活'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setEditName(condition.name); setEditDesc(condition.description || ''); setShowEditCondition(true); }}>
            <Pencil size={14} />
          </Button>
          <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600" onClick={() => setDeletingCondition(true)}>
            <Trash2 size={14} />
          </Button>
        </div>
      )}

      {/* Entries */}
      {entries.length === 0 ? (
        <p className="text-center text-gray-400 py-8">暂无记录，点击上方添加</p>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <Card key={entry.id}>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {dayjs(entry.date).format('YYYY-MM-DD')}
                  </span>
                  {!isViewer && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEditEntry(entry)}
                        className="p-1.5 rounded-md text-gray-400 hover:text-primary-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => setDeletingEntryId(entry.id)}
                        className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
                {entry.note && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">{entry.note}</p>
                )}
                {entry.images && entry.images.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {entry.images.map((img, i) => (
                      img.mediaType === 'video' ? (
                        <div key={i} className="w-16 h-16 rounded-lg bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                          <Play size={16} className="text-gray-500" />
                        </div>
                      ) : (
                        <img key={i} src={img.url} alt="" className="w-16 h-16 rounded-lg object-cover" />
                      )
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
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
          已加载全部记录
        </div>
      )}

      {/* Entry Form Dialog */}
      <Dialog open={showEntryForm} onOpenChange={(open) => { if (!open) { setShowEntryForm(false); setEntryPreviews([]); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingEntry ? '编辑记录' : '添加记录'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={saveEntry} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">日期</label>
              <DatePicker value={entryDate} onChange={setEntryDate} placeholder="选择日期" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">记录</label>
              <Textarea value={entryNote} onChange={(e) => setEntryNote(e.target.value)} placeholder="观察、测量数据等..." rows={3} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">照片 / 视频</label>
              <div className="flex flex-wrap gap-2">
                {entryPreviews.map((p, idx) => (
                  <div key={idx} className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600">
                    {!p.url ? null : p.type === 'video' ? (
                      <div className="w-full h-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center"><Play size={16} className="text-gray-500" /></div>
                    ) : (
                      <img src={p.url} alt="" className="w-full h-full object-cover" decoding="async" loading="lazy" />
                    )}
                    {p.file && !p.result && <UploadRing progress={p.progress ?? 0} error={p.error} />}
                    <button type="button" onClick={() => removeEntryPreview(idx)} className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 rounded-full flex items-center justify-center">
                      <X size={10} className="text-white" />
                    </button>
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
                <label className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center cursor-pointer hover:border-primary-400 transition-colors">
                  <input type="file" accept="image/*,video/*" className="hidden" multiple disabled={entryUploading} onChange={(e) => { handleEntryUpload(e.target.files); e.target.value = ''; }} />
                  {entryUploading ? <span className="text-[10px] text-gray-400 animate-pulse">上传中</span> : <ImagePlus size={16} className="text-gray-400" />}
                </label>
              </div>
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={() => { setShowEntryForm(false); setEntryPreviews([]); }}>取消</Button>
              <Button type="submit" className="flex-1" disabled={entryUploading}>保存</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Condition Dialog */}
      <Dialog open={showEditCondition} onOpenChange={setShowEditCondition}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>编辑病症信息</DialogTitle>
          </DialogHeader>
          <form onSubmit={updateCondition} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">名称</label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">描述（可选）</label>
              <Textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={2} />
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setShowEditCondition(false)}>取消</Button>
              <Button type="submit" className="flex-1">保存</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deletingEntryId}
        onOpenChange={(open) => { if (!open) setDeletingEntryId(null); }}
        title="删除记录"
        description="确定删除此记录？此操作不可撤销。"
        confirmLabel="删除"
        variant="danger"
        onConfirm={() => deletingEntryId && deleteEntry(deletingEntryId)}
      />

      <ConfirmDialog
        open={deletingCondition}
        onOpenChange={setDeletingCondition}
        title="删除追踪"
        description="确定删除此病症追踪？所有相关记录都将被删除，此操作不可撤销。"
        confirmLabel="删除"
        variant="danger"
        onConfirm={deleteCondition}
      />
    </div>
  );
}
