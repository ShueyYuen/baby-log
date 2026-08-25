import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImageViewer } from './image-viewer';

vi.mock('artplayer', () => ({
  default: vi.fn(function ArtplayerMock(
    this: { destroy: () => void; isDestroy: boolean },
    option: { container: HTMLElement; url: string; poster?: string },
  ) {
    this.isDestroy = false;
    this.destroy = () => {
      this.isDestroy = true;
    };
    option.container.dataset.playerUrl = option.url;
    if (option.poster) option.container.dataset.playerPoster = option.poster;
  }),
}));

describe('ImageViewer', () => {
  it('opens a video with Artplayer instead of a native video element', async () => {
    render(
      <ImageViewer
        open
        onOpenChange={() => {}}
        images={[{ url: '/clip.mp4', mediaType: 'video', posterUrl: '/clip.poster.jpg' }]}
      />,
    );

    expect(await screen.findByTestId('video-player')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('video-player')).toHaveAttribute('data-player-url', '/clip.mp4');
    });
    expect(screen.getByTestId('video-player')).toHaveAttribute(
      'data-player-poster',
      '/clip.poster.jpg',
    );
    expect(document.querySelector('video')).toBeNull();
  });

  it('does not create a player for a processing video', () => {
    render(
      <ImageViewer
        open
        onOpenChange={() => {}}
        images={[{ url: '', mediaType: 'video', posterUrl: '/clip.poster.jpg', processing: true }]}
      />,
    );
    expect(screen.getByTestId('video-processing')).toBeInTheDocument();
    expect(screen.queryByTestId('video-player')).toBeNull();
  });

  it('keeps close and nav buttons above the video player', async () => {
    render(
      <ImageViewer
        open
        onOpenChange={() => {}}
        images={[
          { url: '/a.mp4', mediaType: 'video', posterUrl: '/a.jpg' },
          { url: '/b.mp4', mediaType: 'video' },
        ]}
      />,
    );
    await screen.findByTestId('video-player');
    const chrome = document.querySelectorAll('.lightbox-chrome');
    expect(chrome.length).toBe(2);
    chrome.forEach((el) => expect(el).toHaveClass('z-30'));
    expect(screen.getByTestId('video-player').closest('.isolate')).toHaveClass('z-0');
  });

  it('still renders images with an img tag', () => {
    render(
      <ImageViewer
        open
        onOpenChange={() => {}}
        images={[{ url: '/photo.jpg', mediaType: 'image' }]}
      />,
    );
    expect(screen.queryByTestId('video-player')).not.toBeInTheDocument();
    expect(document.querySelector('img')).toHaveAttribute('src', '/photo.jpg');
  });
});
