import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog';
import { Button } from './button';
import { useI18n } from '../../contexts/I18nContext';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  loading?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = 'default',
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-600 dark:text-gray-400 pt-1">{description}</p>
        <div className="flex gap-3 pt-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {cancelLabel ?? t('common.cancel')}
          </Button>
          <Button
            className={`flex-1 ${variant === 'danger' ? 'bg-red-500 hover:bg-red-600 text-white' : ''}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? t('common.processing') : (confirmLabel ?? t('common.ok'))}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
