import type { ReactNode } from 'react';
import { cn } from './utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IconLike = any;

interface PageHeroProps {
  eyebrow?: string;
  title: string;
  description?: string;
  tone?: 'blue' | 'cyan' | 'green' | 'orange' | 'red' | 'purple' | 'gray';
  icon?: IconLike;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

const toneClass = {
  blue: 'border-[#bfdbfe] bg-[#eff6ff] text-[#064ea2]',
  cyan: 'border-[#a5f3fc] bg-[#ecfeff] text-[#0891b2]',
  green: 'border-[#bbf7d0] bg-[#f0fdf4] text-[#11a874]',
  orange: 'border-[#fed7aa] bg-[#fff7ed] text-[#f5a623]',
  red: 'border-[#fecaca] bg-[#fef2f2] text-[#e74c3c]',
  purple: 'border-[#ddd6fe] bg-[#f5f3ff] text-[#7c3aed]',
  gray: 'border-[#e5ecf4] bg-[#f8fafc] text-[#5a6d8a]',
};

export function PageHero({ eyebrow, title, description, tone = 'blue', icon, actions, children, className }: PageHeroProps) {
  const heroGradient: Record<string, string> = {
    blue:   'linear-gradient(135deg, rgba(239,246,255,0.90), rgba(248,251,255,0.86))',
    cyan:   'linear-gradient(135deg, rgba(236,254,255,0.90), rgba(245,253,255,0.86))',
    green:  'linear-gradient(135deg, rgba(240,253,244,0.90), rgba(248,252,249,0.86))',
    orange: 'linear-gradient(135deg, rgba(255,247,237,0.90), rgba(254,251,246,0.86))',
    red:    'linear-gradient(135deg, rgba(254,242,242,0.90), rgba(253,247,247,0.86))',
    purple: 'linear-gradient(135deg, rgba(245,243,255,0.90), rgba(250,249,254,0.86))',
    gray:   'linear-gradient(135deg, rgba(248,250,252,0.90), rgba(250,251,252,0.86))',
  };

  const orbColors: Record<string, { left: string; right: string }> = {
    blue:   { left: 'rgba(147,197,253,0.18)', right: 'rgba(196,181,253,0.14)' },
    cyan:   { left: 'rgba(34,211,238,0.16)', right: 'rgba(167,243,252,0.14)' },
    green:  { left: 'rgba(110,231,183,0.16)', right: 'rgba(52,211,153,0.14)' },
    orange: { left: 'rgba(252,211,77,0.18)',  right: 'rgba(251,191,36,0.14)' },
    red:    { left: 'rgba(253,164,175,0.16)', right: 'rgba(251,113,133,0.12)' },
    purple: { left: 'rgba(196,167,250,0.18)', right: 'rgba(168,139,250,0.14)' },
    gray:   { left: 'rgba(148,163,184,0.10)', right: 'rgba(203,213,225,0.08)' },
  };

  const orb = orbColors[tone] || orbColors.blue;

  return (
    <section
      className={cn('relative rounded-[24px] p-6', className)}
      style={{
        background: heroGradient[tone] || heroGradient.blue,
        backdropFilter: 'blur(24px) saturate(1.15)',
        WebkitBackdropFilter: 'blur(24px) saturate(1.15)',
        border: '1px solid rgba(255,255,255,0.55)',
        boxShadow: '0 1px 2px rgba(15,35,65,0.02), 0 4px 16px rgba(91,155,213,0.04)',
      }}
    >
      {/* 磨砂彩光 + 光晕球 — 独立裁剪容器，不干扰 backdrop-filter 层 */}
      <div className="absolute inset-0 overflow-hidden rounded-[24px] pointer-events-none">
        <div className="absolute inset-0 opacity-[0.45] animate-[glass-glow-drift_20s_ease-in-out_infinite]"
          style={{
            background: [
              `radial-gradient(ellipse at 15% 10%, ${orb.left}, transparent 58%)`,
              `radial-gradient(ellipse at 85% 90%, ${orb.right}, transparent 52%)`,
              'radial-gradient(ellipse at 50% 50%, rgba(180,200,240,0.08), transparent 65%)',
            ].join(', '),
          }} />
        <div className="absolute -top-16 -left-16 h-[200px] w-[200px] rounded-full opacity-25 animate-[glass-glow-drift_22s_ease-in-out_infinite]"
          style={{ background: `radial-gradient(circle, ${orb.left}, transparent 70%)`, filter: 'blur(40px)' }} />
        <div className="absolute -bottom-12 -right-12 h-[170px] w-[170px] rounded-full opacity-20 animate-[glass-glow-drift-reverse_24s_ease-in-out_infinite]"
          style={{ background: `radial-gradient(circle, ${orb.right}, transparent 70%)`, filter: 'blur(36px)' }} />
      </div>

      <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <div className={cn('mb-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold', toneClass[tone])}>
              {icon}
              {eyebrow}
            </div>
          )}
          <h1 className="text-2xl font-black tracking-tight text-[#0f2f57]">{title}</h1>
          {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-[#5a6d8a]">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="relative z-10 mt-5">{children}</div>}
    </section>
  );
}
