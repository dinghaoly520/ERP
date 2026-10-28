/**
 * 工作印记定义（MVP 5 个，基于已有数据）
 * 每日 cron 计算时按 code 路由到对应计算逻辑。
 */
export const BADGE_DEFINITIONS = [
  {
    code: 'approval_master',
    name: '审批能手',
    category: 'quantity',
    description: '累计审批供应商入库',
    iconKey: 'CheckCircle2',
    unit: '项',
    levelThresholds: { bronze: 50, silver: 200, gold: 500, platinum: 1000 },
  },
  {
    code: 'publish_master',
    name: '发布达人',
    category: 'quantity',
    description: '累计发布采购公告',
    iconKey: 'Megaphone',
    unit: '篇',
    levelThresholds: { bronze: 20, silver: 100, gold: 300, platinum: 800 },
  },
  {
    code: 'project_master',
    name: '项目操盘',
    category: 'quantity',
    description: '累计参与采购项目',
    iconKey: 'FolderKanban',
    unit: '个',
    levelThresholds: { bronze: 10, silver: 30, gold: 80, platinum: 200 },
  },
  {
    code: 'tenure',
    name: '坚守者',
    category: 'tenure',
    description: '在职累计天数',
    iconKey: 'CalendarClock',
    unit: '天',
    levelThresholds: { bronze: 100, silver: 365, gold: 730, platinum: 1825 },
  },
  {
    code: 'no_return',
    name: '零退回',
    category: 'quality',
    description: '连续审批无退回记录',
    iconKey: 'ShieldCheck',
    unit: '次',
    levelThresholds: { bronze: 30, silver: 100, gold: 300, platinum: 800 },
  },
] as const;

export type BadgeLevel = 'bronze' | 'silver' | 'gold' | 'platinum';

export const LEVEL_ORDER: BadgeLevel[] = ['bronze', 'silver', 'gold', 'platinum'];

export const LEVEL_COLOR: Record<BadgeLevel, string> = {
  bronze: 'oklch(0.65 0.1 50)',
  silver: 'oklch(0.78 0.02 270)',
  gold: 'oklch(0.85 0.12 85)',
  platinum: 'oklch(0.92 0.04 270)',
};

/** 给定当前值，返回已解锁的最高等级（未解锁返回 null） */
export function resolveLevel(value: number, thresholds: Record<string, number>): BadgeLevel | null {
  let result: BadgeLevel | null = null;
  for (const level of LEVEL_ORDER) {
    const t = thresholds[level];
    if (t != null && value >= t) result = level;
  }
  return result;
}
