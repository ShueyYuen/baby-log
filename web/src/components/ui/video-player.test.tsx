import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VideoPlayer } from './video-player';

const { ArtplayerMock } = vi.hoisted(() => {
  const ArtplayerMock = vi.fn(function ArtplayerMock(
    this: { destroy: ReturnType<typeof vi.fn>; isDestroy: boolean },
    option: { container: HTMLElement; url: string; poster?: string },
  ) {
    this.isDestroy = false;
    this.destroy = vi.fn(() => {
      this.isDestroy = true;
    });
    option.container.dataset.playerUrl = option.url;
    if (option.poster) option.container.dataset.playerPoster = option.poster;
  });
  return { ArtplayerMock };
});

vi.mock('artplayer', () => ({
  default: ArtplayerMock,
}));

describe('VideoPlayer', () => {
  afterEach(() => {
    ArtplayerMock.mockClear();
  });

  it('creates an Artplayer instance with src, poster, and Chinese UI', () => {
    render(<VideoPlayer src="/clip.mp4" poster="/clip.poster.jpg" />);
    expect(ArtplayerMock).toHaveBeenCalledTimes(1);
    expect(ArtplayerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/clip.mp4',
        poster: '/clip.poster.jpg',
        autoplay: true,
        playsInline: true,
        lang: 'zh-cn',
        playbackRate: true,
        fullscreen: true,
        gesture: false,
      }),
    );
  });

  it('destroys the player on unmount', () => {
    const { unmount } = render(<VideoPlayer src="/clip.mp4" />);
    const instance = ArtplayerMock.mock.instances[0] as { destroy: ReturnType<typeof vi.fn> };
    unmount();
    expect(instance.destroy).toHaveBeenCalledWith(true);
  });

  it('rebuilds the player when the source changes', async () => {
    const { rerender } = render(<VideoPlayer src="/a.mp4" />);
    const first = ArtplayerMock.mock.instances[0] as { destroy: ReturnType<typeof vi.fn> };
    rerender(<VideoPlayer src="/b.mp4" />);
    await waitFor(() => expect(ArtplayerMock).toHaveBeenCalledTimes(2));
    expect(first.destroy).toHaveBeenCalledWith(true);
    expect(ArtplayerMock.mock.calls[1][0]).toEqual(
      expect.objectContaining({ url: '/b.mp4' }),
    );
  });
});
