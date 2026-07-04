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

export function ImageViewer({ images, initialIndex = 0, open, onOpenChange }: ImageViewerProps) {
  const [currentIndex, setCurrentIndex] = React.useState(initialIndex);
  const touchStartX = React.useRef(0);
  const touchDeltaX = React.useRef(0);

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

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchDeltaX.current = 0;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current;
  };

  const handleTouchEnd = () => {
    if (touchDeltaX.current > 60) goTo(currentIndex - 1);
    else if (touchDeltaX.current < -60) goTo(currentIndex + 1);
  };

  if (images.length === 0) return null;

  const current = resolveImage(images[currentIndex]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/90 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-[100] flex items-center justify-center outline-none"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <DialogPrimitive.Title className="sr-only">查看图片</DialogPrimitive.Title>

          {/* Top bar */}
          <div className="absolute top-4 left-0 right-0 z-10 flex items-center justify-between px-4">
            {/* Counter */}
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

          {/* Image */}
          <img
            src={current.url}
            alt=""
            className="max-w-[90vw] max-h-[85vh] object-contain select-none"
            draggable={false}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
