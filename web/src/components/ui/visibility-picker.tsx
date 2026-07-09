import React, { useEffect, useState, useCallback } from 'react';
import { Lock, Unlock, Check } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from './popover';
import { api, Member } from '../../lib/api';
import { cn } from '../../lib/utils';

let membersCache: Member[] | null = null;

interface VisibilityPickerProps {
  value?: string[];
  onChange: (visibleTo: string[] | undefined) => void;
  className?: string;
}

export function VisibilityPicker({ value, onChange, className }: VisibilityPickerProps) {
  const [members, setMembers] = useState<Member[]>(membersCache || []);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (membersCache) {
      setMembers(membersCache);
      return;
    }
    api.members.list().then((res) => {
      membersCache = res.data;
      setMembers(res.data);
    }).catch(() => {});
  }, []);

  const hasRestriction = value && value.length > 0;

  const toggleUser = useCallback((userId: string) => {
    if (!value || value.length === 0) {
      onChange([userId]);
    } else if (value.includes(userId)) {
      const next = value.filter((id) => id !== userId);
      onChange(next.length === 0 ? undefined : next);
    } else {
      onChange([...value, userId]);
    }
  }, [value, onChange]);

  const clearAll = useCallback(() => {
    onChange(undefined);
  }, [onChange]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors',
            hasRestriction
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
              : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
            className
          )}
          title={hasRestriction ? `${value.length}人可见` : '所有人可见'}
        >
          {hasRestriction ? <Lock size={12} /> : <Unlock size={12} />}
          {hasRestriction && <span>{value.length}人可见</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">可见用户</span>
          {hasRestriction && (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-blue-500 hover:text-blue-700"
            >
              清除限制
            </button>
          )}
        </div>
        <div className="max-h-48 space-y-0.5 overflow-y-auto">
          {members.map((m) => {
            const selected = value?.includes(m.id) ?? false;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggleUser(m.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
                  selected
                    ? 'bg-blue-50 dark:bg-blue-900/20'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                )}
              >
                {m.avatar ? (
                  <img src={m.avatar} className="h-6 w-6 rounded-full object-cover" alt="" />
                ) : (
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600 dark:bg-gray-600 dark:text-gray-300">
                    {m.displayName.charAt(0)}
                  </div>
                )}
                <span className="flex-1 truncate">{m.displayName}</span>
                {selected && <Check size={14} className="text-blue-500" />}
              </button>
            );
          })}
        </div>
        {!hasRestriction && (
          <p className="mt-2 text-[11px] text-gray-400">
            不选择则所有人可见
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
