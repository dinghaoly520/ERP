/* =================================================================
   专家侧 UKey/软证书工厂 —— A-152 评标报告电子签署

   专家门户与供应商门户共用浏览器：MockUKeyAdapter 的 keystore 落在
   localStorage 固定键 `mock-ukey-keystore` 上，若直接使用会与供应商
   介质撞车（互相解开/覆盖对方证书库）。本门户一律走独立前缀
   `expert-mock-ukey-keystore:` 的包装 storage——两套介质互不可见。

   探测优先（与供应商门户同范式）：CA 厂商中间件在线（VendorUKeyAdapter.probe）
   → 真 U盾轨；否则回落软证书轨（用户裁定：专家=企业内部人员，
   平台自签 SM2 软证书；供应商购真 CA，专家自建证书）。
   注意：真 U盾轨无 createCertificate——「创建签名证书」流程仅软证书轨可用。
   ================================================================= */
import { MockUKeyAdapter, VendorUKeyAdapter, type StorageLike } from '@water-erp/ukey';

const EXPERT_STORAGE_KEY = 'expert-mock-ukey-keystore';

const expertStorage: StorageLike = {
  getItem: (k) => localStorage.getItem(`${EXPERT_STORAGE_KEY}:${k}`),
  setItem: (k, v) => localStorage.setItem(`${EXPERT_STORAGE_KEY}:${k}`, v),
  removeItem: (k) => localStorage.removeItem(`${EXPERT_STORAGE_KEY}:${k}`),
};

export type ExpertUkeyKind = 'vendor' | 'mock';
export interface OpenedExpertUkey {
  kind: ExpertUkeyKind;
  adapter: MockUKeyAdapter | VendorUKeyAdapter;
}

/** 开锁：中间件在线走真 U盾，否则软证书（独立存储键）。口令仅由调用方内存持有，本工厂不落盘。 */
export async function openExpertUkey(password: string): Promise<OpenedExpertUkey> {
  if (await VendorUKeyAdapter.probe()) {
    return { kind: 'vendor', adapter: await VendorUKeyAdapter.open({ password }) };
  }
  return { kind: 'mock', adapter: await MockUKeyAdapter.open({ storage: expertStorage, password }) };
}
