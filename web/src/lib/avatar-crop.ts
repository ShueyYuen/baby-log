const AVATAR_SIZE = 256;

export function cropAndResizeAvatar(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const { naturalWidth: w, naturalHeight: h } = img;
      const size = Math.min(w, h);
      const sx = (w - size) / 2;
      const sy = (h - size) / 2;

      const canvas = document.createElement('canvas');
      canvas.width = AVATAR_SIZE;
      canvas.height = AVATAR_SIZE;
      const ctx = canvas.getContext('2d')!;

      ctx.drawImage(img, sx, sy, size, size, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Canvas export failed'));
            return;
          }
          const name = file.name.replace(/\.[^.]+$/, '') + '_avatar.jpg';
          resolve(new File([blob], name, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        0.85,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}
