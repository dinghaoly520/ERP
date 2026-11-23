/**
 * 比例条统一色彩设计（2026-11-23 用户裁定：所有比例条增色）
 *
 * ① 列表型比例条（部门分布/供应商/专家/节资榜）按行序八色循环，与环形图 DONUT_COLORS 同族；
 * ② 节资榜专用循环：前三位与徽章同色（绿/金/蓝），其后接八色循环——榜首行徽章与条同色；
 * ③ 条体统一叠「基端提亮 → 本色」高光渐变：同一元素双背景层（高光层 + 语义色），
 *    不经 color-mix 混 transparent（oklch 插值丢色相、Chrome 显粉红——memory colormix-var-hue-loss-pink）。
 *    单指标图（规模六档/阶段/评价等级/公司对比维度）保留语义色，只叠高光。
 */

/** 列表型比例条八色循环 */
export const BAR_COLORS = [
  "var(--accent)",
  "var(--gold)",
  "oklch(0.55 0.14 285)",
  "oklch(0.55 0.11 168)",
  "var(--warning)",
  "oklch(0.55 0.1 228)",
  "oklch(0.58 0.14 25)",
  "oklch(0.6 0.12 188)",
];

/** 节资榜（公司排行/部门排行）专用：前三与徽章同色（绿/金/蓝），其后接循环 */
export const SAVINGS_BAR_COLORS = ["var(--success)", "var(--gold)", "var(--accent)", ...BAR_COLORS.slice(2)];

/** 行序取色（越界循环） */
export const barColorAt = (i: number, palette: readonly string[] = BAR_COLORS) => palette[i % palette.length];

/** 条体填充：高光渐变叠在语义色上——基端 38% 提亮，至 55% 处淡出为本色 */
export const barFill = (color: string) =>
  `linear-gradient(90deg, oklch(1 0 0 / 0.38), oklch(1 0 0 / 0) 55%), ${color}`;
