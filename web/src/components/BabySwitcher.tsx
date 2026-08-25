import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useBaby } from '../contexts/BabyContext';
import { formatBabyAge } from '../lib/baby-age';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui';

interface BabySwitcherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditCurrent?: () => void;
}

export function BabySwitcher({ open, onOpenChange, onEditCurrent }: BabySwitcherProps) {
  const { babies, currentBaby, setCurrentBaby } = useBaby();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>选择宝宝</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 pt-1">
          {babies.map((b) => {
            const active = currentBaby?.id === b.id;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  setCurrentBaby(b);
                  onOpenChange(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                  active ? 'bg-primary-50 dark:bg-primary-900/30' : 'hover:bg-white/50 dark:hover:bg-white/[0.06]'
                }`}
              >
                {b.avatar ? (
                  <img src={b.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <span className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-600 text-sm font-medium flex items-center justify-center">
                    {b.name.slice(0, 1)}
                  </span>
                )}
                <span className="flex-1 min-w-0">
                  <span className="block font-medium dark:text-gray-100 truncate">{b.name}</span>
                  <span className="block text-xs text-gray-400">{formatBabyAge(b.birthDate)}</span>
                </span>
                {active && <span className="text-xs text-primary-500">当前</span>}
              </button>
            );
          })}
          <div className="flex gap-2 pt-2">
            {currentBaby && onEditCurrent && (
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onEditCurrent();
                }}
                className="flex-1 text-sm py-2 rounded-lg glass-chip text-gray-600 dark:text-gray-300"
              >
                编辑资料
              </button>
            )}
            <Link
              to="/baby/setup"
              onClick={() => onOpenChange(false)}
              className="flex-1 inline-flex items-center justify-center gap-1 text-sm py-2 rounded-lg glass-chip text-primary-600 dark:text-primary-400"
            >
              <Plus size={14} /> 添加宝宝
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
