import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

const me = vi.fn();
const login = vi.fn();
const logout = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    auth: {
      me: () => me(),
      login: (...args: unknown[]) => login(...args),
      logout: () => logout(),
    },
  },
}));

vi.mock('../lib/queryCache', () => ({
  cacheInvalidate: vi.fn(),
}));

function Probe() {
  const { user, loading, isAdmin, isViewer, login, logout } = useAuth();
  if (loading) return <div>loading</div>;
  return (
    <div>
      <span data-testid="user">{user?.username ?? 'none'}</span>
      <span data-testid="admin">{String(isAdmin)}</span>
      <span data-testid="viewer">{String(isViewer)}</span>
      <button onClick={() => login('alice', 'secret')}>login</button>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    me.mockReset();
    login.mockReset();
    logout.mockReset();
  });

  it('restores the session from /auth/me', async () => {
    me.mockResolvedValue({
      data: { id: '1', username: 'alice', displayName: 'Alice', role: 'admin' },
    });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('alice'));
    expect(screen.getByTestId('admin').textContent).toBe('true');
  });

  it('logs in, stores the token, and logs out', async () => {
    me.mockRejectedValue(new Error('unauth'));
    login.mockResolvedValue({
      data: {
        token: 'tok-abc',
        user: { id: '1', username: 'alice', displayName: 'Alice', role: 'viewer' },
      },
    });
    logout.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('none'));
    await user.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('alice'));
    expect(localStorage.getItem('token')).toBe('tok-abc');
    expect(screen.getByTestId('viewer').textContent).toBe('true');

    await user.click(screen.getByText('logout'));
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('none'));
    expect(localStorage.getItem('token')).toBeNull();
  });
});
