import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '../lib/api';
import { cacheInvalidate } from '../lib/queryCache';

interface User {
  id: string;
  username: string;
  displayName: string;
  role: string;
  avatar?: string | null;
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
    api.auth.me()
      .then((res) => setUser(res.data as User))
      .catch(() => {
        // Also clear any legacy localStorage token
        localStorage.removeItem('token');
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    const res = await api.auth.login(username, password);
    localStorage.setItem('token', res.data.token);
    setUser(res.data.user as User);
  };

  const logout = async () => {
    try {
      await api.auth.logout();
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
