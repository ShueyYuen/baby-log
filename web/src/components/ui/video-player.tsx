import * as React from 'react';
import Artplayer from 'artplayer';
import { cn } from '../../lib/utils';

export interface VideoPlayerProps {
  src: string;
  poster?: string;
  autoPlay?: boolean;
  className?: string;
}

export function VideoPlayer({
  src,
  poster,
  autoPlay = true,
  className,
}: VideoPlayerProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const art = new Artplayer({
      container,
      url: src,
      poster: poster || '',
      volume: 0.8,
      autoplay: autoPlay,
      autoSize: false,
      autoMini: false,
      loop: false,
      flip: false,
      playbackRate: true,
      aspectRatio: false,
      screenshot: false,
      setting: true,
      hotkey: true,
      pip: true,
      mutex: true,
      fullscreen: true,
      fullscreenWeb: false,
      miniProgressBar: true,
      playsInline: true,
      lock: true,
      gesture: false,
      fastForward: true,
      autoPlayback: true,
      autoOrientation: true,
      airplay: true,
      theme: '#f19232',
      lang: 'zh-cn',
      id: src,
      moreVideoAttr: {
        playsInline: true,
        preload: 'auto',
      },
    });

    return () => {
      if (!art.isDestroy) art.destroy(true);
    };
  }, [src, poster, autoPlay]);

  return (
    <div
      ref={containerRef}
      data-testid="video-player"
      className={cn('h-full w-full', className)}
    />
  );
}
