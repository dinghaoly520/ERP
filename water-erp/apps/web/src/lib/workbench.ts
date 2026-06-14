export const workbenchTheme = {
  primary: '#064ea2',
  primaryBright: '#0b63ce',
  primarySoft: '#eff6ff',
  cyan: '#0891b2',
  cyanSoft: '#ecfeff',
  success: '#11a874',
  successSoft: '#f0fdf4',
  warning: '#f5a623',
  warningSoft: '#fff7ed',
  danger: '#e74c3c',
  dangerSoft: '#fef2f2',
  purple: '#7c3aed',
  purpleSoft: '#f5f3ff',
  text: '#18243a',
  heading: '#0f2f57',
  muted: '#5a6d8a',
  faint: '#8a96aa',
  border: '#e5ecf4',
  borderStrong: '#cfe0f5',
  surface: '#ffffff',
  page: '#f7fbff',
} as const;

export type WorkbenchTone = 'blue' | 'cyan' | 'green' | 'orange' | 'red' | 'purple' | 'gray';

export const statusTone: Record<WorkbenchTone, { color: string; bg: string; border: string; gradient: string }> = {
  blue: { color: '#064ea2', bg: '#eff6ff', border: '#bfdbfe', gradient: 'from-[#064ea2] to-[#0b63ce]' },
  cyan: { color: '#0891b2', bg: '#ecfeff', border: '#a5f3fc', gradient: 'from-[#0891b2] to-[#06b6d4]' },
  green: { color: '#11a874', bg: '#f0fdf4', border: '#bbf7d0', gradient: 'from-[#0f9f6e] to-[#22c55e]' },
  orange: { color: '#f5a623', bg: '#fff7ed', border: '#fed7aa', gradient: 'from-[#f59e0b] to-[#fb923c]' },
  red: { color: '#e74c3c', bg: '#fef2f2', border: '#fecaca', gradient: 'from-[#dc2626] to-[#f97316]' },
  purple: { color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', gradient: 'from-[#7c3aed] to-[#a78bfa]' },
  gray: { color: '#5a6d8a', bg: '#f8fafc', border: '#e5ecf4', gradient: 'from-[#64748b] to-[#94a3b8]' },
};

export function numberOrZero(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function formatDateTime(value?: string | Date | null): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(value?: string | Date | null): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('zh-CN');
}

export function percent(part: number, total: number): number {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((part / total) * 100)));
}

export function completionTone(value: number): WorkbenchTone {
  if (value >= 80) return 'green';
  if (value >= 50) return 'cyan';
  if (value > 0) return 'orange';
  return 'gray';
}
