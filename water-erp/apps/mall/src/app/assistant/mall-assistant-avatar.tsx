import type { MallAssistantExpression } from './types';

const imageByExpression: Record<MallAssistantExpression, string> = {
  normal: 'normal',
  thinking: 'thinking',
  serious: 'serious',
};

interface MallAssistantAvatarProps {
  expression?: MallAssistantExpression;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses: Record<NonNullable<MallAssistantAvatarProps['size']>, string> = {
  sm: 'h-9 w-9',
  md: 'h-14 w-14',
  lg: 'h-20 w-20',
};

export function MallAssistantAvatar({ expression = 'normal', size = 'md', className = '' }: MallAssistantAvatarProps) {
  const src = `/DingDang/${imageByExpression[expression]}_${size}.webp`;

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full bg-[radial-gradient(circle_at_35%_25%,rgba(232,244,255,.98),rgba(120,184,255,.78)_48%,rgba(54,116,214,.70))] p-1 shadow-[0_10px_26px_rgba(6,78,162,.18)] ring-1 ring-white/70 ${sizeClasses[size]} ${className}`}
    >
      <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_28%_18%,rgba(255,255,255,.75),transparent_34%)]" />
      <img src={src} alt="水叮当" className="relative h-full w-full rounded-full object-contain" />
    </span>
  );
}
