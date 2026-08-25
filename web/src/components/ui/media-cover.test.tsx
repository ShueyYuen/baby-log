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

  it('falls back to a derived poster URL when none is provided', () => {
    const { container } = render(<MediaCover src="/c.mp4" mediaType="video" />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/c.poster.jpg');
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('shows a processing badge and no play button', () => {
    const { container, getByText } = render(
      <MediaCover src="" mediaType="video" posterSrc="/d.poster.jpg" processing />,
    );
    expect(getByText('处理中')).toBeTruthy();
    expect(container.querySelector('svg')).toBeNull();
  });
});
