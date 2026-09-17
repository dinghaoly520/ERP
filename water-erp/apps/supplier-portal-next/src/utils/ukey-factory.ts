/* =================================================================
   UKey 介质工厂 —— 探测优先自动切换(spec §7) + CA 厂家注册表

   VendorUKeyAdapter.probe() 在线(中间件已启动)→ 盾模式;
   离线 → 回落 MockUKeyAdapter(localStorage 软件介质,演示/CI 保底轨道)。
   页面统一经本入口开锁;mock 轨道行为零改动。

   ── CA 厂家注册表(2026-09-17)──
   「CA及签章测试」等处的「选择CA类型」下拉从 CA_PROVIDERS 取选项；
   接新厂家 CA：新写一个 adapter（协议端点/厂商 SDK + DER/PEM↔hex 转换
   在该文件内消化）→ 此处注册表加一行 → 弹窗/探测/开锁零改动。
   ================================================================= */
import { MockUKeyAdapter, VendorUKeyAdapter, type StorageLike } from "@water-erp/ukey";

export type UkeyKind = "vendor" | "mock";
export interface OpenedUkey {
  kind: UkeyKind;
  adapter: MockUKeyAdapter | VendorUKeyAdapter;
}

/** CA 类型条目：介质类别 + 下拉文案 + 在线探测 + 按口令开锁 */
export interface CaProvider {
  /** 注册表内唯一 id（'local-sm2' / 'mock' / 未来 'cfca' 等） */
  id: string;
  /** 「选择CA类型」下拉显示文案 */
  label: string;
  /** 该轨对应的介质类别（页面 U盾 卡片标签等既有语义） */
  kind: UkeyKind;
  /** 驱动在线探测（决定默认选中；不在线仅影响默认，不禁止手选） */
  probe(): Promise<boolean>;
  /** 按口令开锁，返回介质适配器 */
  open(password: string): Promise<MockUKeyAdapter | VendorUKeyAdapter>;
}

/* 严格模式(supplier-portal .env.local: NEXT_PUBLIC_UKEY_STRICT=1):禁用 mock 保底回落——
   中间件不在线时 openUkey 直接报错,只认U盘(vendor)轨（注册表亦不列 mock）。
   默认关:CI/无外设环境的保底轨道(spec §7)不受影响。 */
export const UKEY_STRICT =
  process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_UKEY_STRICT === "1";
// 生产构建恒严格(防漏配导致 mock 回落静默生效);开发/演示由 .env.local 显式开启

/** 与各页面原有同键(mock 介质 keystore 落 localStorage) */
const ukeyStorage: StorageLike = {
  getItem: (k) => localStorage.getItem(k),
  setItem: (k, v) => localStorage.setItem(k, v),
  removeItem: (k) => localStorage.removeItem(k),
};

/** 本机 CA 驱动轨（mock 中间件协议 v1；真 CA 到只换其 adapter） */
const localSm2Provider: CaProvider = {
  id: "local-sm2",
  label: "国密 SM2 · 本机CA驱动",
  kind: "vendor",
  probe: async () => !!(await VendorUKeyAdapter.probe()),
  open: (password) => VendorUKeyAdapter.open({ password }),
};

/** 浏览器模拟介质轨（演示/CI 保底；严格模式不注册，UI 不可选） */
const mockBrowserProvider: CaProvider = {
  id: "mock",
  label: "国密 SM2 · 浏览器模拟介质（演示）",
  kind: "mock",
  probe: async () => true,
  open: async (password) => MockUKeyAdapter.open({ storage: ukeyStorage, password }),
};

/** 已注册 CA 厂家/介质轨——新增厂家只动这里 */
export const CA_PROVIDERS: readonly CaProvider[] = UKEY_STRICT
  ? [localSm2Provider]
  : [localSm2Provider, mockBrowserProvider];

export async function detectUkey(): Promise<UkeyKind> {
  return (await VendorUKeyAdapter.probe()) ? "vendor" : "mock";
}

/**
 * 开锁。providerId 指定注册表 id 时按该轨直接开锁（显式选择，探测失败如实报错）；
 * 不指定时保持既有自动语义：探测优先真盾轨，离线回落 mock（严格模式抛错）。
 */
export async function openUkey(password: string, providerId?: string): Promise<OpenedUkey> {
  const explicit = providerId ? CA_PROVIDERS.find((p) => p.id === providerId) : undefined;
  if (explicit) {
    return { kind: explicit.kind, adapter: await explicit.open(password) };
  }
  if (await VendorUKeyAdapter.probe()) {
    return { kind: "vendor", adapter: await VendorUKeyAdapter.open({ password }) };
  }
  if (UKEY_STRICT) {
    throw new Error("未检测到 U盾，请插入 U盾后重试");
  }
  return { kind: "mock", adapter: await MockUKeyAdapter.open({ storage: ukeyStorage, password }) };
}
