import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit2,
  ImagePlus,
  MessageCircle,
  Play,
  Send,
  Trash2,
  X,
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRefreshHandler } from "../hooks/usePullRefresh";
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui";
import { MomentsSkeleton } from "../components/ui/skeleton";
import { VisibilityPicker } from "../components/ui/visibility-picker";
import { useAuth } from "../contexts/AuthContext";
import {
  api,
  generateIdempotencyKey,
  type MediaItem,
  type MediaItemDisplay,
  type Moment,
  type MomentComment,
  type UploadMomentResult,
} from "../lib/api";

dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

// ── Utility ──────────────────────────────────────────────────────────────────

function avatarColor(name: string): string {
  const colors = [
    "bg-rose-400",
    "bg-orange-400",
    "bg-amber-400",
    "bg-green-400",
    "bg-teal-400",
    "bg-cyan-400",
    "bg-blue-400",
    "bg-violet-400",
    "bg-pink-400",
    "bg-indigo-400",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function Avatar({
  name,
  avatar,
  size = "md",
}: {
  name: string;
  avatar?: string | null;
  size?: "sm" | "md";
}) {
  const cls = size === "sm" ? "w-7 h-7 text-xs" : "w-10 h-10 text-sm";
  if (avatar) {
    return (
      <img
        src={avatar}
        alt={name}
        className={`${cls} rounded-full object-cover shrink-0`}
      />
    );
  }
  return (
    <div
      className={`${cls} ${avatarColor(name)} rounded-full flex items-center justify-center text-white font-bold shrink-0`}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

// ── Media grid ───────────────────────────────────────────────────────────────

const GRID_PAGE_SIZE = 9;

function MediaGrid({
  items,
  onClickImage,
}: {
  items: MediaItemDisplay[];
  onClickImage: (idx: number) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  if (items.length === 0) return null;

  const hasMore = items.length > GRID_PAGE_SIZE && !showAll;
  const visible = hasMore ? items.slice(0, GRID_PAGE_SIZE) : items;
  const remaining = items.length - GRID_PAGE_SIZE;

  const gridClass =
    visible.length === 1
      ? "grid-cols-1"
      : visible.length === 2
        ? "grid-cols-2"
        : "grid-cols-3";

  return (
    <div className={`grid gap-1 mt-2 ${gridClass}`}>
      {visible.map((item, idx) => {
        const isLastWithMore = hasMore && idx === GRID_PAGE_SIZE - 1;

        return (
          <div
            key={idx}
            className={`relative overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-700 ${visible.length === 1 ? "aspect-[4/3] max-w-sm" : "aspect-square"}`}
          >
            {item.mediaType === "video" ? (
              <div
                className="w-full h-full relative cursor-pointer"
                onClick={() => onClickImage(idx)}
              >
                <video
                  src={item.url}
                  className="w-full h-full object-cover"
                  muted
                  playsInline
                  preload="metadata"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <div className="w-10 h-10 rounded-full bg-white/80 flex items-center justify-center">
                    <Play size={18} className="text-gray-800 ml-0.5" />
                  </div>
                </div>
              </div>
            ) : (
              <img
                src={item.url}
                alt=""
                className="w-full h-full object-cover cursor-pointer"
                onClick={() => onClickImage(idx)}
                loading="lazy"
                decoding="async"
              />
            )}
            {isLastWithMore && (
              <div
                className="absolute inset-0 bg-black/50 flex items-center justify-center cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowAll(true);
                }}
              >
                <span className="text-white text-lg font-semibold">
                  +{remaining}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Light-box ────────────────────────────────────────────────────────────────

function Lightbox({
  items,
  startIndex,
  onClose,
}: {
  items: MediaItemDisplay[];
  startIndex: number;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState(startIndex);
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);
  const SWIPE_THRESHOLD = 50;

  const prev = () => setCurrent((i) => Math.max(0, i - 1));
  const next = () => setCurrent((i) => Math.min(items.length - 1, i + 1));

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [items.length, onClose]);

  const item = items[current];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex flex-col"
      onClick={onClose}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-white/60 text-sm">
          {current + 1} / {items.length}
        </span>
        <div className="flex items-center gap-3">
          {item?.rawUrl && (
            <a
              href={item.rawUrl}
              download
              className="flex items-center gap-1 text-white/70 hover:text-white text-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <Download size={16} />
              <span>原图</span>
            </a>
          )}
          <button onClick={onClose} className="text-white/70 hover:text-white">
            <X size={22} />
          </button>
        </div>
      </div>

      {/* Media area: swipe on mobile, arrows on desktop */}
      <div
        className="flex-1 relative flex items-center justify-center px-4 pb-4"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => {
          touchStartX.current = e.targetTouches[0].clientX;
          touchEndX.current = null;
        }}
        onTouchMove={(e) => {
          touchEndX.current = e.targetTouches[0].clientX;
        }}
        onTouchEnd={() => {
          if (touchStartX.current === null || touchEndX.current === null)
            return;
          const delta = touchStartX.current - touchEndX.current;
          if (Math.abs(delta) > SWIPE_THRESHOLD) {
            delta > 0 ? next() : prev();
          }
          touchStartX.current = null;
          touchEndX.current = null;
        }}
      >
        {/* Left arrow — desktop only */}
        {current > 0 && (
          <button
            className="flex absolute left-2 top-1/2 -translate-y-1/2 items-center justify-center w-10 h-10 rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors z-10"
            onClick={(e) => {
              e.stopPropagation();
              prev();
            }}
          >
            <ChevronLeft size={24} />
          </button>
        )}

        {/* Media */}
        {item?.mediaType === "video" ? (
          <video
            src={item.url}
            controls
            autoPlay
            className="max-h-full max-w-full rounded-lg"
          />
        ) : (
          <img
            src={item.url}
            alt=""
            className="max-h-full max-w-full object-contain rounded-lg select-none"
            draggable={false}
          />
        )}

        {/* Right arrow — desktop only */}
        {current < items.length - 1 && (
          <button
            className="flex absolute right-2 top-1/2 -translate-y-1/2 items-center justify-center w-10 h-10 rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors z-10"
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
          >
            <ChevronRight size={24} />
          </button>
        )}
      </div>

      {/* Dot indicators */}
      {items.length > 1 && (
        <div
          className="flex justify-center gap-1.5 pb-4"
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={`w-1.5 h-1.5 rounded-full transition-all ${i === current ? "bg-white scale-125" : "bg-white/40"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Comment section ───────────────────────────────────────────────────────────

function CommentSection({
  momentId,
  comments,
  isExpanded,
  onAddComment,
  onDeleteComment,
  currentUserId,
}: {
  momentId: string;
  comments: MomentComment[];
  isExpanded: boolean;
  onAddComment: (momentId: string, content: string) => Promise<void>;
  onDeleteComment: (momentId: string, commentId: string) => Promise<void>;
  currentUserId: string;
}) {
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!input.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onAddComment(momentId, input.trim());
      setInput("");
    } finally {
      setSubmitting(false);
    }
  };

  if (!isExpanded) return null;

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
      {comments.length > 0 && (
        <div className="space-y-2 mb-3">
          {comments.map((c) => (
            <div key={c.id} className="flex items-start gap-2 group">
              <Avatar name={c.displayName} avatar={c.avatar} size="sm" />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium text-primary-600 dark:text-primary-400 mr-1">
                  {c.displayName}:
                </span>
                <span className="text-sm text-gray-700 dark:text-gray-300 break-words">
                  {c.content}
                </span>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-gray-400">
                    {dayjs(c.createdAt).fromNow()}
                  </span>
                  {c.userId === currentUserId && (
                    <button
                      onClick={() => onDeleteComment(momentId, c.id)}
                      className="text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && submit()}
          placeholder="写评论..."
          className="flex-1 text-sm bg-gray-100 dark:bg-gray-700 rounded-full px-3 py-1.5 outline-none focus:ring-2 focus:ring-primary-400 dark:text-gray-200"
        />
        <button
          onClick={submit}
          disabled={!input.trim() || submitting}
          className="text-primary-500 hover:text-primary-600 disabled:text-gray-300 disabled:dark:text-gray-600"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}

// ── Moment card ───────────────────────────────────────────────────────────────

function MomentCard({
  moment,
  currentUserId,
  onDelete,
  onEdit,
  onAddComment,
  onDeleteComment,
}: {
  moment: Moment;
  currentUserId: string;
  onDelete: (id: string) => void;
  onEdit: (moment: Moment) => void;
  onAddComment: (momentId: string, content: string) => Promise<void>;
  onDeleteComment: (momentId: string, commentId: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Avatar name={moment.displayName} avatar={moment.avatar} />
          <div>
            <p className="font-semibold text-sm text-gray-800 dark:text-gray-100">
              {moment.displayName}
            </p>
            <p className="text-xs text-gray-400">
              {dayjs(moment.createdAt).fromNow()}
            </p>
          </div>
        </div>
        {moment.isOwner && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onEdit(moment)}
              className="p-1.5 text-gray-400 hover:text-primary-500 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <Edit2 size={15} />
            </button>
            <button
              onClick={() => onDelete(moment.id)}
              className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <Trash2 size={15} />
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      {moment.content && (
        <p className="mt-2 text-gray-800 dark:text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">
          {moment.content}
        </p>
      )}

      {/* Media */}
      <MediaGrid
        items={moment.mediaItems}
        onClickImage={(idx) => setLightboxIdx(idx)}
      />

      {/* Actions */}
      <div className="mt-3 flex items-center justify-between">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-primary-500"
        >
          <MessageCircle size={16} />
          <span>
            {moment.commentCount > 0 ? `${moment.commentCount} 条评论` : "评论"}
          </span>
          {moment.commentCount > 0 && (
            <ChevronDown
              size={14}
              className={`transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          )}
        </button>
        <span className="text-xs text-gray-400">
          {dayjs(moment.createdAt).format("MM/DD HH:mm")}
        </span>
      </div>

      {/* Comments */}
      <CommentSection
        momentId={moment.id}
        comments={moment.comments}
        isExpanded={expanded || (moment.commentCount > 0 && expanded)}
        onAddComment={onAddComment}
        onDeleteComment={onDeleteComment}
        currentUserId={currentUserId}
      />

      {/* Lightbox */}
      {lightboxIdx !== null && (
        <Lightbox
          items={moment.mediaItems}
          startIndex={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </div>
  );
}

// ── Create / Edit dialog ──────────────────────────────────────────────────────

interface MediaPreview {
  file?: File;
  url: string;
  result?: UploadMomentResult;
  type: "image" | "video";
  progress?: number;
  error?: boolean;
  visibleTo?: string[];
}

const CONCURRENT_UPLOADS = 5;
const PROGRESS_STEP = 5;

function UploadProgressRing({
  progress,
  error,
}: {
  progress: number;
  error?: boolean;
}) {
  const r = 18;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
      {error ? (
        <div className="text-red-400 text-xs font-medium">失败</div>
      ) : (
        <div className="relative w-12 h-12">
          <svg className="w-12 h-12 -rotate-90" viewBox="0 0 44 44">
            <circle
              cx="22"
              cy="22"
              r={r}
              fill="none"
              stroke="rgba(255,255,255,0.25)"
              strokeWidth="3"
            />
            <circle
              cx="22"
              cy="22"
              r={r}
              fill="none"
              stroke="white"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className="transition-[stroke-dashoffset] duration-200"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-white text-[10px] font-semibold">
            {progress}%
          </span>
        </div>
      )}
    </div>
  );
}

const PreviewItem = React.memo(function PreviewItem({
  preview,
  onRemove,
  onVisibilityChange,
}: {
  preview: MediaPreview;
  onRemove: () => void;
  onVisibilityChange: (vt: string[] | undefined) => void;
}) {
  const p = preview;
  return (
    <div className="relative w-[calc(33.333%-0.375rem)] aspect-square rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700">
      {!p.url ? null : p.type === "video" ? (
        <video
          src={p.url}
          className="w-full h-full object-cover"
          muted
          playsInline
          preload="metadata"
        />
      ) : (
        <img
          src={p.url}
          alt=""
          className="w-full h-full object-cover"
          decoding="async"
          loading="lazy"
        />
      )}
      {p.file && !p.result && (
        <UploadProgressRing progress={p.progress ?? 0} error={p.error} />
      )}
      <button
        onClick={onRemove}
        className="absolute top-1 right-1 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center text-white hover:bg-black/80"
      >
        <X size={12} />
      </button>
      {p.result && (
        <div className="absolute bottom-1 left-1">
          <VisibilityPicker value={p.visibleTo} onChange={onVisibilityChange} />
        </div>
      )}
    </div>
  );
});

function MomentFormDialog({
  open,
  onClose,
  onSave,
  editMoment,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (content: string, mediaItems: MediaItem[]) => Promise<void>;
  editMoment?: Moment | null;
}) {
  const [content, setContent] = useState("");
  const [previews, setPreviews] = useState<MediaPreview[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setContent(editMoment?.content ?? "");
      if (editMoment) {
        setPreviews(
          editMoment.mediaItems.map((item) => ({
            url: item.url,
            result: {
              url: item.url,
              key: item.key,
              rawUrl: item.rawUrl,
              rawKey: item.rawKey,
              mediaType: item.mediaType,
            },
            type: item.mediaType,
            visibleTo: item.visibleTo,
          })),
        );
      } else {
        setPreviews([]);
      }
    }
  }, [open, editMoment]);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const allowed = Array.from(files);

      const startIdx = previews.length;

      const placeholders: MediaPreview[] = allowed.map((f) => ({
        file: f,
        url: "",
        type: f.type.startsWith("video/") ? "video" : "image",
        progress: 0,
      }));
      setPreviews((prev) => [...prev, ...placeholders]);
      setUploading(true);

      // Stagger blob URL creation to avoid blocking main thread
      for (let i = 0; i < allowed.length; i++) {
        const blobUrl = URL.createObjectURL(allowed[i]);
        setPreviews((prev) => {
          const next = [...prev];
          const idx = startIdx + i;
          if (next[idx]) {
            next[idx] = { ...next[idx], url: blobUrl };
          }
          return next;
        });
        if (i % 3 === 2) {
          await new Promise((r) => requestAnimationFrame(r));
        }
      }

      let queueIdx = 0;
      const lastReported: number[] = new Array(allowed.length).fill(-1);

      const uploadNext = async (): Promise<void> => {
        const myIdx = queueIdx++;
        if (myIdx >= allowed.length) return;

        const fileIdx = startIdx + myIdx;
        try {
          const result = await api.moments.uploadMediaSingle(
            allowed[myIdx],
            (percent) => {
              const stepped =
                Math.floor(percent / PROGRESS_STEP) * PROGRESS_STEP;
              if (stepped <= lastReported[myIdx]) return;
              lastReported[myIdx] = stepped;
              setPreviews((prev) => {
                const next = [...prev];
                if (next[fileIdx]) {
                  next[fileIdx] = { ...next[fileIdx], progress: stepped };
                }
                return next;
              });
            },
          );
          setPreviews((prev) => {
            const next = [...prev];
            if (next[fileIdx]) {
              next[fileIdx] = {
                ...next[fileIdx],
                result,
                progress: undefined,
              };
            }
            return next;
          });
        } catch (e) {
          console.error(`Upload failed for file ${myIdx}`, e);
          setPreviews((prev) => {
            const next = [...prev];
            if (next[fileIdx]) {
              next[fileIdx] = {
                ...next[fileIdx],
                error: true,
                progress: undefined,
              };
            }
            return next;
          });
        }

        await uploadNext();
      };

      const workers = Math.min(CONCURRENT_UPLOADS, allowed.length);
      await Promise.all(Array.from({ length: workers }, () => uploadNext()));

      setUploading(false);
    },
    [previews.length],
  );

  const removePreview = (idx: number) => {
    setPreviews((prev) => {
      const next = [...prev];
      const removed = next.splice(idx, 1)[0];
      if (removed.file) URL.revokeObjectURL(removed.url);
      return next;
    });
  };

  const handleSave = async () => {
    if (uploading) return;
    const mediaItems: MediaItem[] = previews
      .filter((p) => p.result)
      .map((p) => ({
        key: p.result!.key,
        rawKey: p.result!.rawKey,
        mediaType: p.result!.mediaType,
        visibleTo: p.visibleTo?.length ? p.visibleTo : undefined,
      }));

    setSaving(true);
    try {
      await onSave(content, mediaItems);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const uploadingCount = previews.filter(
    (p) => p.file && !p.result && !p.error,
  ).length;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className={[
          "w-full max-w-none bottom-0 left-0 right-0 top-auto translate-x-0 translate-y-0",
          "rounded-t-2xl rounded-b-none h-[80svh] pb-0 flex flex-col overflow-hidden",
          "sm:h-auto sm:max-h-[80svh] sm:w-[calc(100%-2rem)] sm:max-w-lg",
          "sm:left-1/2 sm:top-1/2 sm:bottom-auto",
          "sm:-translate-x-1/2 sm:-translate-y-1/2",
          "sm:rounded-xl sm:max-h-none",
        ].join(" ")}
      >
        {/* Fixed header */}
        <DialogHeader className="shrink-0">
          <DialogTitle>{editMoment ? "编辑动态" : "发布动态"}</DialogTitle>
        </DialogHeader>

        {/* Scrollable content */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-2 px-1 -mx-1">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="分享宝宝的精彩时刻..."
            rows={3}
            className="w-full rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 p-3 text-sm outline-none focus:ring-2 focus:ring-primary-400 resize-none dark:text-gray-100"
          />

          {previews.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {previews.map((p, idx) => (
                <PreviewItem
                  key={idx}
                  preview={p}
                  onRemove={() => removePreview(idx)}
                  onVisibilityChange={(vt) => {
                    setPreviews((prev) =>
                      prev.map((item, i) =>
                        i === idx ? { ...item, visibleTo: vt } : item,
                      ),
                    );
                  }}
                />
              ))}
              <button
                onClick={() => fileRef.current?.click()}
                className="w-[calc(33.333%-0.375rem)] aspect-square rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-600 flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-primary-400 hover:text-primary-400 transition-colors"
              >
                <ImagePlus size={20} />
                <span className="text-xs">添加</span>
              </button>
            </div>
          )}

          {previews.length === 0 && (
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full min-h-[180px] rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-600 flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-primary-400 hover:text-primary-400 transition-colors"
            >
              <ImagePlus size={36} />
              <span className="text-sm">点击添加照片 / 视频</span>
            </button>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        {/* Fixed footer */}
        <div className="shrink-0 flex items-center justify-between pt-3 pb-6 border-t border-gray-100 dark:border-gray-700">
          {uploading ? (
            <span className="text-xs text-gray-400">
              正在上传 {uploadingCount} 个文件…
            </span>
          ) : (
            previews.length > 0 && (
              <span className="text-xs text-gray-400">
                已选择 {previews.length} 个文件
              </span>
            )
          )}
          <div className="flex gap-2 ml-auto">
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                saving ||
                uploading ||
                (!content.trim() && previews.length === 0)
              }
            >
              {saving
                ? "发布中..."
                : uploading
                  ? "上传中..."
                  : editMoment
                    ? "保存"
                    : "发布"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MomentsPage() {
  const { user } = useAuth();
  const [moments, setMoments] = useState<Moment[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editMoment, setEditMoment] = useState<Moment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const PAGE_SIZE = 10;

  const fetchMoments = useCallback(async (p: number, replace = false) => {
    if (p === 1) setLoading(true);
    else setLoadingMore(true);
    try {
      const res = await api.moments.list(p, PAGE_SIZE);
      const data = res.data;
      setTotal(data.total);
      setHasMore(p * PAGE_SIZE < data.total);
      setMoments((prev) => (replace ? data.items : [...prev, ...data.items]));
      setPage(p);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchMoments(1, true);
  }, [fetchMoments]);

  useRefreshHandler(useCallback(async () => { await fetchMoments(1, true); }, [fetchMoments]));

  // Auto-load more when sentinel enters viewport
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || loadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          fetchMoments(page + 1);
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, page, fetchMoments]);

  const handleCreate = async (content: string, mediaItems: MediaItem[]) => {
    const res = await api.moments.create(
      {
        content: content || undefined,
        mediaItems,
      },
      generateIdempotencyKey(),
    );
    setMoments((prev) => [res.data, ...prev]);
    setTotal((t) => t + 1);
  };

  const handleUpdate = async (content: string, mediaItems: MediaItem[]) => {
    if (!editMoment) return;
    await api.moments.update(editMoment.id, {
      content: content || undefined,
      mediaItems,
    });
    setMoments((prev) =>
      prev.map((m) =>
        m.id === editMoment.id
          ? {
              ...m,
              content: content || null,
              mediaItems: mediaItems.map((mi) => ({
                ...mi,
                url: "",
                rawUrl: "",
              })),
            }
          : m,
      ),
    );
    await fetchMoments(1, true);
  };

  const handleDelete = async (id: string) => {
    setDeleteTarget(id);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.moments.delete(deleteTarget);
      setMoments((prev) => prev.filter((m) => m.id !== deleteTarget));
      setTotal((t) => t - 1);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleAddComment = async (momentId: string, content: string) => {
    const res = await api.moments.addComment(
      momentId,
      content,
      generateIdempotencyKey(),
    );
    setMoments((prev) =>
      prev.map((m) => {
        if (m.id !== momentId) return m;
        return {
          ...m,
          comments: [...m.comments, res.data],
          commentCount: m.commentCount + 1,
        };
      }),
    );
  };

  const handleDeleteComment = async (momentId: string, commentId: string) => {
    await api.moments.deleteComment(momentId, commentId);
    setMoments((prev) =>
      prev.map((m) => {
        if (m.id !== momentId) return m;
        return {
          ...m,
          comments: m.comments.filter((c) => c.id !== commentId),
          commentCount: m.commentCount - 1,
        };
      }),
    );
  };

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">
            朋友圈
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">共 {total} 条动态</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium rounded-xl transition-colors shadow-sm"
        >
          <ImagePlus size={16} />
          <span>发布</span>
        </button>
      </div>

      {/* Feed */}
      <div className="space-y-3">
        {moments.map((moment) => (
          <MomentCard
            key={moment.id}
            moment={moment}
            currentUserId={user?.id ?? ""}
            onDelete={handleDelete}
            onEdit={(m) => {
              setEditMoment(m);
              setShowCreate(true);
            }}
            onAddComment={handleAddComment}
            onDeleteComment={handleDeleteComment}
          />
        ))}

        {moments.length === 0 && !loading && (
          <div className="text-center py-16 text-gray-400">
            <ImagePlus size={48} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">还没有动态，快来分享宝宝的精彩时刻吧！</p>
          </div>
        )}

        {loading && moments.length === 0 && <MomentsSkeleton />}

        {loading && moments.length > 0 && (
          <div className="flex justify-center py-6">
            <div className="w-6 h-6 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
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

        {!hasMore && moments.length > 0 && !loading && (
          <div className="py-4 text-center text-xs text-gray-300 dark:text-gray-600">
            已加载全部朋友圈
          </div>
        )}
      </div>

      {/* Create / Edit dialog */}
      <MomentFormDialog
        open={showCreate}
        onClose={() => {
          setShowCreate(false);
          setEditMoment(null);
        }}
        onSave={editMoment ? handleUpdate : handleCreate}
        editMoment={editMoment}
      />

      {/* Delete confirm dialog */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="删除动态"
        description="确认删除这条动态？此操作不可撤销，相关图片和视频也将一并删除。"
        confirmLabel="删除"
        variant="danger"
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
