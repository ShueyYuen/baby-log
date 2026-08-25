import { describe, expect, it, vi } from 'vitest';
import { cropAndResizeAvatar } from './avatar-crop';

describe('cropAndResizeAvatar', () => {
  it('crops a loaded image onto a JPEG canvas', async () => {
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 120;
      naturalHeight = 80;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:avatar');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb) {
      cb?.(new Blob(['jpg'], { type: 'image/jpeg' }));
    });

    const out = await cropAndResizeAvatar(new File(['x'], 'face.png', { type: 'image/png' }));
    expect(out.type).toBe('image/jpeg');
    expect(out.name).toBe('face_avatar.jpg');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects when the image fails to load', async () => {
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:bad');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    await expect(cropAndResizeAvatar(new File(['x'], 'bad.png', { type: 'image/png' }))).rejects.toThrow(
      'Failed to load image',
    );
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
