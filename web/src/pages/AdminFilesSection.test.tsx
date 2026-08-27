import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../contexts/I18nContext';
import { ToastProvider } from '../components/ui/toast';
import type { AdminUploadsResponse } from '../lib/api';
import AdminFilesSection from './AdminFilesSection';

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    api: {
      admin: {
        listUploads: vi.fn(),
      },
    },
  };
});

import { api } from '../lib/api';

const listUploads = api.admin.listUploads as ReturnType<typeof vi.fn>;

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

describe('AdminFilesSection S3 storage', () => {
  beforeEach(() => {
    listUploads.mockReset();
    listUploads.mockResolvedValue({ data: s3List() });
  });

  it('explains S3 storage and does not mark synced files as missing', async () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <ToastProvider>
            <AdminFilesSection />
          </ToastProvider>
        </I18nProvider>
      </MemoryRouter>,
    );

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

    render(
      <MemoryRouter>
        <I18nProvider>
          <ToastProvider>
            <AdminFilesSection />
          </ToastProvider>
        </I18nProvider>
      </MemoryRouter>,
    );

    const fileName = await screen.findByText('photo.jpg');
    const loadMore = screen.getByRole('button', { name: '加载更多' });
    expect(loadMore.parentElement).toBe(fileName.closest('.space-y-3'));
  });
});
