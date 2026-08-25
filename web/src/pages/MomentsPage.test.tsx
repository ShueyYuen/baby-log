import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Moment } from '../lib/api';
import { MomentFormDialog } from './MomentsPage';

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    api: {
      members: {
        list: () => Promise.resolve({ data: [] }),
      },
    },
  };
});

function editMoment(overrides: Partial<Moment> = {}): Moment {
  return {
    id: 'm1',
    userId: 'u1',
    displayName: '妈妈',
    avatar: null,
    content: '宝宝今天很开心',
    mediaItems: [
      {
        key: 'k1',
        mediaType: 'image',
        url: 'https://example.com/a.jpg',
      },
      {
        key: 'k2',
        mediaType: 'image',
        url: 'https://example.com/b.jpg',
      },
    ],
    likeCount: 0,
    liked: false,
    commentCount: 0,
    comments: [],
    createdAt: '2026-08-25T00:00:00Z',
    updatedAt: '2026-08-25T00:00:00Z',
    isOwner: true,
    ...overrides,
  };
}

describe('MomentFormDialog', () => {
  it('shows the empty upload zone when creating a moment', () => {
    render(
      <MomentFormDialog open onClose={() => {}} onSave={async () => {}} />,
    );
    expect(screen.getByText('点击添加照片 / 视频')).toBeInTheDocument();
  });

  it('uses a bottom-sheet animation class on the dialog content', () => {
    render(
      <MomentFormDialog open onClose={() => {}} onSave={async () => {}} />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('glass-dialog-sheet');
  });

  it('restores the upload zone after all existing photos are removed', async () => {
    const user = userEvent.setup();
    render(
      <MomentFormDialog
        open
        onClose={() => {}}
        onSave={async () => {}}
        editMoment={editMoment()}
      />,
    );

    expect(screen.getByText('添加')).toBeInTheDocument();
    expect(screen.queryByText('点击添加照片 / 视频')).not.toBeInTheDocument();

    const removeButtons = screen.getAllByRole('button', { name: '删除' });
    expect(removeButtons).toHaveLength(2);
    await user.click(removeButtons[0]);
    await user.click(screen.getByRole('button', { name: '删除' }));

    expect(screen.getByText('点击添加照片 / 视频')).toBeInTheDocument();
    expect(screen.queryByText('添加')).not.toBeInTheDocument();
  });
});
