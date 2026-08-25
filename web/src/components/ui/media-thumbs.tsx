import { Play } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/utils';
import { ImageViewer, type ViewerImage } from './image-viewer';

export function toViewerImages(
  items: Array<{ url: string; rawUrl?: string; mediaType?: string }>,
): ViewerImage[] {
  return items.map((img) => ({ url: img.url, rawUrl: img.rawUrl, mediaType: img.mediaType }));
}

interface MediaThumbsProps {
  images: ViewerImage[];
  className?: string;
  thumbClassName?: string;
  max?: number;
}

export function MediaThumbs({
  images,
  className,
  thumbClassName = 'w-14 h-14 rounded-md',
  max,
}: MediaThumbsProps) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  if (!images.length) return null;

  const visible = max != null ? images.slice(0, max) : images;
  const overflow = max != null ? Math.max(0, images.length - max) : 0;

  const openAt = (i: number) => {
    setIndex(i);
    setOpen(true);
  };

  return (
    <>
      <div
        data-media-thumbs
        className={cn('flex gap-1.5 overflow-x-auto', className)}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {visible.map((img, i) =>
          img.mediaType === 'video' ? (
            <button
              key={i}
              type="button"
              className={cn(
                'relative flex-shrink-0 overflow-hidden glass-media-thumb flex items-center justify-center cursor-zoom-in',
                thumbClassName,
              )}
              onClick={() => openAt(i)}
            >
              <Play size={14} className="text-gray-500" />
            </button>
          ) : (
            <img
              key={i}
              src={img.url}
              alt=""
              className={cn('object-cover flex-shrink-0 cursor-zoom-in', thumbClassName)}
              onClick={() => openAt(i)}
            />
          ),
        )}
        {overflow > 0 && (
          <button
            type="button"
            className={cn(
              'flex-shrink-0 glass-info-strip flex items-center justify-center text-xs text-gray-500 cursor-zoom-in',
              thumbClassName,
            )}
            onClick={() => openAt(visible.length)}
          >
            +{overflow}
          </button>
        )}
      </div>
      <ImageViewer images={images} initialIndex={index} open={open} onOpenChange={setOpen} />
    </>
  );
}
