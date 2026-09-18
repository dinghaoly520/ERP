/* =================================================================
   UKey 介质工厂 —— vendor（U盘 CA 驱动中间件）唯一轨 + CA 厂家注册表

   VendorUKeyAdapter.probe() 在线（本机/自制 U盘自带中间件已启动）→ 盾模式；
   离线时 openUkey 直接报错（请插入 U盾）。
   浏览器 mock 软件介质轨已于 2026-09-18 移除（用户裁定：演示只用自制 U盘，
   生产走真 CA）；CI/e2e 保底介质由脚本侧直接使用 @water-erp/ukey 的内存
   MockUKeyAdapter（scripts/dual-selfcheck.ts、e2e-dual-envelope.ts），不经本工厂。

   ── CA 厂家注册表(2026-09-17)──
   「CA及签章测试」等处的「选择CA类型」下拉从 CA_PROVIDERS 取选项；
   接新厂家 CA：新写一个 adapter（协议端点/厂商 SDK + DER/PEM↔hex 转换
   在该文件内消化）→ 此处注册表加一行 → 弹窗/探测/开锁零改动。
   ================================================================= */
import { VendorUKeyAdapter } from "@water-erp/ukey";

export interface OpenedUkey {
  adapter: VendorUKeyAdapter;
}

/** CA 类型条目：下拉文案 + 在线探测 + 按口令开锁 */
export interface CaProvider {
  /** 注册表内唯一 id（'local-sm2' / 未来 'cfca' 等） */
  id: string;
  /** 「选择CA类型」下拉显示文案 */
  label: string;
  /** 驱动在线探测（决定默认选中；不在线仅影响默认，不禁止手选） */
  probe(): Promise<boolean>;
  /** 按口令开锁，返回介质适配器 */
  open(password: string): Promise<VendorUKeyAdapter>;
}

/** 本机/U盘 CA 驱动轨（mock 中间件协议 v1；真 CA 到只换其 adapter） */
const localSm2Provider: CaProvider = {
  id: "local-sm2",
  label: "国密 SM2 · 本机CA驱动",
  probe: async () => !!(await VendorUKeyAdapter.probe()),
  open: (password) => VendorUKeyAdapter.open({ password }),
};

/** 已注册 CA 厂家/介质轨——新增厂家只动这里 */
export const CA_PROVIDERS: readonly CaProvider[] = [localSm2Provider];

/**
 * 开锁。providerId 指定注册表 id 时按该轨直接开锁（显式选择，探测失败如实报错）；
 * 不指定时探测 vendor 中间件，离线抛错（唯一轨，无回落）。
 */
export async function openUkey(password: string, providerId?: string): Promise<OpenedUkey> {
  const explicit = providerId ? CA_PROVIDERS.find((p) => p.id === providerId) : undefined;
  if (explicit) {
    return { adapter: await explicit.open(password) };
  }
  if (await VendorUKeyAdapter.probe()) {
    return { adapter: await VendorUKeyAdapter.open({ password }) };
  }
  throw new Error("未检测到 U盾，请插入 U盾后重试");
}
