import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { RecordCard } from './RecordCard';
import { FeedingPredictionCard } from './FeedingPredictionCard';
import type { TimelineRecord } from '../lib/api';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

const bottle: TimelineRecord = {
  id: 'r1',
  category: 'feeding',
  type: 'bottle',
  data: { milkType: 'formula', amountMl: 120 },
  occurredAt: '2026-08-25T08:15:00.000Z',
  user: { displayName: '妈妈' },
};

describe('RecordCard', () => {
  it('shows type, detail, and recorder, and navigates when editable', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <RecordCard record={bottle} isViewer={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText('瓶喂')).toBeInTheDocument();
    expect(screen.getByText('配方奶 120ml')).toBeInTheDocument();
    expect(screen.getByText('妈妈')).toBeInTheDocument();
    await user.click(screen.getByText('瓶喂'));
    expect(navigate).toHaveBeenCalledWith('/record/r1/edit', { state: { record: bottle } });
  });

  it('does not navigate for viewers', async () => {
    navigate.mockClear();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <RecordCard record={bottle} isViewer />
      </MemoryRouter>,
    );
    await user.click(screen.getByText('瓶喂'));
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('FeedingPredictionCard', () => {
  it('renders upcoming feeding time and method', () => {
    render(
      <FeedingPredictionCard
        prediction={{ minutesUntilNext: 45, avgIntervalMinutes: 180, method: 'bottle' }}
        pushEnabled={false}
        onPush={() => {}}
      />,
    );
    expect(screen.getByText(/约 45 分钟后/)).toBeInTheDocument();
    expect(screen.getByText(/基于奶量/)).toBeInTheDocument();
  });

  it('renders overdue copy and hides itself without a prediction', () => {
    const { rerender } = render(
      <FeedingPredictionCard
        prediction={{ minutesUntilNext: -20, avgIntervalMinutes: 180, method: 'breastfeed' }}
        pushEnabled
        onPush={() => {}}
      />,
    );
    expect(screen.getByText(/已超时 20 分钟/)).toBeInTheDocument();
    rerender(
      <FeedingPredictionCard
        prediction={{ minutesUntilNext: null, avgIntervalMinutes: null, method: null }}
        pushEnabled={false}
        onPush={() => {}}
      />,
    );
    expect(screen.queryByText(/预计下次喂奶/)).not.toBeInTheDocument();
  });
});
