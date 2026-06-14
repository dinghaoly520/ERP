/** 应用端口映射 — 所有应用的端口单一来源 */
export const PORTS = {
  api: 4001,
  mall: 3002,
  supplier: 3003,
  web: 3004,
  expert: 3005,
  public: 3006,
  bid: 3007,
  assistant: 3008,
} as const;

export type AppName = keyof typeof PORTS;
