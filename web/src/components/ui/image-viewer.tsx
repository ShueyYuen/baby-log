import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X, ChevronLeft, ChevronRight, Download } from 'lucide-react';

export interface ViewerImage {
  url: string;
  rawUrl?: string;
}

interface ImageViewerProps {
  images: (string | ViewerImage)[];
  initialIndex?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function resolveImage(img: string | ViewerImage): ViewerImage {
  return typeof img === 'string' ? { url: img } : img;
}

function clamp(val: number, min: number, max: number) {
  return Math.min(Math.max(val, min), max);
}

interface ZoomableImageProps {
  src: string;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}

function ZoomableImage({ src, onSwipeLeft, onSwipeRight }: ZoomableImageProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const imgRef = React.useRef<HTMLImageElement>(null);

  const [scale, setScale] = React.useState(1);
  const [translate, setTranslate] = React.useState({ x: 0, y: 0 });

  const scaleRef = React.useRef(scale);
  const translateRef = React.useRef(translate);
  scaleRef.current = scale;
  translateRef.current = translate;

  // Reset on image change
  React.useEffect(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, [src]);

  // --- Mouse wheel zoom ---
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

  // --- Mouse drag pan ---
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

  // --- Touch: pinch zoom + pan + swipe ---
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

      // Double-tap to zoom
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

export function ImageViewer({ images, initialIndex = 0, open, onOpenChange }: ImageViewerProps) {
  const [currentIndex, setCurrentIndex] = React.useState(initialIndex);

  React.useEffect(() => {
    if (open) setCurrentIndex(initialIndex);
  }, [open, initialIndex]);

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

  const current = resolveImage(images[currentIndex]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/90 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-[100] flex items-center justify-center outline-none"
        >
          <DialogPrimitive.Title className="sr-only">查看图片</DialogPrimitive.Title>

          {/* Top bar */}
          <div className="absolute top-4 left-0 right-0 z-10 flex items-center justify-between px-4">
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
                  onClick={(e) => e.stopPropagation()}
                >
                  <Download size={14} />
                  <span>原图</span>
                </a>
              )}
              <DialogPrimitive.Close className="w-9 h-9 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 transition-colors">
                <X size={20} />
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* Prev */}
          {images.length > 1 && currentIndex > 0 && (
            <button
              onClick={() => goTo(currentIndex - 1)}
              className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 transition-colors"
            >
              <ChevronLeft size={22} />
            </button>
          )}

          {/* Next */}
          {images.length > 1 && currentIndex < images.length - 1 && (
            <button
              onClick={() => goTo(currentIndex + 1)}
              className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 transition-colors"
            >
              <ChevronRight size={22} />
            </button>
          )}

          {/* Zoomable Image */}
          <ZoomableImage
            src={current.url}
            onSwipeLeft={currentIndex < images.length - 1 ? () => goTo(currentIndex + 1) : undefined}
            onSwipeRight={currentIndex > 0 ? () => goTo(currentIndex - 1) : undefined}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
