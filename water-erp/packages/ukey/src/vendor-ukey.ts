import type { CertInfo, UKeyAdapter } from './types';

/** CA 厂商本地中间件适配骨架：拿到 SDK 文档后填三方法，业务代码零改动（spec §3.3）。 */
export class VendorUKeyAdapter implements UKeyAdapter {
  readonly name = 'vendor-ukey';
  static readonly VENDOR_BASE_URL = 'http://127.0.0.1:17999'; // 厂商本地服务（占位端口，以 SDK 为准）

  async listCertificates(): Promise<CertInfo[]> {
    throw new Error('VendorUKeyAdapter 未接入：待 CA 厂商 SDK');
  }
  async sign(_certSn: string, _msg: string): Promise<string> {
    throw new Error('VendorUKeyAdapter 未接入：待 CA 厂商 SDK');
  }
  async decrypt(_certSn: string, _cipherHex: string): Promise<string> {
    throw new Error('VendorUKeyAdapter 未接入：待 CA 厂商 SDK');
  }
}
