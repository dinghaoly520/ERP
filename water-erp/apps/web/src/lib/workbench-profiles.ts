/**
 * 工作台个性化配置（单一数据源）。
 *
 * 三个种子账号的业务差异集中在此处，替代散落各处的用户名硬编码：
 * - SWDG-01（四川省水利发展集团有限公司）：落地 /tender-write + 导航仅招标文档相关项
 * - Swhi-CGZX-00（董事长）：/work-arrangements 董事长变体 + 受限导航 + 专属称呼
 * - Swhi-CGZX-admin（管理员）：密码审批等管理功能提示文案引用
 *
 * 账号本身见 `apps/api/prisma/seed-data/User.json` 与根目录 CLAUDE.md 种子账号表。
 */

export interface WorkbenchProfile {
  username: string;
  /** 登录后落地页（覆盖角色默认落地） */
  landingPath?: string;
  /** 侧边栏导航白名单（缺省 = 按角色正常展示） */
  navKeys?: readonly string[];
  /** 董事长工作台变体（/work-arrangements 路由分流 + 称呼） */
  chairman?: boolean;
  greetingName?: string;
}

export const WORKBENCH_PROFILES: readonly WorkbenchProfile[] = [
  { username: 'SWDG-01', landingPath: '/tender-write', navKeys: ['tender-write', 'tender-review'] },
  {
    username: 'Swhi-CGZX-00',
    chairman: true,
    greetingName: '张宏董事长',
    navKeys: ['work-arrangements', 'dashboard', 'progress', 'procurements', 'projects'],
  },
];

/** 密码审批等管理功能提示用的管理员账号（种子 admin） */
export const ADMIN_USERNAME = 'Swhi-CGZX-admin';

export function getWorkbenchProfile(username?: string | null): WorkbenchProfile | undefined {
  return WORKBENCH_PROFILES.find((p) => p.username === username);
}
