import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TimelineRecord } from '../lib/api';
import { OngoingBanner } from './OngoingBanner';
import { ToastProvider } from './ui/toast';

vi.mock('../lib/api', () => ({
  api: {
    recordsCrud: {
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

const play: TimelineRecord = {
  id: 'p1',
  category: 'activity',
  type: 'play',
  occurredAt: new Date(Date.now() - 600_000).toISOString(),
  data: { ongoing: true, startTime: new Date(Date.now() - 600_000).toISOString() },
};

const sleep: TimelineRecord = {
  id: 's1',
  category: 'activity',
  type: 'sleep',
  occurredAt: new Date(Date.now() - 3600_000).toISOString(),
  data: { ongoing: true, startTime: new Date(Date.now() - 3600_000).toISOString() },
};

describe('OngoingBanner', () => {
  it('renders nothing without ongoing records', () => {
    const { container } = render(
      <ToastProvider>
        <OngoingBanner records={[]} isViewer={false} now={Date.now()} />
      </ToastProvider>,
    );
    expect(container.querySelector('.card')).toBeNull();
  });

  it('hides the end button for viewers', () => {
    render(
      <ToastProvider>
        <OngoingBanner records={[play]} isViewer now={Date.now()} />
      </ToastProvider>,
    );
    expect(screen.queryByText('结束')).toBeNull();
  });

  it('ends a non-sleep record immediately', async () => {
    const { api } = await import('../lib/api');
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(
      <ToastProvider>
        <OngoingBanner records={[play]} isViewer={false} now={Date.now()} onChanged={onChanged} />
      </ToastProvider>,
    );
    await user.click(screen.getByText('结束'));
    await waitFor(() => expect(api.recordsCrud.update).toHaveBeenCalled());
    expect(onChanged).toHaveBeenCalled();
  });

  it('asks for confirmation before ending sleep', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <OngoingBanner records={[sleep]} isViewer={false} now={Date.now()} />
      </ToastProvider>,
    );
    await user.click(screen.getByText('结束'));
    expect(await screen.findByText('结束睡眠')).toBeInTheDocument();
    await user.click(screen.getByText('取消'));
    await waitFor(() => expect(screen.queryByText('结束睡眠')).not.toBeInTheDocument());
  });
});
