/**
 * 上传进度格式化（2026-11-06 上传进度条）：1024 进制字节数与速度，等宽数字口径。
 */

/** 字节数 → 「12.4 MB」；<100 且非整 KB 内保留一位小数，≥100 或 B 级取整 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** 速度 B/s → 「3.2 MB/s」；空/非正返回空串（速度窗未满不显示） */
export function formatSpeed(bps: number | null): string {
  return bps && bps > 0 ? `${formatBytes(bps)}/s` : '';
}
