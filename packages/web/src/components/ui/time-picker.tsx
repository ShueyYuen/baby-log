import * as React from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

interface TimePickerProps {
  value: string; // "HH:mm" format
  onChange: (value: string) => void;
  className?: string;
}

export function TimePicker({ value, onChange, className }: TimePickerProps) {
  const [hours, minutes] = (value || '00:00').split(':').map(Number);

  const setHours = (h: number) => {
    const newH = ((h % 24) + 24) % 24;
    onChange(`${String(newH).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`);
  };

  const setMinutes = (m: number) => {
    const newM = ((m % 60) + 60) % 60;
    onChange(`${String(hours).padStart(2, '0')}:${String(newM).padStart(2, '0')}`);
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
        <div className="w-12 h-10 flex items-center justify-center rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
          <span className="text-lg font-semibold tabular-nums dark:text-gray-100">
            {String(hours).padStart(2, '0')}
          </span>
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
          onClick={() => setMinutes(minutes + 5)}
          className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-700 transition-colors"
        >
          <ChevronUp size={16} />
        </button>
        <div className="w-12 h-10 flex items-center justify-center rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
          <span className="text-lg font-semibold tabular-nums dark:text-gray-100">
            {String(minutes).padStart(2, '0')}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMinutes(minutes - 5)}
          className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-700 transition-colors"
        >
          <ChevronDown size={16} />
        </button>
      </div>
    </div>
  );
}
