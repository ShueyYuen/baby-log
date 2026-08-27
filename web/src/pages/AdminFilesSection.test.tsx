import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../contexts/I18nContext';
import { ToastProvider } from '../components/ui/toast';
import type { AdminStorageReindexResult, AdminUploadsResponse } from '../lib/api';
import AdminFilesSection from './AdminFilesSection';

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    api: {
      admin: {
        listUploads: vi.fn(),
        cleanup: vi.fn(),
        reindexStorage: vi.fn(),
      },
    },
  };
});

import { api } from '../lib/api';

const listUploads = api.admin.listUploads as ReturnType<typeof vi.fn>;
const reindexStorage = api.admin.reindexStorage as ReturnType<typeof vi.fn>;

function s3List(): AdminUploadsResponse {
  return {
    items: [
      {
        key: 'moments/photo.jpg',
        createdAt: '2026-08-01T00:00:00Z',
        used: true,
        ready: true,
        mediaType: 'image',
        referenced: true,
        local: false,
        size: 0,
        url: 'https://cdn.example/photo.jpg',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
    hasMore: false,
    counts: { total: 1, unready: 0, unused: 0, videos: 0 },
    worker: null,
    queued: 0,
    transcodeEnabled: false,
    storageType: 's3',
  };
}

function reindexResult(overrides: Partial<AdminStorageReindexResult> = {}): AdminStorageReindexResult {
  return {
    listed: 12,
    postersIndexed: 1,
    sizesUpdated: 2,
    tracked: 10,
    skippedRecent: 0,
    skippedReferenced: 0,
    found: 1,
    deleted: 1,
    bytes: 2048,
    listRequests: 8,
    items: [{ key: 'moments/leftover.jpg', size: 2048, lastModified: Date.now() }],
    ...overrides,
  };
}

function renderSection() {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <ToastProvider>
          <AdminFilesSection />
        </ToastProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe('AdminFilesSection S3 storage', () => {
  beforeEach(() => {
    listUploads.mockReset();
    reindexStorage.mockReset();
    listUploads.mockResolvedValue({ data: s3List() });
  });

  it('explains S3 storage and does not mark synced files as missing', async () => {
    renderSection();

    expect(await screen.findByText('当前使用 S3 对象存储。文件同步完成后会从本机删除，这是正常现象，并不代表文件丢失。')).toBeInTheDocument();
    expect(screen.getByText('S3')).toBeInTheDocument();
    expect(screen.queryByText('本地缺失')).not.toBeInTheDocument();
    await waitFor(() => expect(listUploads).toHaveBeenCalled());
  });

  it('keeps the load-more button in the same column as file cards', async () => {
    listUploads.mockResolvedValue({
      data: {
        ...s3List(),
        hasMore: true,
      },
    });

    renderSection();

    const fileName = await screen.findByText('photo.jpg');
    const loadMore = screen.getByRole('button', { name: '加载更多' });
    expect(loadMore.parentElement).toBe(fileName.closest('.space-y-3'));
  });

  it('shows index rebuild for local storage', async () => {
    listUploads.mockResolvedValue({ data: { ...s3List(), storageType: 'local' } });
    renderSection();
    await screen.findByText('photo.jpg');
    expect(screen.getByRole('button', { name: '索引重建' })).toBeInTheDocument();
    expect(screen.getByText('对照本地存储补全文件索引：把已有封面写入数据库、回填缺失尺寸，并删除没有记录的文件。')).toBeInTheDocument();
  });

  it('rebuilds the storage index only after confirm', async () => {
    reindexStorage.mockResolvedValue({ data: reindexResult() });
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole('button', { name: '索引重建' }));
    expect(reindexStorage).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '索引重建' }));
    await waitFor(() => expect(reindexStorage).toHaveBeenCalled());
    expect(await screen.findByText('moments/leftover.jpg · 2.0KB')).toBeInTheDocument();
    expect(screen.getByText('封面入库')).toBeInTheDocument();
    expect(screen.getByText('尺寸回填')).toBeInTheDocument();
  });
});
