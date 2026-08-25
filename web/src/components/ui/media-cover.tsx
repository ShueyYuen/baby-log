import * as React from 'react';
import { Play } from 'lucide-react';
import { cn } from '../../lib/utils';
import { captureVideoPoster, isVideoMedia, posterUrlFromVideoSrc } from '../../lib/video-poster';

const blobPosterCache = new Map<string, Promise<string | null>>();

function posterFromBlobUrl(src: string): Promise<string | null> {
  const cached = blobPosterCache.get(src);
  if (cached) return cached;
  const pending = captureVideoPoster(src)
    .then((blob) => URL.createObjectURL(blob))
    .catch(() => null);
  blobPosterCache.set(src, pending);
  return pending;
}

function useBlobPoster(src: string | undefined, isVideo: boolean, provided?: string) {
  const [captured, setCaptured] = React.useState<string | undefined>();

  React.useEffect(() => {
    if (!isVideo || provided || !src || !src.startsWith('blob:')) {
      setCaptured(undefined);
      return;
    }
    let cancelled = false;
    posterFromBlobUrl(src).then((url) => {
      if (!cancelled && url) setCaptured(url);
    });
    return () => {
      cancelled = true;
    };
  }, [src, isVideo, provided]);

  return provided || captured;
}

export interface MediaCoverProps {
  src: string;
  mediaType?: string;
  posterSrc?: string;
  className?: string;
  playSize?: number;
  onClick?: () => void;
}

export function MediaCover({
  src,
  mediaType,
  posterSrc,
  className,
  playSize = 18,
  onClick,
}: MediaCoverProps) {
  const video = isVideoMedia(mediaType, src);
  const inferredPoster = posterSrc || (video ? posterUrlFromVideoSrc(src) : '');
  const cover = useBlobPoster(src, video, inferredPoster || undefined);
  const [posterFailed, setPosterFailed] = React.useState(false);

  React.useEffect(() => {
    setPosterFailed(false);
  }, [cover]);

  const showPoster = video && !!cover && !posterFailed;
  const badge = Math.round(playSize * 2.2);

  return (
    <div
      className={cn('relative w-full h-full overflow-hidden', onClick && 'cursor-pointer', className)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      {!video ? (
        <img
          src={src}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      ) : showPoster ? (
        <img
          src={cover}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setPosterFailed(true)}
        />
      ) : (
        <div className="w-full h-full glass-media-thumb" />
      )}
      {video && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
          <div
            className="rounded-full bg-white/80 flex items-center justify-center"
            style={{ width: badge, height: badge }}
          >
            <Play size={playSize} className="text-gray-800 ml-0.5" />
          </div>
        </div>
      )}
    </div>
  );
}
