import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QuickRecordBar } from './QuickRecordBar';

const toast = vi.fn();
const onCreated = vi.fn();
const quickDiaper = vi.fn().mockResolvedValue({ id: 'r1' });
const authState = { isViewer: false };

vi.mock('../contexts/BabyContext', () => ({
  useBaby: () => ({
    currentBaby: { id: 'b1', name: '宝宝', birthDate: '2024-01-01' },
  }),
}));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => authState,
}));
vi.mock('./ui', async () => {
  const actual = await vi.importActual<typeof import('./ui')>('./ui');
  return { ...actual, useToast: () => ({ toast }) };
});
vi.mock('../lib/quick-record', async () => {
  const actual = await vi.importActual<typeof import('../lib/quick-record')>('../lib/quick-record');
  return {
    ...actual,
    quickDiaper: (...args: unknown[]) => quickDiaper(...args),
    quickBottle: vi.fn().mockResolvedValue({ id: 'b1' }),
    quickBreastfeed: vi.fn().mockResolvedValue({ id: 'bf' }),
    quickSolid: vi.fn().mockResolvedValue({ id: 's1' }),
    quickWater: vi.fn().mockResolvedValue({ id: 'w1' }),
    startOngoing: vi.fn().mockResolvedValue({ id: 'p1' }),
  };
});

describe('QuickRecordBar', () => {
  it('records a wet diaper from the shortcut bar', async () => {
    const user = userEvent.setup();
    render(<QuickRecordBar onCreated={onCreated} />);
    await user.click(screen.getByText('尿'));
    expect(quickDiaper).toHaveBeenCalledWith('b1', 'wet');
    expect(toast).toHaveBeenCalled();
  });

  it('hides for viewers', () => {
    authState.isViewer = true;
    const { container } = render(<QuickRecordBar />);
    expect(container.textContent).toBe('');
    authState.isViewer = false;
  });

  it('starts play from the shortcut bar', async () => {
    const user = userEvent.setup();
    const { startOngoing } = await import('../lib/quick-record');
    render(<QuickRecordBar onCreated={onCreated} />);
    await user.click(screen.getByText('玩耍'));
    expect(startOngoing).toHaveBeenCalled();
  });

  it('does not start play twice', async () => {
    const user = userEvent.setup();
    render(<QuickRecordBar ongoingTypes={['play']} />);
    await user.click(screen.getByText('玩耍'));
    expect(toast).toHaveBeenCalledWith('玩耍已在进行中', 'info');
  });
});
