import { Apple, Droplets, Gamepad2, GlassWater, Heart, Milk } from 'lucide-react';
import { useBaby } from '../contexts/BabyContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from './ui';
import { api } from '../lib/api';
import { babyAgeMonths } from '../lib/baby-age';
import { getRecentNames, getRecordDefaults } from '../lib/record-defaults';
import {
  diaperLabel,
  invalidateRecordCaches,
  quickActionsForAge,
  quickBottle,
  quickBreastfeed,
  quickDiaper,
  quickSolid,
  quickWater,
  startOngoing,
  type DiaperKind,
  type QuickActionId,
} from '../lib/quick-record';

export function QuickRecordBar({
  onCreated,
  ongoingTypes = [],
}: {
  onCreated?: () => void;
  ongoingTypes?: string[];
}) {
  const { currentBaby } = useBaby();
  const { isViewer } = useAuth();
  const { toast } = useToast();
  const months = babyAgeMonths(currentBaby?.birthDate);
  const bottleMl = getRecordDefaults().bottle?.amountMl ?? 120;
  const waterMl = getRecordDefaults().water?.amountMl ?? 30;
  const bf = getRecordDefaults().breastfeed;
  const solidName = getRecentNames('solid')[0];

  if (isViewer || !currentBaby) return null;

  const run = async (label: string, fn: () => Promise<{ id: string }>) => {
    try {
      const rec = await fn();
      toast(label, 'success', {
        action: {
          label: '撤销',
          onClick: async () => {
            try {
              await api.recordsCrud.delete(rec.id);
              invalidateRecordCaches();
              onCreated?.();
            } catch { /* ignore */ }
          },
        },
      });
      onCreated?.();
    } catch {
      toast('记录失败', 'error');
    }
  };

  const catalog: Record<QuickActionId, { label: string; icon: typeof Droplets; onClick: () => void }> = {
    wet: {
      label: '尿',
      icon: Droplets,
      onClick: () => run('已记小便', () => quickDiaper(currentBaby.id, 'wet' as DiaperKind)),
    },
    dirty: {
      label: '便',
      icon: Droplets,
      onClick: () => run('已记大便', () => quickDiaper(currentBaby.id, 'dirty')),
    },
    both: {
      label: '尿+便',
      icon: Droplets,
      onClick: () => run(`已记${diaperLabel('both')}`, () => quickDiaper(currentBaby.id, 'both')),
    },
    bottle: {
      label: `瓶喂 ${bottleMl}ml`,
      icon: Milk,
      onClick: () => run(`已记瓶喂 ${bottleMl}ml`, () => quickBottle(currentBaby.id)),
    },
    breastfeed: {
      label: bf ? `母乳 ${bf.leftMinutes + bf.rightMinutes}分` : '母乳',
      icon: Heart,
      onClick: () => run('已记母乳', () => quickBreastfeed(currentBaby.id)),
    },
    water: {
      label: `喝水 ${waterMl}ml`,
      icon: GlassWater,
      onClick: () => run(`已记喝水 ${waterMl}ml`, () => quickWater(currentBaby.id)),
    },
    solid: {
      label: solidName || '辅食',
      icon: Apple,
      onClick: () => run(solidName ? `已记${solidName}` : '已记辅食', () => quickSolid(currentBaby.id)),
    },
    play: {
      label: '玩耍',
      icon: Gamepad2,
      onClick: async () => {
        if (ongoingTypes.includes('play')) {
          toast('玩耍已在进行中', 'info');
          return;
        }
        try {
          await startOngoing(currentBaby.id, 'play');
          toast('玩耍已开始', 'success');
          onCreated?.();
        } catch {
          toast('开始失败', 'error');
        }
      },
    },
  };

  const items = quickActionsForAge(months).map((id) => ({ key: id, ...catalog[id] }));

  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={item.onClick}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full glass-chip text-sm font-medium text-gray-700 dark:text-gray-200 active:scale-95 transition-transform"
        >
          <item.icon size={14} />
          {item.label}
        </button>
      ))}
    </div>
  );
}
