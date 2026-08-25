import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { KeepAliveActiveContext } from '../../hooks/useActivated';

const VideoPlayer = React.lazy(() =>
  import('./video-player').then((mod) => ({ default: mod.VideoPlayer })),
);

export interface ViewerImage {
  url: string;
  rawUrl?: string;
  mediaType?: string;
  posterUrl?: string;
}

function resolveImage(img: string | ViewerImage): ViewerImage {
  return typeof img === 'string' ? { url: img } : img;
}

function isVideo(img: ViewerImage): boolean {
  if (img.mediaType === 'video') return true;
  if (img.mediaType === 'image') return false;
  const src = img.url.split('?')[0].toLowerCase();
  return /\.(mp4|webm|mov|m4v|ogg)$/.test(src);
}

function clamp(val: number, min: number, max: number) {
  return Math.min(Math.max(val, min), max);
}

function stopBubble(e: React.SyntheticEvent) {
  e.stopPropagation();
}

interface ZoomableImageProps {
  src: string;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onBackdropClick?: () => void;
}

function ZoomableImage({ src, onSwipeLeft, onSwipeRight, onBackdropClick }: ZoomableImageProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const imgRef = React.useRef<HTMLImageElement>(null);

  const [scale, setScale] = React.useState(1);
  const [translate, setTranslate] = React.useState({ x: 0, y: 0 });

  const scaleRef = React.useRef(scale);
  const translateRef = React.useRef(translate);
  scaleRef.current = scale;
  translateRef.current = translate;

  React.useEffect(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, [src]);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;

      const oldScale = scaleRef.current;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const newScale = clamp(oldScale * factor, 1, 10);

      if (newScale === oldScale) return;

      const ratio = 1 - newScale / oldScale;
      const t = translateRef.current;
      const nx = t.x + (cx - t.x) * ratio;
      const ny = t.y + (cy - t.y) * ratio;

      setScale(newScale);
      setTranslate(newScale <= 1 ? { x: 0, y: 0 } : { x: nx, y: ny });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  const dragging = React.useRef(false);
  const dragStart = React.useRef({ x: 0, y: 0 });
  const dragTranslateStart = React.useRef({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scaleRef.current <= 1) return;
    e.preventDefault();
    dragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    dragTranslateStart.current = { ...translateRef.current };
  };

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setTranslate({
        x: dragTranslateStart.current.x + dx,
        y: dragTranslateStart.current.y + dy,
      });
    };
    const handleMouseUp = () => {
      dragging.current = false;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const touchState = React.useRef<{
    startTouches: { x: number; y: number }[];
    startScale: number;
    startTranslate: { x: number; y: number };
    startDist: number;
    singleStartX: number;
    singleDeltaX: number;
    isPinching: boolean;
    lastTapTime: number;
  }>({
    startTouches: [],
    startScale: 1,
    startTranslate: { x: 0, y: 0 },
    startDist: 0,
    singleStartX: 0,
    singleDeltaX: 0,
    isPinching: false,
    lastTapTime: 0,
  });

  const getTouchDist = (t1: React.Touch, t2: React.Touch) => {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const getTouchCenter = (t1: React.Touch, t2: React.Touch) => ({
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2,
  });

  const handleTouchStart = (e: React.TouchEvent) => {
    const ts = touchState.current;

    if (e.touches.length === 2) {
      ts.isPinching = true;
      ts.startDist = getTouchDist(e.touches[0], e.touches[1]);
      ts.startScale = scaleRef.current;
      ts.startTranslate = { ...translateRef.current };
      ts.startTouches = [
        { x: e.touches[0].clientX, y: e.touches[0].clientY },
        { x: e.touches[1].clientX, y: e.touches[1].clientY },
      ];
    } else if (e.touches.length === 1) {
      ts.isPinching = false;
      ts.singleStartX = e.touches[0].clientX;
      ts.singleDeltaX = 0;
      ts.startTranslate = { ...translateRef.current };
      ts.startTouches = [{ x: e.touches[0].clientX, y: e.touches[0].clientY }];
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const ts = touchState.current;

    if (e.touches.length === 2 && ts.isPinching) {
      e.preventDefault();
      const newDist = getTouchDist(e.touches[0], e.touches[1]);
      const ratio = newDist / ts.startDist;
      const newScale = clamp(ts.startScale * ratio, 1, 10);

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const oldCenter = {
        x: (ts.startTouches[0].x + ts.startTouches[1].x) / 2,
        y: (ts.startTouches[0].y + ts.startTouches[1].y) / 2,
      };
      const newCenter = getTouchCenter(e.touches[0], e.touches[1]);

      const cx = oldCenter.x - rect.left - rect.width / 2;
      const cy = oldCenter.y - rect.top - rect.height / 2;

      const scaleRatio = 1 - newScale / ts.startScale;
      const panDx = newCenter.x - oldCenter.x;
      const panDy = newCenter.y - oldCenter.y;

      setScale(newScale);
      setTranslate(
        newScale <= 1
          ? { x: 0, y: 0 }
          : {
              x: ts.startTranslate.x + (cx - ts.startTranslate.x) * scaleRatio + panDx,
              y: ts.startTranslate.y + (cy - ts.startTranslate.y) * scaleRatio + panDy,
            },
      );
    } else if (e.touches.length === 1 && !ts.isPinching) {
      const dx = e.touches[0].clientX - ts.startTouches[0].x;
      const dy = e.touches[0].clientY - ts.startTouches[0].y;
      ts.singleDeltaX = e.touches[0].clientX - ts.singleStartX;

      if (scaleRef.current > 1) {
        e.preventDefault();
        setTranslate({
          x: ts.startTranslate.x + dx,
          y: ts.startTranslate.y + dy,
        });
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const ts = touchState.current;

    if (ts.isPinching && e.touches.length < 2) {
      ts.isPinching = false;
      if (scaleRef.current <= 1) {
        setScale(1);
        setTranslate({ x: 0, y: 0 });
      }
      return;
    }

    if (e.touches.length === 0 && !ts.isPinching) {
      if (scaleRef.current <= 1) {
        if (ts.singleDeltaX > 60 && onSwipeRight) onSwipeRight();
        else if (ts.singleDeltaX < -60 && onSwipeLeft) onSwipeLeft();
      }

      const now = Date.now();
      if (now - ts.lastTapTime < 300) {
        if (scaleRef.current > 1) {
          setScale(1);
          setTranslate({ x: 0, y: 0 });
        } else {
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect && ts.startTouches[0]) {
            const cx = ts.startTouches[0].x - rect.left - rect.width / 2;
            const cy = ts.startTouches[0].y - rect.top - rect.height / 2;
            setScale(2.5);
            setTranslate({ x: -cx * 1.5, y: -cy * 1.5 });
          } else {
            setScale(2.5);
          }
        }
        ts.lastTapTime = 0;
      } else {
        ts.lastTapTime = now;
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex items-center justify-center overflow-hidden touch-none"
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={(e) => {
        if (e.target === e.currentTarget && scale <= 1) onBackdropClick?.();
      }}
      style={{ cursor: scale > 1 ? 'grab' : 'default' }}
    >
      <img
        ref={imgRef}
        src={src}
        alt=""
        className="max-w-[90vw] max-h-[85vh] object-contain select-none transition-transform duration-75"
        draggable={false}
        style={{
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          transformOrigin: 'center center',
        }}
      />
    </div>
  );
}

function isPlayerChrome(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest(
      '.art-bottom, .art-controls, .art-progress, .art-settings, .art-control, .art-mask, .art-lock-wrap, .art-volume, .art-selector',
    )
  );
}

function VideoFallback({ poster }: { poster?: string }) {
  return (
    <div className="absolute inset-0 bg-black" data-testid="video-player-fallback">
      {poster ? (
        <img src={poster} alt="" className="h-full w-full object-contain" />
      ) : null}
    </div>
  );
}

function ViewerVideo({
  src,
  poster,
  onSwipeLeft,
  onSwipeRight,
}: {
  src: string;
  poster?: string;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}) {
  const touchStartX = React.useRef<number | null>(null);
  const touchEndX = React.useRef<number | null>(null);
  const ignoreSwipe = React.useRef(false);

  return (
    <div
      className="relative z-0 w-full h-full isolate"
      onTouchStart={(e) => {
        ignoreSwipe.current = isPlayerChrome(e.target);
        if (ignoreSwipe.current) {
          touchStartX.current = null;
          return;
        }
        touchStartX.current = e.targetTouches[0].clientX;
        touchEndX.current = null;
      }}
      onTouchMove={(e) => {
        if (ignoreSwipe.current) return;
        touchEndX.current = e.targetTouches[0].clientX;
      }}
      onTouchEnd={() => {
        if (ignoreSwipe.current || touchStartX.current === null || touchEndX.current === null) {
          ignoreSwipe.current = false;
          return;
        }
        const delta = touchStartX.current - touchEndX.current;
        if (Math.abs(delta) > 60) {
          delta > 0 ? onSwipeLeft?.() : onSwipeRight?.();
        }
        touchStartX.current = null;
        touchEndX.current = null;
      }}
    >
      <div className="absolute inset-0">
        <React.Suspense fallback={<VideoFallback poster={poster} />}>
          <VideoPlayer key={src} src={src} poster={poster} className="lightbox-video-player" />
        </React.Suspense>
      </div>
    </div>
  );
}

const VIEWER_HISTORY_KEY = '__blImageViewer';

function historyHasViewer(): boolean {
  const state = window.history.state;
  return !!state && typeof state === 'object' && VIEWER_HISTORY_KEY in state;
}

function pushViewerHistory() {
  const prev = window.history.state;
  window.history.pushState(
    { ...(prev && typeof prev === 'object' ? prev : {}), [VIEWER_HISTORY_KEY]: Date.now() },
    '',
  );
}

function popViewerHistory() {
  if (historyHasViewer()) window.history.back();
}

function swallowClicks(ms = 400) {
  const started = Date.now();
  const swallow = (e: Event) => {
    if (Date.now() - started < ms) {
      e.stopPropagation();
      e.preventDefault();
    }
  };
  document.addEventListener('click', swallow, true);
  window.setTimeout(() => document.removeEventListener('click', swallow, true), ms);
}

interface ImageViewerProps {
  images: (string | ViewerImage)[];
  initialIndex?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImageViewer({ images, initialIndex = 0, open, onOpenChange }: ImageViewerProps) {
  const [currentIndex, setCurrentIndex] = React.useState(initialIndex);
  const keepAliveActive = React.useContext(KeepAliveActiveContext);
  const onOpenChangeRef = React.useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const dummyOpenRef = React.useRef(false);
  const popListenerRef = React.useRef<((e: PopStateEvent) => void) | null>(null);

  const detachPopListener = React.useCallback(() => {
    if (!popListenerRef.current) return;
    window.removeEventListener('popstate', popListenerRef.current, true);
    popListenerRef.current = null;
  }, []);

  const close = React.useCallback(() => {
    const shouldPopDummy = dummyOpenRef.current && historyHasViewer();
    dummyOpenRef.current = false;
    detachPopListener();
    onOpenChangeRef.current(false);
    swallowClicks();
    if (shouldPopDummy) popViewerHistory();
  }, [detachPopListener]);

  React.useEffect(() => {
    if (open) setCurrentIndex(initialIndex);
  }, [open, initialIndex]);

  React.useEffect(() => {
    document.body.classList.toggle('lightbox-open', open);
    return () => document.body.classList.remove('lightbox-open');
  }, [open]);

  React.useEffect(() => {
    if (!open) return;

    dummyOpenRef.current = true;
    pushViewerHistory();

    const onPop = () => {
      dummyOpenRef.current = false;
      popListenerRef.current = null;
      onOpenChangeRef.current(false);
      swallowClicks();
    };
    popListenerRef.current = onPop;
    window.addEventListener('popstate', onPop, true);
    return () => {
      detachPopListener();
      if (dummyOpenRef.current) {
        dummyOpenRef.current = false;
        popViewerHistory();
      }
    };
  }, [open, detachPopListener]);

  React.useEffect(() => {
    if (open && !keepAliveActive) close();
  }, [keepAliveActive, open, close]);

  React.useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goTo(currentIndex - 1);
      else if (e.key === 'ArrowRight') goTo(currentIndex + 1);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, currentIndex, images.length]);

  const goTo = (idx: number) => {
    if (idx >= 0 && idx < images.length) setCurrentIndex(idx);
  };

  if (images.length === 0) return null;

  const current = resolveImage(images[currentIndex] ?? images[0]);
  const video = isVideo(current);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) close(); else onOpenChange(true); }} modal>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="lightbox-overlay fixed inset-0 z-[200] bg-black/90"
          onPointerDown={stopBubble}
          onClick={stopBubble}
          onMouseDown={stopBubble}
        />
        <DialogPrimitive.Content
          className="lightbox-content fixed inset-0 z-[200] flex items-center justify-center outline-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onClick={stopBubble}
          onPointerDown={stopBubble}
          onMouseDown={stopBubble}
        >
          <DialogPrimitive.Title className="sr-only">查看媒体</DialogPrimitive.Title>

          <div className="lightbox-chrome absolute top-4 left-0 right-0 z-30 flex items-center justify-between px-4">
            {images.length > 1 ? (
              <span className="text-white/80 text-sm font-medium bg-black/40 px-3 py-1 rounded-full">
                {currentIndex + 1} / {images.length}
              </span>
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2">
              {current.rawUrl && (
                <a
                  href={current.rawUrl}
                  download
                  className="flex items-center gap-1 text-white/70 hover:text-white text-sm bg-black/40 px-3 py-1.5 rounded-full transition-colors"
                  onClick={stopBubble}
                  onPointerDown={stopBubble}
                >
                  <Download size={14} />
                  <span>原图</span>
                </a>
              )}
              <DialogPrimitive.Close
                className="w-9 h-9 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 transition-colors"
                onClick={stopBubble}
                onPointerDown={stopBubble}
                onMouseDown={stopBubble}
              >
                <X size={20} />
              </DialogPrimitive.Close>
            </div>
          </div>

          {images.length > 1 && currentIndex > 0 && (
            <button
              type="button"
              onClick={() => goTo(currentIndex - 1)}
              className="lightbox-chrome absolute left-3 top-1/2 -translate-y-1/2 z-30 w-9 h-9 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 transition-colors"
            >
              <ChevronLeft size={22} />
            </button>
          )}

          {images.length > 1 && currentIndex < images.length - 1 && (
            <button
              type="button"
              onClick={() => goTo(currentIndex + 1)}
              className="lightbox-chrome absolute right-3 top-1/2 -translate-y-1/2 z-30 w-9 h-9 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 transition-colors"
            >
              <ChevronRight size={22} />
            </button>
          )}

          {video ? (
            <ViewerVideo
              src={current.url}
              poster={current.posterUrl}
              onSwipeLeft={currentIndex < images.length - 1 ? () => goTo(currentIndex + 1) : undefined}
              onSwipeRight={currentIndex > 0 ? () => goTo(currentIndex - 1) : undefined}
            />
          ) : (
            <ZoomableImage
              src={current.url}
              onSwipeLeft={currentIndex < images.length - 1 ? () => goTo(currentIndex + 1) : undefined}
              onSwipeRight={currentIndex > 0 ? () => goTo(currentIndex - 1) : undefined}
              onBackdropClick={close}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
