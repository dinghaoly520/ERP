/** 品牌蓝系配色（与后端 PALETTE 一致） */
export const CHART_PALETTE = [
  '#2563EB', '#0891b2', '#7dd3fc', '#0d9488', '#6366f1',
  '#3b82f6', '#06b6d4', '#818cf8',
];

/** 全局基础配置 —— 与后端 option 合并 */
export const BASE_OPTION = {
  textStyle: {
    fontFamily:
      '"PingFang SC", "Microsoft YaHei", "Heiti SC", "Noto Sans CJK SC", sans-serif',
  },
  tooltip: {
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderColor: 'rgba(201,217,239,0.6)',
    borderWidth: 1,
    textStyle: { color: '#1a2332', fontSize: 12 },
    extraCssText:
      'box-shadow: 0 4px 16px rgba(19,36,62,0.1); border-radius: 8px;',
  },
  color: CHART_PALETTE,
};
