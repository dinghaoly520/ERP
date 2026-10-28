/** 应用端口映射 — 所有应用的端口单一来源 */
export const PORTS = {
  api: 4001,
  public: 3002,   // 信息门户 — 前端入口，公告/政策
  supplier: 3004,  // 供应商门户
  supplierNext: 3020, // 迁移兼容别名：API websocket/origin 校验仍接受；当前 supplier-portal-next 使用 :3004
  web: 3005,       // 统一采购管理工作台（合并 procurement 采购中心 + ERP 管理端）
  expert: 3006,    // 专家门户
  bid: 3007,       // 开评标管理端
  assistant: 3008, // 水叮当智能助手
  bigscreen: 3010,  // 大屏
  mobile: 3011,   // 移动驾驶舱（:3005 数据库/台账/进展 的手机端只读门户）
} as const;

export type AppName = keyof typeof PORTS;
