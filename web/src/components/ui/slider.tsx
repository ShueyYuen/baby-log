import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { cn } from '../../lib/utils';

interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  className?: string;
  showValue?: boolean;
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = '',
  className,
  showValue = true,
}: SliderProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {showValue && (
        <div className="flex items-center justify-between">
          <span className="text-2xl font-semibold tabular-nums text-gray-900 dark:text-gray-100">
            {value}
            {unit && <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-1">{unit}</span>}
          </span>
        </div>
      )}
      <SliderPrimitive.Root
        className="relative flex w-full touch-none select-none items-center h-10"
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        min={min}
        max={max}
        step={step}
      >
        <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          <SliderPrimitive.Range className="absolute h-full bg-primary-500" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block h-6 w-6 rounded-full border-2 border-primary-500 bg-white shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:bg-gray-800 dark:focus-visible:ring-offset-gray-900" />
      </SliderPrimitive.Root>
      <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}
