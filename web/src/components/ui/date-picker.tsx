import dayjs from 'dayjs';
import { CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import * as React from 'react';
import { DayPicker } from 'react-day-picker';
import { enUS, zhCN } from 'react-day-picker/locale';
import { useI18n } from '../../contexts/I18nContext';
import { cn } from '../../lib/utils';
import { Button } from './button';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { TimePicker } from './time-picker';

const calendarClassNames = {
  months: 'flex flex-col space-y-4',
  month: 'space-y-4',
  month_caption: 'flex items-center',
  caption_label: 'text-sm font-medium dark:text-gray-100',
  nav: 'hidden',
  button_previous: 'h-7 w-7 bg-transparent p-0 glass-icon-btn inline-flex items-center justify-center rounded-md text-gray-600 dark:text-gray-300',
  button_next: 'h-7 w-7 bg-transparent p-0 glass-icon-btn inline-flex items-center justify-center rounded-md text-gray-600 dark:text-gray-300',
  month_grid: 'w-full border-collapse space-y-1',
  weekdays: 'flex',
  weekday: 'text-gray-500 dark:text-gray-400 rounded-md w-9 font-normal text-[0.8rem]',
  week: 'flex w-full mt-2',
  day: 'h-9 w-9 text-center text-sm p-0 relative rounded-md',
  day_button: 'h-9 w-9 p-0 font-normal rounded-md glass-icon-btn dark:text-gray-200 inline-flex items-center justify-center',
  selected: 'bg-primary-500 text-white hover:bg-primary-600 hover:text-white focus:bg-primary-600 focus:text-white dark:bg-primary-500 dark:text-white dark:hover:bg-primary-600',
  today: 'glass-info-strip font-semibold',
  outside: 'text-gray-300 dark:text-gray-600',
  disabled: 'text-gray-300 dark:text-gray-600 opacity-50',
};

function CustomMonth({ calendarMonth, displayIndex, children, ...props }: any) {
  const childArray = React.Children.toArray(children);
  return (
    <div {...props}>
      <div className="flex justify-center items-center gap-1">
        {childArray[0]}
        {childArray[1]}
        {childArray[2]}
      </div>
      {childArray.slice(3)}
    </div>
  );
}

interface DatePickerProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function DatePicker({ value, onChange, placeholder, className }: DatePickerProps) {
  const { t, locale } = useI18n();
  const [open, setOpen] = React.useState(false);
  const selected = value ? new Date(value) : undefined;

  const handleSelect = (date: Date | undefined) => {
    if (date && onChange) {
      onChange(dayjs(date).format('YYYY-MM-DD'));
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'w-full justify-start text-left font-normal',
            !value && 'text-gray-400 dark:text-gray-500',
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {value ? dayjs(value).format(t('dateFmt.ymdPad')) : (placeholder ?? t('datePicker.pickDate'))}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <DayPicker
          mode="single"
          navLayout="around"
          selected={selected}
          onSelect={handleSelect}
          locale={locale === 'zh' ? zhCN : enUS}
          className="p-3"
          classNames={calendarClassNames}
          components={{
            Month: CustomMonth,
            Chevron: ({ orientation }) =>
              orientation === 'left' ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />,
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

interface DateTimePickerProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function DateTimePicker({ value, onChange, placeholder, className }: DateTimePickerProps) {
  const { t, locale } = useI18n();
  const [open, setOpen] = React.useState(false);
  const dateValue = value ? value.slice(0, 10) : '';
  const timeValue = value ? value.slice(11, 16) : dayjs().format('HH:mm');

  const selected = dateValue ? new Date(dateValue) : undefined;

  const handleDateSelect = (date: Date | undefined) => {
    if (date && onChange) {
      const d = dayjs(date).format('YYYY-MM-DD');
      onChange(`${d}T${timeValue}`);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'w-full justify-start text-left font-normal',
            !value && 'text-gray-400 dark:text-gray-500',
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {value ? dayjs(value).format(t('dateFmt.ymdhm')) : (placeholder ?? t('datePicker.pickDateTime'))}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <DayPicker
          mode="single"
          navLayout="around"
          selected={selected}
          onSelect={handleDateSelect}
          locale={locale === 'zh' ? zhCN : enUS}
          className="p-3"
          classNames={calendarClassNames}
          components={{
            Month: CustomMonth,
            Chevron: ({ orientation }) =>
              orientation === 'left' ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />,
          }}
        />
        <div className="border-t border-white/30 dark:border-white/[0.06] px-3 py-3">
          <TimePicker
            value={timeValue}
            onChange={(newTime) => {
              if (onChange) {
                const d = dateValue || dayjs().format('YYYY-MM-DD');
                onChange(`${d}T${newTime}`);
              }
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
