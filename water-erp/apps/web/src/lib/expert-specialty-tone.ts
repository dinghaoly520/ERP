/**
 * 专家专业标签配色（2026-11-04 用户裁定：不同专业不同颜色、相同专业恒同色、
 * 色相要丰富——7 色 WorkbenchTone 不够 78 个专业区分，扩为 12 色专业专属色板）。
 *
 * 结构：语义大类锚定（相近专业聚邻近色）+ 稳定哈希兜底（同专业恒同色）。
 * 色板避开正红（状态语义专用）；样式结构与 StatusBadge 同构（浅底+深字+描边）。
 * SpecialtyBadge 为统一渲染组件——专家库/排名/退库三页共用，勿各自内联。
 */

export type SpecialtySwatch = { color: string; bg: string; border: string };

/** 12 色专业色板（色环均匀、饱和度收敛，浅底深字在表格中不喧宾） */
const PALETTE: SpecialtySwatch[] = [
  { color: '#064ea2', bg: '#eff6ff', border: '#bfdbfe' }, // 1 蓝
  { color: '#0891b2', bg: '#ecfeff', border: '#a5f3fc' }, // 2 青
  { color: '#0d9488', bg: '#f0fdfa', border: '#99f6e4' }, // 3 水鸭
  { color: '#11a874', bg: '#f0fdf4', border: '#bbf7d0' }, // 4 绿
  { color: '#65a30d', bg: '#f7fee7', border: '#d9f99d' }, // 5 黄绿
  { color: '#b45309', bg: '#fffbeb', border: '#fde68a' }, // 6 琥珀
  { color: '#ea580c', bg: '#fff7ed', border: '#fed7aa' }, // 7 橙
  { color: '#be185d', bg: '#fdf2f8', border: '#fbcfe8' }, // 8 玫红
  { color: '#9333ea', bg: '#faf5ff', border: '#e9d5ff' }, // 9 紫
  { color: '#4f46e5', bg: '#eef2ff', border: '#c7d2fe' }, // 10 靛
  { color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' }, // 11 亮蓝
  { color: '#5a6d8a', bg: '#f8fafc', border: '#e5ecf4' }, // 12 蓝灰
];

/** 大类关键词 → 色板锚点（相近专业聚邻近色；次序即优先级） */
const CATEGORY_RULES: Array<{ anchor: number; keywords: string[] }> = [
  // 水利/水电/水文 → 蓝（1）
  { anchor: 0, keywords: ['水利', '水电', '水文', '灌区', '河道', '枢纽'] },
  // 地质/勘察/测绘 → 青（2）
  { anchor: 1, keywords: ['地质', '勘察', '测绘', '钻探', '岩土', '遥感'] },
  // 环境/水土保持 → 水鸭（3）
  { anchor: 2, keywords: ['环境', '生态', '环保', '水土保持'] },
  // 建筑/土木/规划 → 绿（4）
  { anchor: 3, keywords: ['建筑', '结构', '土木', '规划', '市政', '路桥', '交通'] },
  // 农林/生物 → 黄绿（5）
  { anchor: 4, keywords: ['农', '林', '生物', '园艺'] },
  // 机电/设备 → 琥珀（6）
  { anchor: 5, keywords: ['机电', '机械', '设备', '材料', '物资', '电气'] },
  // 信息化 → 橙（7）
  { anchor: 6, keywords: ['信息', '计算机', '软件', '通信', '自动化', '智能化', '数字', '电子'] },
  // 文化/教育 → 玫红（8）
  { anchor: 7, keywords: ['教育', '文', '新闻', '传播', '艺术', '体育'] },
  // 法律/档案 → 紫（9）
  { anchor: 8, keywords: ['法律', '档案', '图书馆', '纪检', '监察'] },
  // 财务/经济 → 靛（10）
  { anchor: 9, keywords: ['会计', '财务', '审计', '税', '金融', '经济', '造价', '咨询'] },
  // 医疗/卫生 → 亮蓝（11）
  { anchor: 10, keywords: ['医', '卫生', '药', '护理'] },
];

/** 同专业恒同色：大类命中用锚点；未命中稳定哈希（关键词细分度只到锚点，
 *  同大类下不同专业再按名哈希偏移取色——既聚色系又减撞色） */
export function specialtySwatch(specialty: string): SpecialtySwatch {
  const s = specialty.trim();
  let anchor = -1;
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((k) => s.includes(k))) { anchor = rule.anchor; break; }
  }
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  const h = Math.abs(hash);
  if (anchor < 0) return PALETTE[h % PALETTE.length];
  // 大类内偏移：锚点色 ±2 格（邻近色系内取三选一，同专业恒定）
  const offset = h % 3; // 0,1,2
  const idx = (anchor + (offset === 0 ? 0 : offset === 1 ? 1 : PALETTE.length - 1)) % PALETTE.length;
  return PALETTE[idx];
}
