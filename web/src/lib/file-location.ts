export type FileLocationBadge = {
  labelKey: 'admin.statusS3' | 'admin.statusLocalCache' | 'admin.statusLocal' | 'admin.statusMissing';
  variant: 'info' | 'secondary' | 'danger';
};

export function fileLocationBadge(local: boolean, storageType?: string): FileLocationBadge {
  if (storageType === 's3') {
    return local
      ? { labelKey: 'admin.statusLocalCache', variant: 'secondary' }
      : { labelKey: 'admin.statusS3', variant: 'info' };
  }
  return local
    ? { labelKey: 'admin.statusLocal', variant: 'secondary' }
    : { labelKey: 'admin.statusMissing', variant: 'danger' };
}
