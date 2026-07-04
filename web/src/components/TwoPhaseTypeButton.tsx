import { useEffect, useState, type ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';
import { useLongPress } from '../hooks/useLongPress';

const LONG_PRESS_MS = 500;

interface TwoPhaseTypeButtonProps {
  label: string;
  icon: ComponentType<LucideProps>;
  color: string;
  onShortPress: () => void;
  onLongPress: () => void;
}

/** 支持短按（表单）与长按（直接开始计时）的类型入口 */
export function TwoPhaseTypeButton({
  label,
  icon: Icon,
  color,
  onShortPress,
  onLongPress,
}: TwoPhaseTypeButtonProps) {
  const [pressing, setPressing] = useState(false);
  const [progress, setProgress] = useState(0);

  const { bind } = useLongPress({
    delay: LONG_PRESS_MS,
    onLongPress,
    onClick: onShortPress,
  });

  useEffect(() => {
    if (!pressing) {
      setProgress(0);
      return;
    }
    const start = Date.now();
    const tick = window.setInterval(() => {
      const p = Math.min(100, ((Date.now() - start) / LONG_PRESS_MS) * 100);
      setProgress(p);
      if (p >= 100) window.clearInterval(tick);
    }, 16);
    return () => window.clearInterval(tick);
  }, [pressing]);

  const handlers = bind();

  return (
    <button
      type="button"
      {...handlers}
      onPointerDown={(e) => {
        setPressing(true);
        handlers.onPointerDown(e);
      }}
      onPointerUp={(e) => {
        setPressing(false);
        handlers.onPointerUp(e);
      }}
      onPointerLeave={() => {
        setPressing(false);
        handlers.onPointerLeave();
      }}
      onPointerCancel={() => {
        setPressing(false);
        handlers.onPointerCancel();
      }}
      onTouchStart={(e) => {
        setPressing(true);
        handlers.onTouchStart(e);
      }}
      onTouchEnd={() => {
        setPressing(false);
        handlers.onTouchEnd();
      }}
      onTouchCancel={() => {
        setPressing(false);
        handlers.onTouchCancel();
      }}
      className="relative flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors select-none touch-none"
      style={{ WebkitTouchCallout: 'none', touchAction: 'none' }}
    >
      <div className={`relative w-12 h-12 rounded-full flex items-center justify-center ${color}`}>
        {pressing && (
          <svg
            className="absolute inset-0 w-full h-full -rotate-90"
            viewBox="0 0 48 48"
            aria-hidden
          >
            <circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-200 dark:text-indigo-800" />
            <circle
              cx="24"
              cy="24"
              r="22"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="text-indigo-500"
              strokeDasharray={`${2 * Math.PI * 22}`}
              strokeDashoffset={`${2 * Math.PI * 22 * (1 - progress / 100)}`}
            />
          </svg>
        )}
        <Icon size={22} />
      </div>
      <span className="text-xs text-gray-700 dark:text-gray-300">{label}</span>
      <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-indigo-400" title="长按开始" />
    </button>
  );
}
