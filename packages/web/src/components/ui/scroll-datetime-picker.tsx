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
      <div className="absolute top-[54px] left-1 right-1 h-[36px] rounded-md border border-primary-200 dark:border-primary-700 bg-primary-50/60 dark:bg-primary-900/20 pointer-events-none z-10" />
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
              'h-[36px] flex items-center justify-center text-sm snap-center select-none cursor-pointer transition-colors',
              item.value === selected
                ? 'text-gray-900 dark:text-gray-100 font-medium'
                : 'text-gray-400 dark:text-gray-500'
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

  const dateItems = React.useMemo(() => {
    const today = dayjs();
    const items: { value: string; label: string }[] = [];
    for (let i = -30; i <= 7; i++) {
      const d = today.add(i, 'day');
      let label: string;
      if (i === 0) label = `${d.format('MM-DD')} 今天`;
      else if (i === -1) label = `${d.format('MM-DD')} 昨天`;
      else if (i === 1) label = `${d.format('MM-DD')} 明天`;
      else label = d.format('MM-DD ddd');
      items.push({ value: d.format('YYYY-MM-DD'), label });
    }
    return items;
  }, []);

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
      <ScrollColumn
        items={dateItems}
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
