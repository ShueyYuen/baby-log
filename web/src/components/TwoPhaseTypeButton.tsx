import { useEffect, useRef, useState, type ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';

const LONG_PRESS_MS = 500;

interface TwoPhaseTypeButtonProps {
  label: string;
  icon: ComponentType<LucideProps>;
  color: string;
  onShortPress: () => void;
  onLongPress: () => void;
}

type GestureSource = 'touch' | 'mouse';

/**
 * 两阶段类型按钮：短按进表单，长按直接开始计时。
 * 触摸走 touch 事件，鼠标/触控板走 pointer（辅以 mouse 兜底），双端互不干扰。
 */
export function TwoPhaseTypeButton({
  label,
  icon: Icon,
  color,
  onShortPress,
  onLongPress,
}: TwoPhaseTypeButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pressing, setPressing] = useState(false);
  const [progress, setProgress] = useState(0);

  const onShortPressRef = useRef(onShortPress);
  const onLongPressRef = useRef(onLongPress);
  onShortPressRef.current = onShortPress;
  onLongPressRef.current = onLongPress;

  useEffect(() => {
    const el = buttonRef.current;
    if (!el) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let progressTimer: ReturnType<typeof setInterval> | null = null;
    let didLongPress = false;
    let activeSource: GestureSource | null = null;
    const hasPointer = typeof window !== 'undefined' && 'PointerEvent' in window;

    const clearTimers = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (progressTimer) clearInterval(progressTimer);
      progressTimer = null;
      setPressing(false);
      setProgress(0);
    };

    const beginPress = (source: GestureSource) => {
      if (activeSource !== null && activeSource !== source) return;
      activeSource = source;
      didLongPress = false;
      clearTimers();
      setPressing(true);

      const startedAt = Date.now();
      progressTimer = setInterval(() => {
        setProgress(Math.min(100, ((Date.now() - startedAt) / LONG_PRESS_MS) * 100));
      }, 16);

      timer = setTimeout(() => {
        didLongPress = true;
        navigator.vibrate?.(40);
        onLongPressRef.current();
        clearTimers();
        activeSource = null;
      }, LONG_PRESS_MS);
    };

    const endPress = (source: GestureSource) => {
      if (activeSource !== source) return;
      clearTimers();
      activeSource = null;
    };

    // ---- 移动端：touch 通道 ----
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 1) return;
      beginPress('touch');
    };
    const onTouchEnd = () => endPress('touch');
    const onTouchCancel = () => endPress('touch');

    // ---- 桌面端：pointer / mouse 通道 ----
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (e.button !== 0) return;
      beginPress('mouse');
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      endPress('mouse');
    };
    const onPointerLeave = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      endPress('mouse');
    };
    const onPointerCancel = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      endPress('mouse');
    };

    const onMouseDown = (e: MouseEvent) => {
      if (hasPointer || e.button !== 0) return;
      beginPress('mouse');
    };
    const onMouseUp = () => {
      if (hasPointer) return;
      endPress('mouse');
    };
    const onMouseLeave = () => {
      if (hasPointer) return;
      endPress('mouse');
    };

    const onClick = (e: MouseEvent) => {
      if (didLongPress) {
        e.preventDefault();
        e.stopPropagation();
        didLongPress = false;
        return;
      }
      onShortPressRef.current();
    };

    const onContextMenu = (e: Event) => e.preventDefault();

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchCancel);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointerleave', onPointerLeave);
    el.addEventListener('pointercancel', onPointerCancel);
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('mouseup', onMouseUp);
    el.addEventListener('mouseleave', onMouseLeave);
    el.addEventListener('click', onClick);
    el.addEventListener('contextmenu', onContextMenu);

    return () => {
      clearTimers();
      activeSource = null;
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointerleave', onPointerLeave);
      el.removeEventListener('pointercancel', onPointerCancel);
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('mouseleave', onMouseLeave);
      el.removeEventListener('click', onClick);
      el.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);

  return (
    <button
      ref={buttonRef}
      type="button"
      className="relative flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 active:bg-gray-100 dark:active:bg-gray-600 transition-colors select-none"
      style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', touchAction: 'manipulation' }}
    >
      <div className={`relative w-12 h-12 rounded-full flex items-center justify-center ${color}`}>
        {pressing && (
          <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 48 48" aria-hidden>
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
      <span className="text-[10px] text-indigo-400 leading-none">按住开始</span>
    </button>
  );
}
