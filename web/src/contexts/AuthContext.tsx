import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '../lib/api';
import { cacheInvalidate } from '../lib/queryCache';

interface User {
  id: string;
  username: string;
  displayName: string;
  role: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  isAdmin: boolean;
  isViewer: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Cookie-based auth: try /auth/me — cookie is sent automatically
    api.get<{ success: boolean; data: User }>('/auth/me')
      .then((res) => setUser(res.data))
      .catch(() => {
        // Also clear any legacy localStorage token
        localStorage.removeItem('token');
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    const res = await api.post<{ success: boolean; data: { token: string; user: User } }>('/auth/login', { username, password });
    // Token is now set as HttpOnly cookie by the server; keep localStorage for backward compat
    localStorage.setItem('token', res.data.token);
    setUser(res.data.user);
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout', {});
    } catch { /* ignore */ }
    localStorage.removeItem('token');
    cacheInvalidate('');
    setUser(null);
  };

  const isAdmin = user?.role === 'admin';
  const isViewer = user?.role === 'viewer';

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAdmin, isViewer }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
