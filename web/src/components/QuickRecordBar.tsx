import { Apple, Droplets, Gamepad2, GlassWater, Heart, Milk } from 'lucide-react';
import { useBaby } from '../contexts/BabyContext';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
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
  const { t } = useI18n();
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
          label: t('common.undo'),
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
      toast(t('quick.recordFailed'), 'error');
    }
  };

  const catalog: Record<QuickActionId, { label: string; icon: typeof Droplets; onClick: () => void }> = {
    wet: {
      label: t('diaper.wet'),
      icon: Droplets,
      onClick: () => run(t('quick.loggedWet'), () => quickDiaper(currentBaby.id, 'wet' as DiaperKind)),
    },
    dirty: {
      label: t('diaper.dirty'),
      icon: Droplets,
      onClick: () => run(t('quick.loggedDirty'), () => quickDiaper(currentBaby.id, 'dirty')),
    },
    both: {
      label: t('diaper.both'),
      icon: Droplets,
      onClick: () => run(t('quick.loggedBoth', { label: diaperLabel('both', t) }), () => quickDiaper(currentBaby.id, 'both')),
    },
    bottle: {
      label: t('quick.bottleLabel', { ml: bottleMl }),
      icon: Milk,
      onClick: () => run(t('quick.loggedBottle', { ml: bottleMl }), () => quickBottle(currentBaby.id)),
    },
    breastfeed: {
      label: bf ? t('quick.breastfeedWithMin', { n: bf.leftMinutes + bf.rightMinutes }) : t('recordTypes.breastfeed'),
      icon: Heart,
      onClick: () => run(t('quick.loggedBreastfeed'), () => quickBreastfeed(currentBaby.id)),
    },
    water: {
      label: t('quick.waterLabel', { ml: waterMl }),
      icon: GlassWater,
      onClick: () => run(t('quick.loggedWater', { ml: waterMl }), () => quickWater(currentBaby.id)),
    },
    solid: {
      label: solidName || t('quick.defaultSolid'),
      icon: Apple,
      onClick: () => run(
        solidName ? t('quick.loggedSolidNamed', { name: solidName }) : t('quick.loggedSolid'),
        () => quickSolid(currentBaby.id, t('quick.defaultSolid')),
      ),
    },
    play: {
      label: t('recordTypes.play'),
      icon: Gamepad2,
      onClick: async () => {
        if (ongoingTypes.includes('play')) {
          toast(t('quick.playOngoing'), 'info');
          return;
        }
        try {
          await startOngoing(currentBaby.id, 'play');
          toast(t('quick.playStarted'), 'success');
          onCreated?.();
        } catch {
          toast(t('quick.startFailed'), 'error');
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
