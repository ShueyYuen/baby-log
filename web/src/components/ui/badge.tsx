import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-primary-100/60 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300 backdrop-blur-sm',
        secondary: 'bg-white/40 text-gray-700 dark:bg-white/[0.08] dark:text-gray-300 backdrop-blur-sm',
        success: 'bg-green-100/60 text-green-700 dark:bg-green-900/40 dark:text-green-300 backdrop-blur-sm',
        warning: 'bg-yellow-100/60 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300 backdrop-blur-sm',
        danger: 'bg-red-100/60 text-red-700 dark:bg-red-900/40 dark:text-red-300 backdrop-blur-sm',
        info: 'bg-blue-100/60 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 backdrop-blur-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
