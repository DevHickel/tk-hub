import { cn } from '@/lib/utils';
import tkLogo from '@/assets/tk-logo-new.png';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
}

export function Logo({ size = 'md', showText = false, className }: LogoProps) {
  const sizeClasses = {
    sm: 'h-10',
    md: 'h-16',
    lg: 'h-20',
  };

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <img 
        src={tkLogo} 
        alt="TK Solution" 
        className={cn(
          'object-contain',
          sizeClasses[size],
          'dark:invert dark:brightness-0 dark:invert',
          'brightness-0'
        )}
      />
      {showText && (
        <span className="font-semibold text-foreground">
          TK Solution
        </span>
      )}
    </div>
  );
}
