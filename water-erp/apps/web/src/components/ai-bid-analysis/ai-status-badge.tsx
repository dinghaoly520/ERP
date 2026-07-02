import type { ReactNode } from 'react';
import { CheckCircle, MinusCircle } from 'lucide-react';

export type AiStatusBadgeTone =
  | 'default'
  | 'info'
  | 'ready'
  | 'warning'
  | 'danger'
  | 'processing'
  | 'green'
  | 'amber'
  | 'red'
  | 'blue';

interface AiStatusBadgeProps {
  children?: ReactNode;
  label?: string;
  tone?: AiStatusBadgeTone;
  pulse?: boolean;
}

const toneClasses: Record<AiStatusBadgeTone, string> = {
  default: 'bg-slate-100 text-slate-700',
  info: 'bg-blue-100 text-blue-700',
  ready: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-rose-100 text-rose-700',
  processing: 'bg-sky-100 text-sky-700',
  green: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-rose-100 text-rose-700',
  blue: 'bg-blue-100 text-blue-700',
};

export default function AiStatusBadge({
  children,
  label,
  tone = 'default',
  pulse = false,
}: AiStatusBadgeProps) {
  const Icon = tone === 'green' || tone === 'ready' ? CheckCircle : MinusCircle;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${toneClasses[tone]} ${pulse ? 'animate-pulse' : ''}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {children ?? label}
    </span>
  );
}
