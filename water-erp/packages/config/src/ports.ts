/** 应用端口映射 — 所有应用的端口单一来源 */
export const PORTS = {
  api: 4001,
  public: 3002,   // 信息门户 — 前端入口，公告/政策
  mall: 3003,      // 采购商城
  supplier: 3004,  // 供应商门户
  supplierNext: 3020, // 供应商门户 Next.js 迁移版（supplier-portal-next，迁移期与 :3004 并行）
  web: 3005,       // 统一采购管理工作台（合并 procurement 采购中心 + ERP 管理端）
  expert: 3006,    // 专家门户
  bid: 3007,       // 开评标管理端
  assistant: 3008, // 水叮当智能助手
  bigscreen: 3010,  // 大屏
} as const;

export type AppName = keyof typeof PORTS;
