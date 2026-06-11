/** 应用端口映射 — 所有应用的端口单一来源 */
export const PORTS = {
  api: 4001,
  web: 3002,
  supplier: 3003,
  expert: 3004,
  public: 3005,
} as const;

export type AppName = keyof typeof PORTS;
