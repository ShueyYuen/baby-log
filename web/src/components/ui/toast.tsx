import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { cn } from '../../lib/utils';
import { hapticSuccess, hapticError } from '../../lib/haptic';

type ToastVariant = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  exiting?: boolean;
}

interface ToastContextType {
  toast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

let nextId = 0;

function ToastItem({ toast: t, onRemove }: { toast: Toast; onRemove: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (t.exiting && ref.current) {
      const el = ref.current;
      el.addEventListener('animationend', () => onRemove(t.id), { once: true });
    }
  }, [t.exiting, t.id, onRemove]);

  return (
    <div
      ref={ref}
      className={cn(
        'glass-toast flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg border text-sm backdrop-blur-md',
        t.exiting ? 'toast-exit' : 'toast-enter',
        t.variant === 'success' && 'bg-green-50/70 border-green-200/60 text-green-800 glass-toast-success',
        t.variant === 'error' && 'bg-red-50/70 border-red-200/60 text-red-800 glass-toast-error',
        t.variant === 'info' && 'bg-blue-50/70 border-blue-200/60 text-blue-800 glass-toast-info',
      )}
    >
      {t.variant === 'success' && <CheckCircle2 size={16} className="shrink-0" />}
      {t.variant === 'error' && <AlertCircle size={16} className="shrink-0" />}
      {t.variant === 'info' && <Info size={16} className="shrink-0" />}
      <span className="flex-1">{t.message}</span>
      <button onClick={() => onRemove(t.id)} className="shrink-0 opacity-60 hover:opacity-100">
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, variant: ToastVariant = 'info') => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, variant }]);

    if (variant === 'success') hapticSuccess();
    else if (variant === 'error') hapticError();

    setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    }, 2800);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      {/* Mobile: top center; Desktop: bottom right */}
      <div className="fixed top-[calc(env(safe-area-inset-top)+12px)] left-1/2 -translate-x-1/2 md:top-auto md:bottom-4 md:right-4 md:left-auto md:translate-x-0 z-[100] flex flex-col gap-2 w-[calc(100%-32px)] max-w-sm pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onRemove={removeToast} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
