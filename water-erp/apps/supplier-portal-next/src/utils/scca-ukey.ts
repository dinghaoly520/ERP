/* =================================================================
   scca-ukey.ts — 浏览器侧 SCCA U盾 封装（动态加载 @water-erp/ukey）
   probe→枚举→选证→PIN（页面密码框，绝不入 URL/console）→签名/封装
   ================================================================= */
'use client';
import type { SccaUKeyAdapter as AdapterType, SccaDualCert } from '@water-erp/ukey';

let adapterInstance: AdapterType | null = null;

/** 探测 SCCA U盾中间件在线（300ms 竞速） */
export async function probeScca(): Promise<boolean> {
  const { SccaUKeyAdapter } = await import('@water-erp/ukey');
  return SccaUKeyAdapter.probe(300);
}

/** 获取/创建单例适配器 */
async function getAdapter(): Promise<AdapterType> {
  if (!adapterInstance) {
    const { SccaUKeyAdapter } = await import('@water-erp/ukey');
    adapterInstance = new SccaUKeyAdapter();
  }
  return adapterInstance;
}

/** 枚举双证（含签名证+加密证 PEM） */
export async function listSccaCerts(): Promise<SccaDualCert[]> {
  const adapter = await getAdapter();
  return adapter.listCertificates();
}

/** 登录（PIN 经参数传入——绝不写日志/URL/localStorage） */
export async function loginScca(container: string, pin: string): Promise<void> {
  const adapter = await getAdapter();
  await adapter.login(container, pin);
}

/** 签名 P7（attached） */
export async function signSccaP7(container: string, toSign: string): Promise<string> {
  const adapter = await getAdapter();
  return adapter.signP7Attached(container, toSign);
}

/** 密钥封装 */
export async function wrapSccaKey(encCertPem: string, json: string): Promise<string> {
  const adapter = await getAdapter();
  return adapter.wrapKeyToEncCert(encCertPem, json);
}

/** 密钥解封 */
export async function unwrapSccaKey(container: string, p7B64: string): Promise<string> {
  const adapter = await getAdapter();
  return adapter.unwrapKey(container, p7B64);
}
