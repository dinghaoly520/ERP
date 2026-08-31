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
  return { kind: "mock", adapter: await MockUKeyAdapter.open({ storage: ukeyStorage, password }) };
}
