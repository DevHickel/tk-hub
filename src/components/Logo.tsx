import { cn } from '@/lib/utils';
import tkLogo from '@/assets/tk-logo.png';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
}

export function Logo({ size = 'md', showText = false, className }: LogoProps) {
  const sizeClasses = {
    sm: 'h-8',
    md: 'h-12',
    lg: 'h-16',
  };

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <img 
        src={tkLogo} 
        alt="TK Solution" 
        className={cn('object-contain', sizeClasses[size])}
      />
      {showText && (
        <span className="font-semibold text-foreground">
          TK Solution
        </span>
      )}
    </div>
  );
}
