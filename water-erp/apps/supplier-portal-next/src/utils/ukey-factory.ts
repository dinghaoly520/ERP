/* =================================================================
   UKey 介质工厂 —— 探测优先自动切换(spec §7)

   VendorUKeyAdapter.probe() 在线(中间件已启动)→ 盾模式;
   离线 → 回落 MockUKeyAdapter(localStorage 软件介质,演示/CI 保底轨道)。
   页面统一经本入口开锁;mock 轨道行为零改动。
   ================================================================= */
import { MockUKeyAdapter, VendorUKeyAdapter, type StorageLike } from "@water-erp/ukey";

export type UkeyKind = "vendor" | "mock";
export interface OpenedUkey {
  kind: UkeyKind;
  adapter: MockUKeyAdapter | VendorUKeyAdapter;
}

/* 严格模式(supplier-portal .env.local: NEXT_PUBLIC_UKEY_STRICT=1):禁用 mock 保底回落——
   中间件不在线时 openUkey 直接报错,只认U盘(vendor)轨。
   默认关:CI/无外设环境的保底轨道(spec §7)不受影响。 */
export const UKEY_STRICT = process.env.NEXT_PUBLIC_UKEY_STRICT === "1";

/** 与各页面原有同键(mock 介质 keystore 落 localStorage) */
const ukeyStorage: StorageLike = {
  getItem: (k) => localStorage.getItem(k),
  setItem: (k, v) => localStorage.setItem(k, v),
  removeItem: (k) => localStorage.removeItem(k),
};

export async function detectUkey(): Promise<UkeyKind> {
  return (await VendorUKeyAdapter.probe()) ? "vendor" : "mock";
}

export async function openUkey(password: string): Promise<OpenedUkey> {
  if (await VendorUKeyAdapter.probe()) {
    return { kind: "vendor", adapter: await VendorUKeyAdapter.open({ password }) };
  }
  if (UKEY_STRICT) {
    throw new Error("未检测到 U盾，请插入 U盾后重试");
  }
  return { kind: "mock", adapter: await MockUKeyAdapter.open({ storage: ukeyStorage, password }) };
}
