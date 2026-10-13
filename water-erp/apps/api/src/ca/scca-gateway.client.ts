/* =================================================================
   SccaGatewayClient — 钜安云验签网关客户端
   阶段0 T3 已证与 JAR SDK 字节等价（HMAC/表单/headers/空值跳过）。
   ================================================================= */
import { createHmac } from 'crypto';

export type GwErrorKind = 'AUTH' | 'PERMISSION' | 'CERT_CHAIN' | 'BUSINESS' | 'UNAVAILABLE' | 'MALFORMED_RESPONSE';

export interface GwVerifyResult {
  ok: boolean;
  resultCode: number;
  resultMsg: string;
  certSerialHex: string | null;
  certBase64: string | null;
  errorKind?: GwErrorKind;
}

export interface SccaGatewayConfig {
  baseUrl: string;
  appId: string;
  appSecret: string;
  timeoutMs: number;
}

export class SccaGatewayClient {
  constructor(private readonly config: SccaGatewayConfig) {}

  async verifyPkcs7(p: { opType: string; requestId: string; signedDataB64: string; toSign: string }): Promise<GwVerifyResult> {
    // 表单与 HMAC 同源：键升序、跳空值、仅值 & 连接（v3 确认 JAR 双侧一致省空）
    const allParams: Record<string, string> = {
      opType: p.opType,
      requestId: p.requestId,
      signedData: p.signedDataB64,
      toSign: p.toSign,
    };
    const entries = Object.keys(allParams).sort()
      .filter(k => allParams[k] != null && allParams[k] !== '')
      .map(k => [k, allParams[k]] as [string, string]);

    const plain = entries.map(([, v]) => v).join('&');
    const signature = createHmac('sha1', Buffer.from(this.config.appSecret, 'utf8'))
      .update(plain, 'utf8').digest('hex');
    const body = new URLSearchParams(entries).toString();

    const url = this.config.baseUrl.replace(/\/+$/, '') + '/api/signature/verifyPkcs7';

    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.config.timeoutMs);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          app_id: this.config.appId,
          signature,
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body,
        signal: ctl.signal,
      });
      // I2 修复：先判 HTTP 状态——5xx 反代错误≠业务失败；401/403 仍尝试解析 body 的
      // result_code 保留真实错误码（实测契约：401 伴随 body result_code=1003）
      if (!res.ok) {
        clearTimeout(timer);
        let bodyCode = -1;
        try {
          const bodyText = await res.text();
          const j = JSON.parse(bodyText);
          if (typeof j?.result_code === 'number') bodyCode = j.result_code;
        } catch { /* 非 JSON 反代错误体——用 HTTP 状态兜底 */ }
        const kind: GwErrorKind = res.status === 401 ? 'AUTH'
          : res.status === 403 ? 'PERMISSION'
          : res.status >= 500 ? 'UNAVAILABLE'
          : 'MALFORMED_RESPONSE';
        return this.err(kind, bodyCode !== -1 ? bodyCode : -res.status, 'HTTP ' + res.status);
      }

      // 按字节流式限读（256KiB）
      const reader = res.body!.getReader();
      let received = 0;
      const chunks: Buffer[] = [];
      let truncated = false;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > 256 * 1024) { truncated = true; break; }
          chunks.push(Buffer.from(value));
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e; // 超时——不被截断分支吞掉
        if (!truncated) throw e;
      }
      if (truncated) { try { await reader.cancel(); } catch { /* ignore */ } }
      clearTimeout(timer);

      const text = Buffer.concat(chunks).toString('utf-8');
      let json: { result_code?: number; result_msg?: string; body?: { serialNumber?: string; certBase64?: string } };
      try { json = JSON.parse(text); } catch { return this.err('MALFORMED_RESPONSE', -1, '响应非 JSON'); }

      const rc = json.result_code ?? -1;
      const msg = json.result_msg ?? '';
      if (rc === 0) {
        return {
          ok: true, resultCode: rc, resultMsg: msg,
          certSerialHex: json.body?.serialNumber?.toLowerCase() ?? null,
          certBase64: json.body?.certBase64 ?? null,
        };
      }
      // 错误映射（阶段0 实测）：1003=鉴权(401) / 1105=权限(403) / 9998=证书链 / 其他=业务
      const kind: GwErrorKind = rc === 1003 ? 'AUTH' : rc === 1105 ? 'PERMISSION' : rc === 9998 ? 'CERT_CHAIN' : 'BUSINESS';
      return { ok: false, resultCode: rc, resultMsg: msg, certSerialHex: null, certBase64: null, errorKind: kind };
    } catch {
      return this.err('UNAVAILABLE', -1, '网络超时/不可达');
    }
  }

  private err(kind: GwErrorKind, rc: number, msg: string): GwVerifyResult {
    return { ok: false, resultCode: rc, resultMsg: msg, certSerialHex: null, certBase64: null, errorKind: kind };
  }
}
