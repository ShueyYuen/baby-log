import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { Copy, Eye, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useI18n } from '../contexts/I18nContext';
import { api, type AdminUploadItem, type AdminUploadsResponse } from '../lib/api';
import {
  Badge,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  ImageViewer,
  Input,
  useToast,
} from '../components/ui';

const PAGE_SIZE = 20;
const FILTERS = ['all', 'unready', 'unused', 'used', 'video', 'image'] as const;
type FileFilter = (typeof FILTERS)[number];

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)}KB`;
  return n > 0 ? `${n}B` : '—';
}

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return `${min}m${rem ? ` ${rem}s` : ''}`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export default function AdminFilesSection() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [items, setItems] = useState<AdminUploadItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [status, setStatus] = useState<FileFilter>('all');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [meta, setMeta] = useState<Pick<AdminUploadsResponse, 'counts' | 'worker' | 'queued' | 'transcodeEnabled'> | null>(null);
  const [cleanupResult, setCleanupResult] = useState<{ found: number; deleted: number; errors?: string[] } | null>(null);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [transcodingAll, setTranscodingAll] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminUploadItem | null>(null);
  const [preview, setPreview] = useState<AdminUploadItem | null>(null);

  const applyMeta = (data: AdminUploadsResponse) => {
    setMeta({
      counts: data.counts,
      worker: data.worker,
      queued: data.queued,
      transcodeEnabled: data.transcodeEnabled,
    });
    setHasMore(data.hasMore);
  };

  const load = useCallback(async (p: number, replace: boolean, pageSize = PAGE_SIZE) => {
    if (p > 1) setLoadingMore(true);
    else setLoading(true);
    try {
      const res = await api.admin.listUploads({ page: p, pageSize, status, q });
      applyMeta(res.data);
      setItems((prev) => (replace ? res.data.items : [...prev, ...res.data.items]));
      setPage(p);
    } catch {
      toast(t('admin.filesLoadFailed'), 'error');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [status, q, t, toast]);

  useEffect(() => {
    load(1, true);
  }, [load]);

  useEffect(() => {
    const busy = (meta?.counts.unready ?? 0) > 0 || !!meta?.worker;
    if (!busy) return;
    const timer = window.setInterval(() => {
      load(1, true, Math.max(items.length, PAGE_SIZE));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [meta?.counts.unready, meta?.worker, items.length, load]);

  const phaseLabel = (phase?: string) => {
    if (!phase) return '';
    const map: Record<string, string> = {
      running: t('admin.phaseRunning'),
      transcode: t('admin.phaseTranscode'),
      remux: t('admin.phaseRemux'),
      poster: t('admin.phasePoster'),
      download: t('admin.phaseDownload'),
      s3: t('admin.phaseS3'),
      ffmpeg: t('admin.phaseFfmpeg'),
    };
    return map[phase] || phase;
  };

  const runCleanup = async () => {
    setCleaningUp(true);
    try {
      const res = await api.admin.cleanup();
      setCleanupResult(res.data);
      toast(t('admin.cleaned', { n: res.data?.deleted ?? 0 }), 'success');
      load(1, true);
    } catch (err: any) {
      toast(err.message || t('admin.cleanFailed'), 'error');
    } finally {
      setCleaningUp(false);
    }
  };

  const triggerTranscode = async (key: string) => {
    setBusyKey(key);
    try {
      const res = await api.admin.transcodeUpload({ key });
      if (res.data.alreadyActive) {
        toast(t('admin.transcodeActive'), 'info');
      } else {
        toast(t('admin.transcoding'), 'success');
      }
      load(1, true, Math.max(items.length, PAGE_SIZE));
    } catch (err: any) {
      toast(err.message || t('admin.transcodeFailed'), 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const triggerAllUnready = async () => {
    setTranscodingAll(true);
    try {
      const res = await api.admin.transcodeUpload({ allUnready: true });
      toast(t('admin.transcodeQueued', { n: res.data.queued ?? 0 }), 'success');
      load(1, true, Math.max(items.length, PAGE_SIZE));
    } catch (err: any) {
      toast(err.message || t('admin.transcodeFailed'), 'error');
    } finally {
      setTranscodingAll(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setBusyKey(target.key);
    try {
      await api.admin.deleteUpload(target.key, target.referenced);
      toast(t('admin.fileDeleted'), 'success');
      load(1, true, Math.max(items.length, PAGE_SIZE));
    } catch (err: any) {
      toast(err.message || t('admin.fileDeleteFailed'), 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const copyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      toast(t('admin.copiedKey'), 'success');
    } catch {
      toast(key, 'info');
    }
  };

  const counts = meta?.counts;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">{t('admin.filesHint')}</p>
      {counts && (
        <div className="grid grid-cols-4 gap-2 text-center text-sm">
          <div>
            <p className="text-lg font-bold text-primary-500">{counts.total}</p>
            <p className="text-[11px] text-gray-500">{t('admin.countTotal')}</p>
          </div>
          <div>
            <p className="text-lg font-bold text-amber-500">{counts.unready}</p>
            <p className="text-[11px] text-gray-500">{t('admin.countUnready')}</p>
          </div>
          <div>
            <p className="text-lg font-bold text-gray-500">{counts.unused}</p>
            <p className="text-[11px] text-gray-500">{t('admin.countUnused')}</p>
          </div>
          <div>
            <p className="text-lg font-bold dark:text-gray-100">{counts.videos}</p>
            <p className="text-[11px] text-gray-500">{t('admin.countVideos')}</p>
          </div>
        </div>
      )}

      {meta?.worker && (
        <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50/80 dark:bg-amber-900/20 rounded-lg px-3 py-2">
          {t('admin.workerActive', {
            key: meta.worker.key,
            phase: phaseLabel(meta.worker.phase),
            elapsed: formatElapsed(meta.worker.elapsedMs),
          })}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="destructive" disabled={cleaningUp} onClick={runCleanup}>
          {cleaningUp ? t('admin.cleaning') : t('admin.cleanNow')}
        </Button>
        {meta?.transcodeEnabled && (counts?.unready ?? 0) > 0 && (
          <Button size="sm" variant="outline" disabled={transcodingAll} onClick={triggerAllUnready}>
            <RefreshCw size={14} />
            {transcodingAll ? t('common.processing') : t('admin.transcodeAll')}
          </Button>
        )}
      </div>
      {!meta?.transcodeEnabled && (
        <p className="text-xs text-gray-500">{t('admin.transcodeOff')}</p>
      )}

      {cleanupResult && (
        <Card>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-2 gap-3 text-center text-sm">
              <div>
                <p className="text-lg font-bold text-primary-500">{cleanupResult.found}</p>
                <p className="text-xs text-gray-500">{t('admin.foundOrphans')}</p>
              </div>
              <div>
                <p className="text-lg font-bold text-green-500">{cleanupResult.deleted}</p>
                <p className="text-xs text-gray-500">{t('admin.deletedCount')}</p>
              </div>
            </div>
            {cleanupResult.errors && cleanupResult.errors.length > 0 && (
              <div className="text-xs text-red-500 space-y-0.5 mt-2 border-t pt-2 dark:border-gray-700">
                {cleanupResult.errors.map((e, i) => (
                  <p key={i}>{e}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(qInput.trim());
        }}
      >
        <Input
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder={t('admin.filesSearch')}
        />
        <Button type="submit" size="icon" variant="outline" className="shrink-0">
          <Search size={16} />
        </Button>
      </form>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Button
            key={f}
            type="button"
            size="sm"
            variant={status === f ? 'default' : 'outline'}
            onClick={() => setStatus(f)}
          >
            {t(`admin.filter${f.charAt(0).toUpperCase()}${f.slice(1)}` as 'admin.filterAll')}
          </Button>
        ))}
      </div>

      {loading && items.length === 0 ? (
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500">{t('admin.filesEmpty')}</p>
      ) : (
        <div className="space-y-3">
          {items.map((file) => {
            const processing = file.mediaType === 'video' && !file.ready;
            const canPreview = !!(file.url || file.posterUrl);
            return (
              <Card key={file.key}>
                <CardContent className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium dark:text-gray-100 break-all leading-snug">{file.key}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {formatBytes(file.size)} · {dayjs(file.createdAt).format('YYYY-MM-DD HH:mm')}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {file.mediaType === 'video' ? (
                        <Badge variant="info">{t('admin.filterVideo')}</Badge>
                      ) : (
                        <Badge variant="secondary">{t('admin.filterImage')}</Badge>
                      )}
                      {file.poster && <Badge variant="secondary">{t('admin.statusPoster')}</Badge>}
                      {processing ? (
                        <Badge variant="warning">{file.phase ? phaseLabel(file.phase) : t('admin.statusProcessing')}</Badge>
                      ) : (
                        <Badge variant="success">{t('admin.statusReady')}</Badge>
                      )}
                      {file.referenced || file.used ? (
                        <Badge variant="info">{t('admin.statusUsed')}</Badge>
                      ) : (
                        <Badge variant="secondary">{t('admin.statusUnused')}</Badge>
                      )}
                      <Badge variant={file.local ? 'secondary' : 'danger'}>
                        {file.local ? t('admin.statusLocal') : t('admin.statusMissing')}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      className="p-2 rounded-md text-gray-400 hover:text-primary-500 glass-icon-btn"
                      title={t('admin.copyKey')}
                      onClick={() => copyKey(file.key)}
                    >
                      <Copy size={16} />
                    </button>
                    {file.mediaType === 'video' && meta?.transcodeEnabled && (
                      <button
                        type="button"
                        className="p-2 rounded-md text-gray-400 hover:text-primary-500 glass-icon-btn disabled:opacity-40"
                        title={t('admin.transcode')}
                        disabled={busyKey === file.key}
                        onClick={() => triggerTranscode(file.key)}
                      >
                        <RefreshCw size={16} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="p-2 rounded-md text-gray-400 hover:text-red-500 glass-icon-btn disabled:opacity-40"
                      title={t('admin.deleteFile')}
                      disabled={busyKey === file.key}
                      onClick={() => setDeleteTarget(file)}
                    >
                      <Trash2 size={16} />
                    </button>
                    <button
                      type="button"
                      className="p-2 rounded-md text-gray-400 hover:text-primary-500 glass-icon-btn disabled:opacity-40"
                      title={t('admin.previewFile')}
                      disabled={!canPreview}
                      onClick={() => setPreview(file)}
                    >
                      <Eye size={16} />
                    </button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {hasMore && (
        <Button
          variant="outline"
          className="w-full"
          disabled={loadingMore}
          onClick={() => load(page + 1, false)}
        >
          {loadingMore ? t('common.loading') : t('common.more')}
        </Button>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t('admin.deleteFile')}
        description={
          deleteTarget?.referenced
            ? t('admin.deleteFileForce')
            : t('admin.deleteFileConfirm', { key: deleteTarget?.key ?? '' })
        }
        confirmLabel={t('common.delete')}
        variant="danger"
        onConfirm={confirmDelete}
      />

      <ImageViewer
        images={preview ? [{
          url: preview.url || preview.posterUrl || '',
          posterUrl: preview.posterUrl,
          mediaType: preview.mediaType,
          processing: preview.mediaType === 'video' && !preview.ready,
        }] : []}
        initialIndex={0}
        open={!!preview}
        onOpenChange={(open) => { if (!open) setPreview(null); }}
      />
    </div>
  );
}
