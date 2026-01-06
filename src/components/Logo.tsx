import { cn } from '@/lib/utils';
import { useTheme } from '@/contexts/ThemeContext';
import tkLogoDark from '@/assets/tk-logo-dark.png';
import tkLogoLight from '@/assets/tk-logo-light.png';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
}

export function Logo({ size = 'md', showText = false, className }: LogoProps) {
  const { theme } = useTheme();
  
  const sizeClasses = {
    sm: 'h-10',
    md: 'h-16',
    lg: 'h-20',
  };

  // Logo preta para modo claro, logo branca para modo escuro
  const logoSrc = theme === 'dark' ? tkLogoLight : tkLogoDark;

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <img 
        src={logoSrc} 
        alt="TK Solution" 
        className={cn(
          'object-contain transition-all duration-300',
          sizeClasses[size]
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
