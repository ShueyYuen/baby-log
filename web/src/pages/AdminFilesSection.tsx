import dayjs from "dayjs";
import {
  Cloud,
  Copy,
  Eye,
  HardDrive,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SecondaryHeader } from "../components/SecondaryHeader";
import {
  Badge,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  ImageViewer,
  useToast,
} from "../components/ui";
import { Skeleton } from "../components/ui/skeleton";
import { useI18n } from "../contexts/I18nContext";
import {
  api,
  type AdminStorageReindexResult,
  type AdminUploadItem,
  type AdminUploadsResponse,
} from "../lib/api";
import { fileLocationBadge } from "../lib/file-location";

const PAGE_SIZE = 20;
const FILTERS = ["all", "unready", "unused", "used", "video", "image"] as const;
type FileFilter = (typeof FILTERS)[number];

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024)
    return `${(n / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)}KB`;
  return n > 0 ? `${n}B` : "—";
}

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return `${min}m${rem ? ` ${rem}s` : ""}`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

function splitKey(key: string) {
  const i = key.lastIndexOf("/");
  if (i < 0) return { dir: "", name: key };
  return { dir: key.slice(0, i), name: key.slice(i + 1) };
}

export default function AdminFilesSection() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [items, setItems] = useState<AdminUploadItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [status, setStatus] = useState<FileFilter>("all");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [meta, setMeta] = useState<Pick<
    AdminUploadsResponse,
    "counts" | "worker" | "queued" | "transcodeEnabled" | "storageType"
  > | null>(null);
  const [cleanupResult, setCleanupResult] = useState<{
    found: number;
    deleted: number;
    errors?: string[];
  } | null>(null);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [s3Orphan, setS3Orphan] = useState<AdminStorageReindexResult | null>(
    null,
  );
  const [reindexing, setReindexing] = useState(false);
  const [confirmReindex, setConfirmReindex] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [transcodingAll, setTranscodingAll] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminUploadItem | null>(
    null,
  );
  const [preview, setPreview] = useState<AdminUploadItem | null>(null);

  const applyMeta = (data: AdminUploadsResponse) => {
    setMeta({
      counts: data.counts,
      worker: data.worker,
      queued: data.queued,
      transcodeEnabled: data.transcodeEnabled,
      storageType: data.storageType,
    });
    setHasMore(data.hasMore);
  };

  const load = useCallback(
    async (p: number, replace: boolean, pageSize = PAGE_SIZE) => {
      if (p > 1) setLoadingMore(true);
      else setLoading(true);
      try {
        const res = await api.admin.listUploads({
          page: p,
          pageSize,
          status,
          q,
        });
        applyMeta(res.data);
        setItems((prev) =>
          replace ? res.data.items : [...prev, ...res.data.items],
        );
        setPage(p);
      } catch {
        toast(t("admin.filesLoadFailed"), "error");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [status, q, t, toast],
  );

  useEffect(() => {
    load(1, true);
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = qInput.trim();
      setQ((prev) => (prev === next ? prev : next));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [qInput]);

  useEffect(() => {
    const busy = (meta?.counts.unready ?? 0) > 0 || !!meta?.worker;
    if (!busy) return;
    const timer = window.setInterval(() => {
      load(1, true, Math.max(items.length, PAGE_SIZE));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [meta?.counts.unready, meta?.worker, items.length, load]);

  const phaseLabel = (phase?: string) => {
    if (!phase) return "";
    const map: Record<string, string> = {
      running: t("admin.phaseRunning"),
      transcode: t("admin.phaseTranscode"),
      remux: t("admin.phaseRemux"),
      poster: t("admin.phasePoster"),
      download: t("admin.phaseDownload"),
      s3: t("admin.phaseS3"),
      ffmpeg: t("admin.phaseFfmpeg"),
    };
    return map[phase] || phase;
  };

  const runCleanup = async () => {
    setCleaningUp(true);
    try {
      const res = await api.admin.cleanup();
      setCleanupResult(res.data);
      toast(t("admin.cleaned", { n: res.data?.deleted ?? 0 }), "success");
      load(1, true);
    } catch (err: any) {
      toast(err.message || t("admin.cleanFailed"), "error");
    } finally {
      setCleaningUp(false);
    }
  };

  const runReindex = async () => {
    setConfirmReindex(false);
    setReindexing(true);
    try {
      const res = await api.admin.reindexStorage();
      setS3Orphan(res.data);
      toast(
        t("admin.s3OrphanCleaned", {
          posters: res.data?.postersIndexed ?? 0,
          sizes: res.data?.sizesUpdated ?? 0,
          deleted: res.data?.deleted ?? 0,
        }),
        "success",
      );
      load(1, true);
    } catch (err: any) {
      toast(err.message || t("admin.s3OrphanScanFailed"), "error");
    } finally {
      setReindexing(false);
    }
  };

  const triggerTranscode = async (key: string) => {
    setBusyKey(key);
    try {
      const res = await api.admin.transcodeUpload({ key });
      if (res.data.alreadyActive) {
        toast(t("admin.transcodeActive"), "info");
      } else {
        toast(t("admin.transcoding"), "success");
      }
      load(1, true, Math.max(items.length, PAGE_SIZE));
    } catch (err: any) {
      toast(err.message || t("admin.transcodeFailed"), "error");
    } finally {
      setBusyKey(null);
    }
  };

  const triggerAllUnready = async () => {
    setTranscodingAll(true);
    try {
      const res = await api.admin.transcodeUpload({ allUnready: true });
      toast(t("admin.transcodeQueued", { n: res.data.queued ?? 0 }), "success");
      load(1, true, Math.max(items.length, PAGE_SIZE));
    } catch (err: any) {
      toast(err.message || t("admin.transcodeFailed"), "error");
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
      toast(t("admin.fileDeleted"), "success");
      load(1, true, Math.max(items.length, PAGE_SIZE));
    } catch (err: any) {
      toast(err.message || t("admin.fileDeleteFailed"), "error");
    } finally {
      setBusyKey(null);
    }
  };

  const copyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      toast(t("admin.copiedKey"), "success");
    } catch {
      toast(key, "info");
    }
  };

  const counts = meta?.counts;
  const orphanItems = s3Orphan?.items ?? [];

  const chipClass = (active: boolean) =>
    `px-3 py-1 rounded-full text-xs font-medium transition-colors glass-chip ${
      active ? "glass-chip-active" : "text-gray-600 dark:text-gray-300"
    }`;

  return (
    <div className="absolute inset-0 glass-page-shell">
      <SecondaryHeader
        title={t("admin.filesTitle")}
        actions={
          <Button
            size="sm"
            variant="destructive"
            disabled={cleaningUp}
            onClick={runCleanup}
          >
            {cleaningUp ? t("admin.cleaning") : t("admin.cleanNow")}
          </Button>
        }
      />
      <div className="glass-page-body custom-scrollbar space-y-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("admin.filesHint")}
        </p>
        {meta?.storageType === "s3" && (
          <div className="flex items-start gap-2 glass-info-strip rounded-xl px-3 py-2.5">
            <Cloud
              size={14}
              className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-300"
            />
            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              {t("admin.filesHintS3")}
            </p>
          </div>
        )}
        {meta && (
          <Card>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm font-medium dark:text-gray-100">
                  {t("admin.s3OrphanTitle")}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                  {meta.storageType === "s3"
                    ? t("admin.s3OrphanHint")
                    : t("admin.s3OrphanHintLocal")}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={reindexing}
                onClick={() => setConfirmReindex(true)}
              >
                {reindexing
                  ? t("admin.s3OrphanScanning")
                  : t("admin.s3OrphanScan")}
              </Button>
              {s3Orphan && (
                <div className="space-y-2">
                  <div className="grid grid-cols-4 gap-2 text-center text-sm">
                    <div>
                      <p className="text-lg font-bold text-primary-500">
                        {s3Orphan.listed}
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        {t("admin.s3OrphanListed")}
                      </p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-indigo-500 dark:text-indigo-400">
                        {s3Orphan.postersIndexed}
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        {t("admin.s3OrphanPosters")}
                      </p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-amber-600 dark:text-amber-400">
                        {s3Orphan.sizesUpdated}
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        {t("admin.s3OrphanSizes")}
                      </p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-green-600 dark:text-green-400">
                        {s3Orphan.deleted}
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        {t("admin.s3OrphanDeleted")}
                      </p>
                    </div>
                  </div>
                  {s3Orphan.skippedRecent > 0 && (
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      {t("admin.s3OrphanSkippedRecent", {
                        n: s3Orphan.skippedRecent,
                      })}
                    </p>
                  )}
                  {s3Orphan.truncated && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-300">
                      {t("admin.s3OrphanTruncated")}
                    </p>
                  )}
                  {orphanItems.length > 0 && (
                    <div className="text-xs text-gray-600 dark:text-gray-300 space-y-0.5 break-all">
                      {orphanItems.slice(0, 8).map((item) => (
                        <p key={item.key}>
                          {item.key} · {formatBytes(item.size)}
                        </p>
                      ))}
                      {s3Orphan.found > Math.min(8, orphanItems.length) && (
                        <p className="text-gray-400 dark:text-gray-500">
                          {t("admin.s3OrphanMore", {
                            n:
                              s3Orphan.found -
                              Math.min(8, orphanItems.length),
                          })}
                        </p>
                      )}
                    </div>
                  )}
                  {s3Orphan.errors && s3Orphan.errors.length > 0 && (
                    <div className="text-xs text-red-500 dark:text-red-400 space-y-0.5">
                      {s3Orphan.errors.map((e, i) => (
                        <p key={i}>{e}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}
        {counts && (
          <div className="grid grid-cols-4 gap-2">
            {[
              {
                value: counts.total,
                label: t("admin.countTotal"),
                color: "text-primary-500",
              },
              {
                value: counts.unready,
                label: t("admin.countUnready"),
                color: "text-amber-500",
              },
              {
                value: counts.unused,
                label: t("admin.countUnused"),
                color: "text-gray-500 dark:text-gray-400",
              },
              {
                value: counts.videos,
                label: t("admin.countVideos"),
                color: "text-indigo-500 dark:text-indigo-400",
              },
            ].map((stat) => (
              <div key={stat.label} className="card text-center py-3 px-1">
                <p className={`text-lg font-bold ${stat.color}`}>
                  {stat.value}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        )}

        {meta?.worker && (
          <div className="flex items-start gap-2 glass-warning-panel rounded-xl px-3 py-2.5">
            <Loader2
              size={14}
              className="mt-0.5 shrink-0 animate-spin text-amber-600 dark:text-amber-300"
            />
            <p className="text-xs text-amber-800 dark:text-amber-200 break-all leading-relaxed">
              {t("admin.workerActive", {
                key: meta.worker.key,
                phase: phaseLabel(meta.worker.phase),
                elapsed: formatElapsed(meta.worker.elapsedMs),
              })}
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <form
            className="relative flex-1 min-w-[12rem]"
            onSubmit={(e) => {
              e.preventDefault();
              setQ(qInput.trim());
            }}
          >
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-gray-400 pointer-events-none"
            />
            <input
              type="text"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder={t("admin.filesSearch")}
              className="glass-input-ui w-full h-10 pl-9 pr-9 text-sm rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none"
            />
            {qInput && (
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                onClick={() => {
                  setQInput("");
                  setQ("");
                }}
              >
                <X size={16} />
              </button>
            )}
          </form>
          {meta?.transcodeEnabled && (counts?.unready ?? 0) > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={transcodingAll}
              onClick={triggerAllUnready}
            >
              <RefreshCw
                size={14}
                className={transcodingAll ? "animate-spin" : undefined}
              />
              {transcodingAll
                ? t("common.processing")
                : t("admin.transcodeAll")}
            </Button>
          )}
        </div>
        {!meta?.transcodeEnabled && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("admin.transcodeOff")}
          </p>
        )}

        {cleanupResult && (
          <div className="glass-success-panel rounded-xl p-4 space-y-2">
            <div className="grid grid-cols-2 gap-3 text-center text-sm">
              <div>
                <p className="text-lg font-bold text-primary-500">
                  {cleanupResult.found}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("admin.foundOrphans")}
                </p>
              </div>
              <div>
                <p className="text-lg font-bold text-green-600 dark:text-green-400">
                  {cleanupResult.deleted}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("admin.deletedCount")}
                </p>
              </div>
            </div>
            {cleanupResult.errors && cleanupResult.errors.length > 0 && (
              <div className="text-xs text-red-500 dark:text-red-400 space-y-0.5 mt-1 pt-2 border-t border-white/30 dark:border-white/10">
                {cleanupResult.errors.map((e, i) => (
                  <p key={i}>{e}</p>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className={chipClass(status === f)}
              onClick={() => setStatus(f)}
            >
              {t(
                `admin.filter${f.charAt(0).toUpperCase()}${f.slice(1)}` as "admin.filterAll",
              )}
            </button>
          ))}
        </div>

        {loading && items.length === 0 ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card flex items-center gap-3">
                <div className="flex-1 space-y-2 min-w-0">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <div className="flex gap-1.5">
                    <Skeleton className="h-5 w-12 rounded-full" />
                    <Skeleton className="h-5 w-12 rounded-full" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-14 h-14 rounded-2xl glass-avatar-placeholder flex items-center justify-center mb-3">
              <HardDrive size={24} className="text-gray-400" />
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("admin.filesEmpty")}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((file) => {
              const processing = file.mediaType === "video" && !file.ready;
              const canPreview = !!(file.url || file.posterUrl);
              const { dir, name } = splitKey(file.key);
              const loc = fileLocationBadge(file.local, meta?.storageType);
              return (
                <Card key={file.key}>
                  <CardContent className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-sm font-medium dark:text-gray-100 truncate leading-snug"
                        title={file.key}
                      >
                        {name}
                      </p>
                      {dir ? (
                        <p
                          className="text-[11px] text-gray-400 dark:text-gray-500 truncate"
                          title={file.key}
                        >
                          {dir}
                        </p>
                      ) : null}
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {formatBytes(file.size)} ·{" "}
                        {dayjs(file.createdAt).format("YYYY-MM-DD HH:mm")}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {file.mediaType === "video" ? (
                          <Badge variant="info">{t("admin.filterVideo")}</Badge>
                        ) : (
                          <Badge variant="secondary">
                            {t("admin.filterImage")}
                          </Badge>
                        )}
                        {file.poster && (
                          <Badge variant="secondary">
                            {t("admin.statusPoster")}
                          </Badge>
                        )}
                        {processing ? (
                          <Badge variant="warning">
                            {file.phase
                              ? phaseLabel(file.phase)
                              : t("admin.statusProcessing")}
                          </Badge>
                        ) : (
                          <Badge variant="success">
                            {t("admin.statusReady")}
                          </Badge>
                        )}
                        {file.referenced || file.used ? (
                          <Badge variant="info">{t("admin.statusUsed")}</Badge>
                        ) : (
                          <Badge variant="secondary">
                            {t("admin.statusUnused")}
                          </Badge>
                        )}
                        <Badge variant={loc.variant}>{t(loc.labelKey)}</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        className="p-2 rounded-lg text-gray-400 hover:text-primary-500 glass-icon-btn transition-colors"
                        title={t("admin.copyKey")}
                        onClick={() => copyKey(file.key)}
                      >
                        <Copy size={16} />
                      </button>
                      {file.mediaType === "video" && meta?.transcodeEnabled && (
                        <button
                          type="button"
                          className="p-2 rounded-lg text-gray-400 hover:text-primary-500 glass-icon-btn transition-colors disabled:opacity-40"
                          title={t("admin.transcode")}
                          disabled={busyKey === file.key}
                          onClick={() => triggerTranscode(file.key)}
                        >
                          <RefreshCw
                            size={16}
                            className={
                              busyKey === file.key ? "animate-spin" : undefined
                            }
                          />
                        </button>
                      )}
                      <button
                        type="button"
                        className="p-2 rounded-lg text-gray-400 hover:text-red-500 glass-icon-btn transition-colors disabled:opacity-40"
                        title={t("admin.deleteFile")}
                        disabled={busyKey === file.key}
                        onClick={() => setDeleteTarget(file)}
                      >
                        <Trash2 size={16} />
                      </button>
                      <button
                        type="button"
                        className="p-2 rounded-lg text-gray-400 hover:text-primary-500 glass-icon-btn transition-colors disabled:opacity-40"
                        title={t("admin.previewFile")}
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
            {hasMore && (
              <Button
                variant="outline"
                className="w-full"
                disabled={loadingMore}
                onClick={() => load(page + 1, false)}
              >
                {loadingMore ? t("common.loading") : t("common.more")}
              </Button>
            )}
          </div>
        )}

        <ConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          title={t("admin.deleteFile")}
          description={
            deleteTarget?.referenced
              ? t("admin.deleteFileForce")
              : t("admin.deleteFileConfirm", { key: deleteTarget?.key ?? "" })
          }
          confirmLabel={t("common.delete")}
          variant="danger"
          onConfirm={confirmDelete}
        />

        <ConfirmDialog
          open={confirmReindex}
          onOpenChange={setConfirmReindex}
          title={t("admin.s3OrphanTitle")}
          description={t("admin.s3OrphanConfirm")}
          confirmLabel={t("admin.s3OrphanScan")}
          loading={reindexing}
          onConfirm={runReindex}
        />

        <ImageViewer
          images={
            preview
              ? [
                  {
                    url: preview.url || preview.posterUrl || "",
                    posterUrl: preview.posterUrl,
                    mediaType: preview.mediaType,
                    processing: preview.mediaType === "video" && !preview.ready,
                  },
                ]
              : []
          }
          initialIndex={0}
          open={!!preview}
          onOpenChange={(open) => {
            if (!open) setPreview(null);
          }}
        />
      </div>
    </div>
  );
}
