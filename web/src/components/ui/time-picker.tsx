import { ChevronDown, ChevronUp } from 'lucide-react';
import * as React from 'react';
import { cn } from '../../lib/utils';

interface TimePickerProps {
  value: string; // "HH:mm" format
  onChange: (value: string) => void;
  className?: string;
}

export function TimePicker({ value, onChange, className }: TimePickerProps) {
  const [hours, minutes] = (value || '00:00').split(':').map(Number);

  const [inputH, setInputH] = React.useState(String(hours).padStart(2, '0'));
  const [inputM, setInputM] = React.useState(String(minutes).padStart(2, '0'));

  React.useEffect(() => {
    setInputH(String(hours).padStart(2, '0'));
    setInputM(String(minutes).padStart(2, '0'));
  }, [hours, minutes]);

  const setTime = (h: number, m: number) => {
    const newH = ((h % 24) + 24) % 24;
    const newM = ((m % 60) + 60) % 60;
    onChange(`${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`);
  };

  const setHours = (h: number) => setTime(h, minutes);
  const setMinutes = (m: number) => setTime(hours, m);

  const handleHourChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 2) val = val.slice(-2);
    setInputH(val);
  };

  const handleMinuteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 2) val = val.slice(-2);
    setInputM(val);
  };

  const handleHourBlur = () => {
    let h = parseInt(inputH, 10);
    if (isNaN(h)) h = hours;
    setTime(h, minutes);
  };

  const handleMinuteBlur = () => {
    let m = parseInt(inputM, 10);
    if (isNaN(m)) m = minutes;
    setTime(hours, m);
  };

  const handleHourKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleHourBlur();
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHours(hours + 1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHours(hours - 1); }
  };

  const handleMinuteKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleMinuteBlur();
    else if (e.key === 'ArrowUp') { e.preventDefault(); setMinutes(minutes + 1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setMinutes(minutes - 1); }
  };

  return (
    <div className={cn('flex items-center justify-center gap-1', className)}>
      {/* Hours */}
      <div className="flex flex-col items-center">
        <button
          type="button"
          onClick={() => setHours(hours + 1)}
          className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-700 transition-colors"
        >
          <ChevronUp size={16} />
        </button>
        <div className="w-12 h-10 flex items-center justify-center rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 focus-within:ring-2 focus-within:ring-primary-500 overflow-hidden">
          <input
            type="text"
            value={inputH}
            onChange={handleHourChange}
            onBlur={handleHourBlur}
            onKeyDown={handleHourKeyDown}
            className="w-full text-center text-lg font-semibold tabular-nums bg-transparent border-none focus:outline-none dark:text-gray-100 p-0"
          />
        </div>
        <button
          type="button"
          onClick={() => setHours(hours - 1)}
          className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-700 transition-colors"
        >
          <ChevronDown size={16} />
        </button>
      </div>

      <span className="text-xl font-bold text-gray-400 dark:text-gray-500 mx-1">:</span>

      {/* Minutes */}
      <div className="flex flex-col items-center">
        <button
          type="button"
          onClick={() => setMinutes(minutes + 1)}
          className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-700 transition-colors"
        >
          <ChevronUp size={16} />
        </button>
        <div className="w-12 h-10 flex items-center justify-center rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 focus-within:ring-2 focus-within:ring-primary-500 overflow-hidden">
          <input
            type="text"
            value={inputM}
            onChange={handleMinuteChange}
            onBlur={handleMinuteBlur}
            onKeyDown={handleMinuteKeyDown}
            className="w-full text-center text-lg font-semibold tabular-nums bg-transparent border-none focus:outline-none dark:text-gray-100 p-0"
          />
        </div>
        <button
          type="button"
          onClick={() => setMinutes(minutes - 1)}
          className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-700 transition-colors"
        >
          <ChevronDown size={16} />
        </button>
      </div>
    </div>
  );
}
