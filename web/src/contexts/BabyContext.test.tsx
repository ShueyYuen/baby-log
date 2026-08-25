import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BabyProvider, useBaby } from './BabyContext';

const list = vi.fn();

vi.mock('./AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));

vi.mock('../lib/api', () => ({
  api: {
    babies: {
      list: () => list(),
    },
  },
}));

function Probe() {
  const { babies, currentBaby, setCurrentBaby } = useBaby();
  return (
    <div>
      <span data-testid="count">{babies.length}</span>
      <span data-testid="current">{currentBaby?.name ?? 'none'}</span>
      {babies.map((b) => (
        <button key={b.id} onClick={() => setCurrentBaby(b)}>
          {b.name}
        </button>
      ))}
    </div>
  );
}

describe('BabyProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    list.mockReset();
    list.mockResolvedValue({
      data: [
        { id: 'b1', name: '大宝', gender: 'male', birthDate: '2025-01-01' },
        { id: 'b2', name: '二宝', gender: 'female', birthDate: '2026-01-01' },
      ],
    });
  });

  it('selects the first baby by default and honors a saved id', async () => {
    localStorage.setItem('currentBabyId', 'b2');
    render(
      <BabyProvider>
        <Probe />
      </BabyProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('二宝'));
    expect(screen.getByTestId('count').textContent).toBe('2');
  });

  it('persists the selected baby', async () => {
    const user = userEvent.setup();
    render(
      <BabyProvider>
        <Probe />
      </BabyProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('大宝'));
    await user.click(screen.getByText('二宝'));
    expect(screen.getByTestId('current').textContent).toBe('二宝');
    expect(localStorage.getItem('currentBabyId')).toBe('b2');
  });
});
