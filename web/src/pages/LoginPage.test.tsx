import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from './LoginPage';

const login = vi.fn();
const navigate = vi.fn();

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ login }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

describe('LoginPage', () => {
  beforeEach(() => {
    login.mockReset();
    navigate.mockReset();
  });

  it('submits credentials and navigates home', async () => {
    login.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    await user.type(screen.getByPlaceholderText('请输入用户名'), 'admin');
    await user.type(screen.getByPlaceholderText('请输入密码'), 'secret');
    await user.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => expect(login).toHaveBeenCalledWith('admin', 'secret'));
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('shows an error when login fails', async () => {
    login.mockRejectedValue(new Error('用户名或密码错误'));
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    await user.type(screen.getByPlaceholderText('请输入用户名'), 'admin');
    await user.type(screen.getByPlaceholderText('请输入密码'), 'bad');
    await user.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findByText('用户名或密码错误')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});
