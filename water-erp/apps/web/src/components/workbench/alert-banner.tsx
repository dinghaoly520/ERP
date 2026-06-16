import { AlertTriangle } from 'lucide-react';

export type AlertSeverity = 'red' | 'orange' | 'orange-light' | 'gray';

const STYLE: Record<AlertSeverity, { border: string; bg: string; color: string }> = {
  red:           { border: '#fecaca', bg: '#fef2f2', color: '#e74c3c' },
  orange:        { border: '#fed7aa', bg: '#fff7ed', color: '#d97706' },
  'orange-light': { border: '#fde68a', bg: '#fffbeb', color: '#b45309' },
  gray:          { border: '#e5ecf4', bg: '#f8fafc', color: '#5a6d8a' },
};

const ORDER: AlertSeverity[] = ['red', 'orange', 'orange-light', 'gray'];

export function AlertBanner({ items }: { items: { severity: AlertSeverity; title: string; detail?: string }[] }) {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
  return (
    <div className="space-y-2">
      {sorted.map((a, i) => {
        const s = STYLE[a.severity];
        return (
          <div key={i} className="flex items-start gap-2.5 rounded-xl border px-4 py-3" style={{ borderColor: s.border, backgroundColor: s.bg }}>
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" style={{ color: s.color }} />
            <div className="min-w-0">
              <div className="text-sm font-bold" style={{ color: s.color }}>{a.title}</div>
              {a.detail && <div className="mt-0.5 text-xs text-[#5a6d8a]">{a.detail}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
