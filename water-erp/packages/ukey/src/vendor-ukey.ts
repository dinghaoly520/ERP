import type { CertInfo, UKeyAdapter } from './types';

/* =================================================================
   VendorUKeyAdapter — CA 厂商本地中间件适配层
   (mock 中间件协议 v1,docs/superpowers/specs/2026-08-26-mock-ukey-middleware-design.md §5/§6)

   - 纯 fetch + Web 标准 API(浏览器与 Node 同源);无 Node 专有 API
   - probe() 是门户「探测优先切换」的依据:中间件不在 → null
   - open() 镜像 MockUKeyAdapter.open 的工厂形状,三视图切换只改一行
   - 接真 CA 时只改本文件:协议端点换厂商 SDK + DER/PEM↔hex 转换在此消化
   ================================================================= */

const OP_TIMEOUT_MS = 10_000;

const CODE_MSG: Record<string, string> = {
  PIN_REQUIRED: 'U盾未解锁或会话已超时,请重新开锁',
  SHIELD_LOCKED: 'U盾已锁定(PIN 错误次数超限),请使用管理码(PUK)解锁',
  SHIELD_NOT_FOUND: '未找到 U盾(可能已拔出)',
  DECRYPT_FAILED: 'U盾解密失败:密文损坏',
  BAD_REQUEST: 'U盾中间件请求参数错误',
};

interface HealthInfo { shields: number; unlocked: number; }

async function requestJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ status: number; body: any }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // 中间件被杀/超时 abort/连接拒绝 → fetch 抛 TypeError/DOMException,统一转译中文(spec §6);probe 自己 catch 故不受影响
    const res = await fetch(url, { ...init, signal: ctrl.signal }).catch(() => {
      throw new Error('U盾中间件连接失败或已退出，请重启驱动服务（pnpm dev:ukey-mw）');
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function raise(status: number, body: any): never {
  const code = typeof body?.code === 'string' ? body.code : '';
  throw new Error(CODE_MSG[code] ?? body?.error ?? `U盾中间件请求失败(HTTP ${status})`);
}

const jsonInit = (payload: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});

export class VendorUKeyAdapter implements UKeyAdapter {
  readonly name = 'vendor-ukey';
  static readonly VENDOR_BASE_URL = 'http://127.0.0.1:17999';

  private constructor(private readonly baseUrl: string) {}

  /** 会话到期时刻（ms）——服务端在每次成功签名/解密时续活，本类随响应里的 ttlSeconds 同步刷新 */
  private sessionExpiresAt: number | null = null;

  /** 按响应携带的 ttlSeconds 续算到期时刻；旧中间件不带该字段则维持未知（不制造假倒计时） */
  private touchSession(body: any) {
    const ttl = Number(body?.ttlSeconds);
    if (Number.isFinite(ttl) && ttl > 0) this.sessionExpiresAt = Date.now() + ttl * 1000;
  }

  /** 距空闲自动锁定剩余秒数（向上取整）；会话 TTL 未知 → null */
  secondsUntilLock(): number | null {
    if (this.sessionExpiresAt === null) return null;
    return Math.max(0, Math.ceil((this.sessionExpiresAt - Date.now()) / 1000));
  }

  /** 探测中间件(默认 300ms 超时):不在/异常 → null;在 → 在场盾与已解锁计数 */
  static async probe(
    timeoutMs = 300,
    baseUrl: string = VendorUKeyAdapter.VENDOR_BASE_URL,
  ): Promise<HealthInfo | null> {
    try {
      const { status, body } = await requestJson(`${baseUrl}/health`, { method: 'GET' }, timeoutMs);
      if (status !== 200 || body?.ok !== true) return null;
      return { shields: Number(body.shields) || 0, unlocked: Number(body.unlocked) || 0 };
    } catch {
      return null;
    }
  }

  /** 开锁:probe → unlock(PIN)。错 PIN/锁死抛中文 Error(message 含 retryLeft)。 */
  static async open(opts: { password: string; baseUrl?: string }): Promise<VendorUKeyAdapter> {
    const baseUrl = opts.baseUrl ?? VendorUKeyAdapter.VENDOR_BASE_URL;
    if (!(await VendorUKeyAdapter.probe(300, baseUrl))) {
      throw new Error('未检测到 U盾中间件——请插入 U盾并启动驱动服务(pnpm dev:ukey-mw)');
    }
    const { status, body } = await requestJson(
      `${baseUrl}/session/unlock`,
      jsonInit({ pin: opts.password }),
      OP_TIMEOUT_MS,
    );
    if (status !== 200) raise(status, body);
    const unlocked: unknown[] = Array.isArray(body?.unlocked) ? body.unlocked : [];
    const failed: Array<{ shieldId: string; retryLeft?: number; locked?: boolean }> = Array.isArray(body?.failed) ? body.failed : [];
    if (unlocked.length === 0 && failed.length > 0) {
      const f = failed[0];
      throw new Error(
        f.locked
          ? 'U盾已锁定(PIN 错误次数超限),请使用管理码(PUK)解锁'
          : `U盾口令不符(剩余尝试次数 ${f.retryLeft ?? '?'})`,
      );
    }
    const adapter = new VendorUKeyAdapter(baseUrl);
    adapter.touchSession(body);
    return adapter;
  }

  async listCertificates(): Promise<CertInfo[]> {
    const { status, body } = await requestJson(`${this.baseUrl}/certs`, { method: 'GET' }, OP_TIMEOUT_MS);
    if (status !== 200) raise(status, body);
    return (Array.isArray(body?.certs) ? body.certs : []).map(
      (c: any): CertInfo => ({ certSn: c.certSn, certDn: c.certDn, publicKey: c.publicKey, alg: c.alg ?? 'SM2' }),
    );
  }

  async sign(certSn: string, msg: string): Promise<string> {
    const { status, body } = await requestJson(`${this.baseUrl}/sign`, jsonInit({ certSn, data: msg }), OP_TIMEOUT_MS);
    if (status !== 200) raise(status, body);
    if (typeof body?.sig !== 'string') throw new Error('U盾签名失败:中间件返回缺失');
    this.touchSession(body); // 服务端每次成功操作续活会话，同步刷新本地到期时刻
    return body.sig;
  }

  async decrypt(certSn: string, cipherHex: string): Promise<string> {
    const { status, body } = await requestJson(`${this.baseUrl}/sm2/decrypt`, jsonInit({ certSn, cipher: cipherHex }), OP_TIMEOUT_MS);
    if (status !== 200) raise(status, body);
    if (typeof body?.plain !== 'string' || !body.plain) throw new Error('U盾解密失败:密文损坏或口令不符');
    this.touchSession(body);
    return body.plain;
  }
}
