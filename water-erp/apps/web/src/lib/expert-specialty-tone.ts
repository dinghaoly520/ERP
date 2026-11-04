/**
 * 专家专业标签配色（2026-11-04 用户三次修正：色相要足够多、重复要少）。
 *
 * 24 档色环动态生成（HSL 每 15° 一档，浅底+深字+描边三段同 hue 模板）——
 * 78 个专业平均每档仅 3 个，重复率大幅下降；分配 = 专业名稳定哈希量化到
 * 色环档位，同专业恒同色、跨页面跨时刻确定。不再做语义大类聚色
 * （用户观感即"聚色=重复"），纯哈希均匀散布最直观。
 * 唯一约束：避开 0°±15°（正红系）——状态列（已退库）的语义色专用。
 */

export type SpecialtySwatch = { color: string; bg: string; border: string };

const STEPS = 24; // 色环档数（360/24 = 15° 一档）
const SKIP_HUES = new Set([0, 345]); // 跳过正红两侧档位（状态色专用）

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h} ${s}% ${l}%)`;
}

function swatchOf(hue: number): SpecialtySwatch {
  return {
    color: hsl(hue, 62, 32),   // 深字
    bg: hsl(hue, 82, 96),      // 浅底
    border: hsl(hue, 70, 85),  // 描边
  };
}

/** 专业名 → 色样（稳定哈希；同专业恒同色） */
export function specialtySwatch(specialty: string): SpecialtySwatch {
  const s = specialty.trim();
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  const h = Math.abs(hash);
  let step = h % STEPS;
  if (SKIP_HUES.has(step * 15)) step = (step + 1) % STEPS; // 红系顺延一档
  return swatchOf(step * 15);
}
