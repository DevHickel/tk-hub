import { cn } from '@/lib/utils';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
}

export function Logo({ size = 'md', showText = true, className }: LogoProps) {
  const sizeClasses = {
    sm: 'h-8 w-8',
    md: 'h-12 w-12',
    lg: 'h-16 w-16',
  };

  const textSizeClasses = {
    sm: 'text-lg',
    md: 'text-2xl',
    lg: 'text-3xl',
  };

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className={cn(
        'flex items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold',
        sizeClasses[size],
        size === 'sm' ? 'text-sm' : size === 'md' ? 'text-lg' : 'text-xl'
      )}>
        TK
      </div>
      {showText && (
        <span className={cn('font-semibold', textSizeClasses[size])}>
          TK Solution
        </span>
      )}
    </div>
  );
}
