/* =================================================================
   SccaUKeyAdapter — SCCA U盾 双证书适配器（阶段1 Task9）

   双证同容器（S1 实测 1 条目）；签名/加密证书分别导出（S2 实测 PEM）。
   错误码归一化（SccaTransport.normalizeError）。
   ================================================================= */
import { SccaTransport, SccaTransportError } from './scca-transport';

export interface SccaDualCert {
  container: string;
  displayName: string;
  sign: { pem: string; serialHex?: string };
  enc: { pem: string; serialHex?: string };
}

export class SccaUKeyAdapter {
  readonly name = 'scca-ukey';
  private readonly transport: SccaTransport;

  constructor(onWsEvent?: Parameters<typeof SccaTransport.prototype.call>[0] extends never ? never : (e: import('./scca-transport').SccaWsEvent) => void) {
    this.transport = new SccaTransport(onWsEvent);
  }

  /** 探测中间件在线（竞速 300ms——浏览器 WebSocket 无连接超时参数） */
  static async probe(timeoutMs = 300): Promise<boolean> {
    return new Promise((resolve) => {
      const ws = new WebSocket('wss://localhost:36171');
      const t = setTimeout(() => { try { ws.close(); } catch { } resolve(false); }, timeoutMs);
      ws.onopen = () => { clearTimeout(t); try { ws.close(); } catch { } resolve(true); };
      ws.onerror = () => { clearTimeout(t); resolve(false); };
    });
  }

  /** 枚举双证（SOF_GetUserList → 解析容器名 → 双导出） */
  async listCertificates(): Promise<SccaDualCert[]> {
    const r = await this.transport.call('SOF_GetUserList', []);
    if (!r.retValue || r.retValue === 'null') return [];
    // 格式：`名称||容器名&&&名称||容器名&&&…`（S1 实测）
    const entries = String(r.retValue).split('&&&').filter(Boolean).map(s => {
      const [displayName, container] = s.split('||');
      return { displayName: displayName ?? '', container: container ?? '' };
    });
    const result: SccaDualCert[] = [];
    for (const e of entries) {
      const signR = await this.transport.call('SOF_ExportUserCert', [e.container]);
      const encR = await this.transport.call('SOF_ExportExChangeUserCert', [e.container]);
      result.push({
        container: e.container,
        displayName: e.displayName,
        sign: { pem: String(signR.retValue ?? '') },
        enc: { pem: String(encR.retValue ?? '') },
      });
    }
    return result;
  }

  /** 登录（SOF_Login；错误归一化） */
  async login(container: string, pin: string): Promise<void> {
    const r = await this.transport.call('SOF_Login', [container, pin]);
    if (!r.retValue || r.retValue === 'false' || r.retValue === false) {
      const kind = SccaTransport.normalizeError(r.retCode, r.retValue);
      if (kind === 'UKEY_PIN_INVALID') {
        const retry = await this.transport.call('SOF_GetPinRetryCount', [container]);
        throw new SccaTransportError(`PIN 错误（剩余 ${retry.retValue} 次）`, 'UKEY_PIN_INVALID');
      }
      throw new SccaTransportError(`SOF_Login 失败 retCode=${r.retCode}`, kind ?? 'UKEY_TIMEOUT');
    }
  }

  /** attached P7 签名（SOFE_SignPKCS7Message flag=0；干净 TextEncoder 编码） */
  async signP7Attached(container: string, text: string): Promise<string> {
    const b64 = this.cleanBase64(text);
    const r = await this.transport.call('SOFE_SignPKCS7Message', [0, container, b64]);
    if (!r.retValue) {
      throw new SccaTransportError('签名失败（返回空）', SccaTransport.normalizeError(r.retCode, r.retValue) ?? 'UKEY_TIMEOUT');
    }
    return String(r.retValue);
  }

  /** 密钥封装（SOF_EncryptData 到加密证；DoS 红线在 transport 层） */
  async wrapKeyToEncCert(encCertPem: string, json: string): Promise<string> {
    const dataB64 = this.cleanBase64(json);
    const r = await this.transport.call('SOF_EncryptData', [encCertPem, dataB64]);
    if (!r.retValue) {
      throw new SccaTransportError('密钥封装失败', SccaTransport.normalizeError(r.retCode, r.retValue) ?? 'UKEY_TIMEOUT');
    }
    return String(r.retValue);
  }

  /** 密钥解封（SOF_DecryptData） */
  async unwrapKey(container: string, p7B64: string): Promise<string> {
    const r = await this.transport.call('SOF_DecryptData', [container, p7B64]);
    if (!r.retValue) {
      throw new SccaTransportError('密钥解封失败（错盾/错钥？）', SccaTransport.normalizeError(r.retCode, r.retValue) ?? 'UKEY_TIMEOUT');
    }
    return String(r.retValue);
  }

  /** 获取日志（PIN 已掩码） */
  getLog(): string { return JSON.stringify(this.transport.log, null, 2); }

  /** 干净 base64：不改 CRLF、支持 4 字节 UTF-8（demo 的 base64Encode 两者皆错——S5 实证） */
  private cleanBase64(s: string): string {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(bin);
  }
}
