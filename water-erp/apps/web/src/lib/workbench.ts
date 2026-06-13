export const workbenchTheme = {
  primary: '#064ea2',
  primaryBright: '#0b63ce',
  cyan: '#0891b2',
  success: '#11a874',
  warning: '#f5a623',
  danger: '#e74c3c',
  purple: '#7c3aed',
  text: '#18243a',
  muted: '#5a6d8a',
  border: '#e5ecf4',
  surface: '#ffffff',
  page: '#f7fbff',
} as const;

export const statusTone = {
  blue: { color: '#064ea2', bg: '#064ea214', border: '#bfdbfe' },
  green: { color: '#11a874', bg: '#11a87414', border: '#bbf7d0' },
  orange: { color: '#f5a623', bg: '#f5a62316', border: '#fed7aa' },
  red: { color: '#e74c3c', bg: '#e74c3c14', border: '#fecaca' },
  purple: { color: '#7c3aed', bg: '#7c3aed14', border: '#ddd6fe' },
  gray: { color: '#5a6d8a', bg: '#5a6d8a12', border: '#e5ecf4' },
} as const;

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
  return Math.round((part / total) * 100);
}
