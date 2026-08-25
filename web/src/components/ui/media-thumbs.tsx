import { useState } from 'react';
import { cn } from '../../lib/utils';
import { ImageViewer, type ViewerImage } from './image-viewer';
import { MediaCover } from './media-cover';

export function toViewerImages(
  items: Array<{ url: string; rawUrl?: string; mediaType?: string; posterUrl?: string; processing?: boolean }>,
): ViewerImage[] {
  return items.map((img) => ({
    url: img.url,
    rawUrl: img.rawUrl,
    mediaType: img.mediaType,
    posterUrl: img.posterUrl,
    processing: img.processing,
  }));
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
    if (images[i]?.processing) return;
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
        {visible.map((img, i) => (
          <button
            key={i}
            type="button"
            className={cn(
              'relative flex-shrink-0 overflow-hidden glass-media-thumb cursor-zoom-in p-0 border-0',
              thumbClassName,
            )}
            onClick={() => openAt(i)}
          >
            <MediaCover
              src={img.url}
              mediaType={img.mediaType}
              posterSrc={img.posterUrl}
              processing={img.processing}
              playSize={14}
            />
          </button>
        ))}
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
