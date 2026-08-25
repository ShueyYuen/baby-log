import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MediaCover } from './media-cover';

describe('MediaCover', () => {
  it('renders an image without a play badge', () => {
    const { container } = render(<MediaCover src="/a.jpg" mediaType="image" />);
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toBe('/a.jpg');
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders a video cover image plus play badge', () => {
    const { container } = render(
      <MediaCover src="/b.mp4" mediaType="video" posterSrc="/b.poster.jpg" />,
    );
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/b.poster.jpg');
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('falls back to a play badge when a video has no poster', () => {
    const { container } = render(<MediaCover src="/c.mp4" mediaType="video" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('svg')).toBeTruthy();
  });
});
