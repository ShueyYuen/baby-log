import { describe, expect, it } from 'vitest';
import { fileLocationBadge } from './file-location';

describe('fileLocationBadge', () => {
  it('treats S3 without a local copy as stored in S3, not missing', () => {
    expect(fileLocationBadge(false, 's3')).toEqual({
      labelKey: 'admin.statusS3',
      variant: 'info',
    });
  });

  it('labels a remaining local copy as cache when storage is S3', () => {
    expect(fileLocationBadge(true, 's3')).toEqual({
      labelKey: 'admin.statusLocalCache',
      variant: 'secondary',
    });
  });

  it('keeps a danger badge for files missing from local disk', () => {
    expect(fileLocationBadge(false, 'local')).toEqual({
      labelKey: 'admin.statusMissing',
      variant: 'danger',
    });
    expect(fileLocationBadge(false, undefined)).toEqual({
      labelKey: 'admin.statusMissing',
      variant: 'danger',
    });
  });

  it('labels files present on local disk', () => {
    expect(fileLocationBadge(true, 'local')).toEqual({
      labelKey: 'admin.statusLocal',
      variant: 'secondary',
    });
  });
});
