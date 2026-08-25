import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { BabySwitcher } from './BabySwitcher';
import { PullRefreshIndicator } from './PullRefreshIndicator';
import { SleepStrip } from './SleepStrip';
import { TwoPhaseTypeButton } from './TwoPhaseTypeButton';
import { Heart } from 'lucide-react';
import type { TimelineRecord } from '../lib/api';

vi.mock('../contexts/BabyContext', () => ({
  useBaby: () => ({
    babies: [
      { id: 'b1', name: '大宝', gender: 'male', birthDate: '2026-01-01' },
      { id: 'b2', name: '二宝', gender: 'female', birthDate: '2026-06-01', avatar: '/a.jpg' },
    ],
    currentBaby: { id: 'b1', name: '大宝', gender: 'male', birthDate: '2026-01-01' },
    setCurrentBaby: vi.fn(),
  }),
}));

describe('BabySwitcher', () => {
  it('lists babies and can edit the current one', async () => {
    const onOpenChange = vi.fn();
    const onEditCurrent = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <BabySwitcher open onOpenChange={onOpenChange} onEditCurrent={onEditCurrent} />
      </MemoryRouter>,
    );
    expect(screen.getByText('选择宝宝')).toBeInTheDocument();
    expect(screen.getByText('当前')).toBeInTheDocument();
    await user.click(screen.getByText('编辑资料'));
    expect(onEditCurrent).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('SleepStrip', () => {
  it('shows empty copy when there is no sleep', () => {
    render(<SleepStrip records={[]} />);
    expect(screen.getByText('还没有睡眠记录')).toBeInTheDocument();
  });

  it('renders sleep segments', () => {
    const now = Date.now();
    const records: TimelineRecord[] = [
      {
        id: '1',
        category: 'activity',
        type: 'sleep',
        occurredAt: new Date(now - 2 * 3600_000).toISOString(),
        data: {
          startTime: new Date(now - 2 * 3600_000).toISOString(),
          endTime: new Date(now - 3600_000).toISOString(),
          durationMinutes: 60,
        },
      },
    ];
    render(<SleepStrip records={records} hours={24} />);
    expect(screen.getByText(/小时睡眠/)).toBeInTheDocument();
    expect(screen.getByText('1小时0分')).toBeInTheDocument();
  });
});

describe('PullRefreshIndicator', () => {
  it('hides when idle and shows while pulling', () => {
    const { rerender } = render(<PullRefreshIndicator pullDistance={0} refreshing={false} />);
    expect(document.querySelector('.animate-spin')).toBeNull();
    rerender(<PullRefreshIndicator pullDistance={30} refreshing={false} />);
    expect(document.querySelector('[style]')).toBeTruthy();
    rerender(<PullRefreshIndicator pullDistance={0} refreshing />);
    expect(document.querySelector('.animate-spin')).toBeTruthy();
  });
});

describe('TwoPhaseTypeButton', () => {
  it('fires short press on click', async () => {
    const short = vi.fn();
    const long = vi.fn();
    const user = userEvent.setup();
    render(
      <TwoPhaseTypeButton label="睡眠" icon={Heart} color="text-indigo-500" onShortPress={short} onLongPress={long} />,
    );
    await user.click(screen.getByRole('button', { name: /睡眠/ }));
    expect(short).toHaveBeenCalled();
    expect(long).not.toHaveBeenCalled();
  });

  it('fires long press after holding the pointer', async () => {
    vi.useFakeTimers();
    const short = vi.fn();
    const long = vi.fn();
    render(
      <TwoPhaseTypeButton label="睡眠" icon={Heart} color="text-indigo-500" onShortPress={short} onLongPress={long} />,
    );
    const btn = screen.getByRole('button', { name: /睡眠/ });
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0 }));
    await vi.advanceTimersByTimeAsync(600);
    expect(long).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
