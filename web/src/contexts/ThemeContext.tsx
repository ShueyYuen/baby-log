import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system' | 'night';

interface ThemeContextValue {
  theme: Theme;
  isDark: boolean;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(theme: Theme, dark: boolean) {
  const root = document.documentElement;
  if (theme === 'night' || dark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  if (theme === 'night') {
    root.classList.add('night');
  } else {
    root.classList.remove('night');
  }
}

function resolveIsDark(theme: Theme): boolean {
  if (theme === 'dark' || theme === 'night') return true;
  if (theme === 'light') return false;
  return getSystemDark();
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem('theme') as Theme | null;
    return saved && ['light', 'dark', 'system', 'night'].includes(saved) ? saved : 'system';
  });

  const [isDark, setIsDark] = useState(() => resolveIsDark(theme));

  const updateDark = useCallback((t: Theme, dark: boolean) => {
    setIsDark(dark);
    applyTheme(t, dark);
  }, []);

  useEffect(() => {
    updateDark(theme, resolveIsDark(theme));
  }, [theme, updateDark]);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      updateDark(theme, e.matches);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme, updateDark]);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem('theme', t);
  };

  return (
    <ThemeContext.Provider value={{ theme, isDark, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
