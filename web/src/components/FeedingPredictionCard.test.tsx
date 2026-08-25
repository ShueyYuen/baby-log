import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FeedingPredictionCard } from './FeedingPredictionCard';

vi.mock('../lib/push', () => ({
  isPushSupported: () => true,
}));

vi.mock('../lib/calendar', () => ({
  addFeedingReminderToCalendar: vi.fn(),
}));

describe('FeedingPredictionCard', () => {
  it('returns null without a prediction window', () => {
    const { container } = render(
      <FeedingPredictionCard
        prediction={{ minutesUntilNext: null, avgIntervalMinutes: 90, method: 'bottle' } as never}
        pushEnabled={false}
        onPush={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows overdue copy and can request a reminder', async () => {
    const onPush = vi.fn();
    const user = userEvent.setup();
    render(
      <FeedingPredictionCard
        prediction={{ minutesUntilNext: -5, avgIntervalMinutes: 120, method: 'bottle' }}
        pushEnabled={false}
        onPush={onPush}
      />,
    );
    expect(screen.getByText(/已超时/)).toBeInTheDocument();
    await user.click(screen.getByTitle('开启推送'));
    expect(onPush).toHaveBeenCalled();
  });
});
