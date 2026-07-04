import * as React from 'react';
import { cn } from '../../lib/utils';
import dayjs from 'dayjs';

interface ScrollColumnProps {
  items: { value: string; label: string }[];
  selected: string;
  onSelect: (value: string) => void;
  circular?: boolean;
  className?: string;
}

function ScrollColumn({ items, selected, onSelect, circular = false, className }: ScrollColumnProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const itemHeight = 36;
  const isScrollingRef = React.useRef(false);
  const scrollTimeoutRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  const repeats = circular ? 3 : 1;
  const totalItems = items.length * repeats;
  const middleOffset = circular ? items.length : 0;

  React.useEffect(() => {
    if (containerRef.current && !isScrollingRef.current) {
      const idx = items.findIndex((item) => item.value === selected);
      if (idx >= 0) {
        containerRef.current.scrollTop = (middleOffset + idx) * itemHeight;
      }
    }
  }, [selected, items, middleOffset]);

  const handleScroll = () => {
    isScrollingRef.current = true;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      if (!containerRef.current) return;
      const scrollTop = containerRef.current.scrollTop;
      let idx = Math.round(scrollTop / itemHeight);

      if (circular) {
        // Wrap around logic
        if (idx < items.length * 0.5) {
          idx += items.length;
          containerRef.current.scrollTop = idx * itemHeight;
        } else if (idx >= items.length * 2.5) {
          idx -= items.length;
          containerRef.current.scrollTop = idx * itemHeight;
        }
      }

      const clampedIdx = Math.max(0, Math.min(idx, totalItems - 1));
      containerRef.current.scrollTo({ top: clampedIdx * itemHeight, behavior: 'smooth' });

      const realIdx = circular ? clampedIdx % items.length : clampedIdx;
      if (items[realIdx] && items[realIdx].value !== selected) {
        onSelect(items[realIdx].value);
      }
      setTimeout(() => { isScrollingRef.current = false; }, 100);
    }, 80);
  };

  const renderItems = React.useMemo(() => {
    const result: { value: string; label: string; key: string }[] = [];
    for (let r = 0; r < repeats; r++) {
      for (let i = 0; i < items.length; i++) {
        result.push({ ...items[i], key: `${r}-${i}` });
      }
    }
    return result;
  }, [items, repeats]);

  return (
    <div className={cn('relative h-[144px] overflow-hidden', className)}>
      <div className="absolute top-[54px] left-1 right-1 h-[36px] rounded-md border-2 border-primary-400 dark:border-primary-500 bg-primary-100/70 dark:bg-primary-500/25 pointer-events-none z-10" />
      <div className="absolute top-0 left-0 right-0 h-[54px] bg-gradient-to-b from-white dark:from-gray-800 to-transparent pointer-events-none z-10" />
      <div className="absolute bottom-0 left-0 right-0 h-[54px] bg-gradient-to-t from-white dark:from-gray-800 to-transparent pointer-events-none z-10" />

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto scrollbar-hide"
        style={{ paddingTop: 54, paddingBottom: 54, scrollSnapType: 'y mandatory' }}
      >
        {renderItems.map((item, i) => (
          <div
            key={item.key}
            className={cn(
              'h-[36px] flex items-center justify-center snap-center select-none cursor-pointer transition-all',
              item.value === selected
                ? 'relative z-20 text-primary-600 dark:text-primary-300 font-semibold text-base'
                : 'text-sm text-gray-400 dark:text-gray-500'
            )}
            onClick={() => {
              onSelect(item.value);
              if (containerRef.current) {
                containerRef.current.scrollTo({ top: i * itemHeight, behavior: 'smooth' });
              }
            }}
          >
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function dateLabel(d: dayjs.Dayjs, todayStr: string): string {
  const diff = d.startOf('day').diff(dayjs(todayStr).startOf('day'), 'day');
  if (diff === 0) return `${d.format('MM-DD')} 今天`;
  if (diff === -1) return `${d.format('MM-DD')} 昨天`;
  if (diff === 1) return `${d.format('MM-DD')} 明天`;
  return d.format('MM-DD ddd');
}

interface DateScrollColumnProps {
  selected: string;
  onSelect: (value: string) => void;
  className?: string;
}

// 日期列：无限滚动。滚动接近顶部/底部时动态扩展日期范围，并补偿滚动位置。
function DateScrollColumn({ selected, onSelect, className }: DateScrollColumnProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const itemHeight = 36;
  const isScrollingRef = React.useRef(false);
  const scrollTimeoutRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const STEP = 30;
  const EDGE = 4;

  const todayStr = React.useMemo(() => dayjs().format('YYYY-MM-DD'), []);
  const [range, setRange] = React.useState({ past: 60, future: 30 });
  const prevPastRef = React.useRef(range.past);

  const items = React.useMemo(() => {
    const today = dayjs(todayStr);
    const arr: { value: string; label: string }[] = [];
    for (let i = -range.past; i <= range.future; i++) {
      const d = today.add(i, 'day');
      arr.push({ value: d.format('YYYY-MM-DD'), label: dateLabel(d, todayStr) });
    }
    return arr;
  }, [range, todayStr]);

  // 扩展前置日期后，补偿 scrollTop，保持视觉位置不跳动
  React.useLayoutEffect(() => {
    if (!containerRef.current) return;
    const delta = range.past - prevPastRef.current;
    if (delta !== 0) {
      containerRef.current.scrollTop += delta * itemHeight;
      prevPastRef.current = range.past;
    }
  }, [range.past]);

  // 外部 selected 变化时（且用户未在滚动）定位到对应项
  React.useEffect(() => {
    if (!containerRef.current || isScrollingRef.current) return;
    const idx = items.findIndex((item) => item.value === selected);
    if (idx >= 0) {
      containerRef.current.scrollTop = idx * itemHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const handleScroll = () => {
    isScrollingRef.current = true;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      if (!containerRef.current) return;
      const scrollTop = containerRef.current.scrollTop;
      const idx = Math.round(scrollTop / itemHeight);

      // 接近顶部：向前扩展（返回后由 layout effect 补偿位置，CSS scroll-snap 负责对齐）
      if (idx <= EDGE) {
        setRange((r) => ({ ...r, past: r.past + STEP }));
        setTimeout(() => { isScrollingRef.current = false; }, 100);
        return;
      }
      // 接近底部：向后扩展（追加不影响已有索引）
      if (idx >= items.length - 1 - EDGE) {
        setRange((r) => ({ ...r, future: r.future + STEP }));
      }

      const clampedIdx = Math.max(0, Math.min(idx, items.length - 1));
      containerRef.current.scrollTo({ top: clampedIdx * itemHeight, behavior: 'smooth' });
      const item = items[clampedIdx];
      if (item && item.value !== selected) {
        onSelect(item.value);
      }
      setTimeout(() => { isScrollingRef.current = false; }, 100);
    }, 80);
  };

  return (
    <div className={cn('relative h-[144px] overflow-hidden', className)}>
      <div className="absolute top-[54px] left-1 right-1 h-[36px] rounded-md border-2 border-primary-400 dark:border-primary-500 bg-primary-100/70 dark:bg-primary-500/25 pointer-events-none z-10" />
      <div className="absolute top-0 left-0 right-0 h-[54px] bg-gradient-to-b from-white dark:from-gray-800 to-transparent pointer-events-none z-10" />
      <div className="absolute bottom-0 left-0 right-0 h-[54px] bg-gradient-to-t from-white dark:from-gray-800 to-transparent pointer-events-none z-10" />

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto scrollbar-hide"
        style={{ paddingTop: 54, paddingBottom: 54, scrollSnapType: 'y mandatory' }}
      >
        {items.map((item, i) => (
          <div
            key={item.value}
            className={cn(
              'h-[36px] flex items-center justify-center snap-center select-none cursor-pointer transition-all',
              item.value === selected
                ? 'relative z-20 text-primary-600 dark:text-primary-300 font-semibold text-base'
                : 'text-sm text-gray-400 dark:text-gray-500'
            )}
            onClick={() => {
              onSelect(item.value);
              if (containerRef.current) {
                containerRef.current.scrollTo({ top: i * itemHeight, behavior: 'smooth' });
              }
            }}
          >
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}

interface ScrollDateTimePickerProps {
  value?: string; // "YYYY-MM-DDTHH:mm" format
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function ScrollDateTimePicker({ value, onChange, className }: ScrollDateTimePickerProps) {
  const parsed = value ? dayjs(value) : dayjs();
  const [selectedDate, setSelectedDate] = React.useState(parsed.format('YYYY-MM-DD'));
  const [selectedHour, setSelectedHour] = React.useState(parsed.format('HH'));
  const [selectedMinute, setSelectedMinute] = React.useState(parsed.format('mm'));

  React.useEffect(() => {
    if (value) {
      const d = dayjs(value);
      setSelectedDate(d.format('YYYY-MM-DD'));
      setSelectedHour(d.format('HH'));
      setSelectedMinute(d.format('mm'));
    }
  }, [value]);

  const emitChange = (date: string, hour: string, minute: string) => {
    if (onChange) {
      onChange(`${date}T${hour}:${minute}`);
    }
  };

  const handleDateChange = (v: string) => { setSelectedDate(v); emitChange(v, selectedHour, selectedMinute); };
  const handleHourChange = (v: string) => { setSelectedHour(v); emitChange(selectedDate, v, selectedMinute); };
  const handleMinuteChange = (v: string) => { setSelectedMinute(v); emitChange(selectedDate, selectedHour, v); };

  const hourItems = React.useMemo(() =>
    Array.from({ length: 24 }, (_, i) => ({
      value: String(i).padStart(2, '0'),
      label: String(i).padStart(2, '0'),
    })), []);

  const minuteItems = React.useMemo(() =>
    Array.from({ length: 60 }, (_, i) => ({
      value: String(i).padStart(2, '0'),
      label: String(i).padStart(2, '0'),
    })), []);

  return (
    <div className={cn('flex rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 overflow-hidden', className)}>
      <DateScrollColumn
        selected={selectedDate}
        onSelect={handleDateChange}
        className="flex-[2] border-r border-gray-100 dark:border-gray-700"
      />
      <ScrollColumn
        items={hourItems}
        selected={selectedHour}
        onSelect={handleHourChange}
        circular
        className="flex-1 border-r border-gray-100 dark:border-gray-700"
      />
      <ScrollColumn
        items={minuteItems}
        selected={selectedMinute}
        onSelect={handleMinuteChange}
        circular
        className="flex-1"
      />
    </div>
  );
}
