/* =================================================================
   SccaTransport — SCCA U盾 本机 WSS 受控通道（transport v3.2 语义）

   阶段0 实测语义（docs/superpowers/specs/2026-10-12-scca-phase0-test-plan.md §4）：
   - FIFO 串行队列（SDK 无请求关联 ID——唯一安全模式）
   - 每请求固定自己的 socket+generation
   - 超时=只关自己的连接+换代次（不殃及新连接）
   - queueEpoch 失效（排队命令不跨连接续发）
   - 连接等待 8s 超时；打开前关闭立即 reject
   - 迟到帧只记录不消费
   - action 回显不匹配不消费
   - PIN 不进日志（mask 表）
   - 禁止同步大报文（S9-3 全局阻塞 DoS 面——SOF_EncryptData >64KiB 抛错）

   错误码（S3/S9/S10/S11 实测）：
   184550659 → UKEY_PIN_REQUIRED（未登录——拔盾/服务重启后重登）
   184550657 → UKEY_PIN_INVALID（PIN 错——错一次减一、登录成功回满）
   184549377 → UKEY_DECRYPT_FAILED（错盾/错钥通用码）
   ================================================================= */

export type SccaErrorCode = 'UKEY_PIN_REQUIRED' | 'UKEY_PIN_INVALID' | 'UKEY_DECRYPT_FAILED' | 'UKEY_TIMEOUT' | 'UKEY_CONN_LOST' | 'UKEY_QUEUE_INVALIDATED' | 'UKEY_MALFORMED';

export class SccaTransportError extends Error {
  constructor(msg: string, public readonly code: SccaErrorCode, public readonly lastError?: number) {
    super(msg);
    this.name = 'SccaTransportError';
  }
}

export interface SccaWsEvent { kind: 'open' | 'close' | 'error' | 'late-frame' | 'stale-frame-dropped' | 'unmatched-frame' | 'timeout'; gen?: number; data?: string }

const WS_URL = 'wss://localhost:36171';
const DEFAULT_OP_TIMEOUT_MS = 20000;
const DEFAULT_CONNECT_TIMEOUT_MS = 8000;
const MAX_ENCRYPT_INPUT = 64 * 1024; // DoS 红线

// PIN 掩码表（SOF_Login 第 2 参数 / SOF_ChangePassWd 第 2-3 参数 / SOFE_UnblockPassWd 第 2-3 参数）
const PIN_ACTIONS: Record<string, number[]> = {
  SOF_Login: [1], SOF_ChangePassWd: [1, 2], SOFE_UnblockPassWd: [1, 2],
};

function maskParams(action: string, params: unknown[]): unknown[] {
  const idx = PIN_ACTIONS[action];
  if (!idx) return params;
  return params.map((p, i) => (idx.includes(i) ? '***' : p));
}

export class SccaTransport {
  private ws: WebSocket | null = null;
  private gen = 0;
  private connectP: Promise<number> | null = null;
  private active: { onMsg: (ev: MessageEvent) => void; fail: (e: Error) => void } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private queueEpoch = 0;
  readonly log: Array<{ ts: string; kind: string; action?: string; tag?: string; gen?: number; data?: string }> = [];

  readonly opTimeoutMs: number;
  readonly connectTimeoutMs: number;

  constructor(
    private readonly onWsEvent?: (e: SccaWsEvent) => void,
    timeouts?: { op?: number; connect?: number },
  ) {
    this.opTimeoutMs = timeouts?.op ?? DEFAULT_OP_TIMEOUT_MS;
    this.connectTimeoutMs = timeouts?.connect ?? DEFAULT_CONNECT_TIMEOUT_MS;
  }

  /** 受控 FIFO 调用——所有操作经此串行 */
  call(action: string, params: unknown[]): Promise<{ retValue: any; retCode?: number }> {
    const epoch = this.queueEpoch;
    const run = this.queue.then(async () => {
      if (epoch !== this.queueEpoch) {
        throw new SccaTransportError('QUEUE_INVALIDATED：连接已超时/断开——请显式重新发起', 'UKEY_QUEUE_INVALIDATED');
      }
      return this.doCall(action, params);
    });
    this.queue = run.catch(() => {}); // 队列永不因失败而阻塞
    return run;
  }

  private async doCall(action: string, params: unknown[]): Promise<{ retValue: any; retCode?: number }> {
    // DoS 红线
    if (action === 'SOF_EncryptData') {
      const dataB64 = params[1];
      if (typeof dataB64 === 'string' && dataB64.length > MAX_ENCRYPT_INPUT) {
        throw new SccaTransportError(`SOF_EncryptData 输入 ${dataB64.length}B 超过 ${MAX_ENCRYPT_INPUT}B 红线（全局阻塞 DoS 面）`, 'UKEY_QUEUE_INVALIDATED');
      }
    }

    const myGen = await this.connect();
    if (this.gen !== myGen || !this.ws || this.ws.readyState !== 1) {
      throw new SccaTransportError(`连接代次失效 gen=${myGen}/${this.gen}`, 'UKEY_CONN_LOST');
    }
    const sock = this.ws;
    const frame = JSON.stringify({ action, params });
    this.log.push({ ts: new Date().toISOString(), kind: 'req', action, gen: myGen, tag: JSON.stringify(maskParams(action, params as unknown[])).slice(0, 200) });

    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (val: { retValue: any; retCode?: number }) => {
        if (timer) clearTimeout(timer);
        sock.removeEventListener('message', onMsg);
        if (this.active?.onMsg === onMsg) this.active = null;
        resolve(val);
      };
      const onMsg = (ev: MessageEvent) => {
        if (this.gen !== myGen || this.ws !== sock) {
          this.log.push({ ts: new Date().toISOString(), kind: 'ws', tag: 'stale-frame-dropped', gen: myGen });
          return;
        }
        let j: { retValue?: any; retCode?: number; action?: string } | null = null;
        try { j = JSON.parse(ev.data as string); } catch {
          if (timer) clearTimeout(timer);
          sock.removeEventListener('message', onMsg);
          if (this.active?.onMsg === onMsg) this.active = null;
          return reject(new SccaTransportError('响应帧 JSON 解析失败', 'UKEY_MALFORMED'));
        }
        if (j && typeof j.action === 'string' && j.action !== action) {
          this.log.push({ ts: new Date().toISOString(), kind: 'ws', tag: 'unmatched-frame', gen: myGen });
          return; // 有回显但不属本调用→不消费
        }
        this.log.push({ ts: new Date().toISOString(), kind: 'resp', action, gen: myGen, tag: `code=${j?.retCode} val=${String(j?.retValue).slice(0, 80)}` });
        finish(j as { retValue: any; retCode?: number });
      };
      timer = setTimeout(() => {
        // 超时=只关本请求的连接；换代次；失效旧队列
        if (this.active?.onMsg === onMsg) this.active = null;
        if (timer) clearTimeout(timer);
        sock.removeEventListener('message', onMsg);
        if (this.ws === sock) { this.ws = null; this.gen++; this.queueEpoch++; }
        try { sock.close(); } catch { /* already closed */ }
        this.log.push({ ts: new Date().toISOString(), kind: 'ws', tag: 'timeout', action, gen: myGen });
        this.onWsEvent?.({ kind: 'timeout', gen: myGen });
        resolve({ retValue: '', retCode: undefined, ...{} }); // 超时返回空 retValue（与 transport v3 一致）
      }, this.opTimeoutMs);
      this.active = { onMsg, fail: (e) => {
        if (timer) clearTimeout(timer);
        sock.removeEventListener('message', onMsg);
        this.active = null;
        reject(e);
      }};
      sock.addEventListener('message', onMsg);
      sock.send(frame);
    });
  }

  private connect(): Promise<number> {
    if (this.ws && this.ws.readyState === 1) return Promise.resolve(this.gen);
    if (this.connectP) return this.connectP;
    const myGen = ++this.gen;
    this.connectP = new Promise((resolve, reject) => {
      const sock = new WebSocket(WS_URL);
      this.ws = sock;
      const st = { done: false };
      const ct = setTimeout(() => {
        if (st.done) return; st.done = true; this.connectP = null;
        if (this.ws === sock) this.ws = null;
        try { sock.close(); } catch { /* ignore */ }
        this.onWsEvent?.({ kind: 'error', gen: myGen });
        reject(new SccaTransportError('WSS 连接超时（8s）：证书助手未响应', 'UKEY_CONN_LOST'));
      }, this.connectTimeoutMs);
      const openDone = () => {
        if (st.done) return; st.done = true; clearTimeout(ct); this.connectP = null;
        this.log.push({ ts: new Date().toISOString(), kind: 'ws', tag: 'open', gen: myGen });
        resolve(myGen);
      };
      const failDone = (code: SccaErrorCode, msg: string) => {
        if (st.done) return; st.done = true; clearTimeout(ct); this.connectP = null;
        if (this.ws === sock) this.ws = null;
        reject(new SccaTransportError(msg, code));
      };
      sock.onopen = () => { if (this.ws === sock) openDone(); else { try { sock.close(); } catch { } } };
      sock.onerror = () => {
        if (this.ws === sock) {
          this.onWsEvent?.({ kind: 'error', gen: myGen });
          failDone('UKEY_CONN_LOST', 'WSS 连接失败：证书助手未安装/未启动/被浏览器拦截');
        }
      };
      sock.onclose = () => {
        this.log.push({ ts: new Date().toISOString(), kind: 'ws', tag: 'close', gen: myGen });
        if (this.active) { this.active.fail(new SccaTransportError('连接已断开（WSS close）', 'UKEY_CONN_LOST')); }
        if (this.ws === sock) { this.ws = null; this.queueEpoch++; }
        this.connectP = null;
        failDone('UKEY_CONN_LOST', '连接在打开前关闭');
      };
      sock.onmessage = (ev: MessageEvent) => {
        if (!this.active) {
          this.log.push({ ts: new Date().toISOString(), kind: 'ws', tag: 'late-frame', gen: myGen, data: String(ev.data).slice(0, 200) });
        }
      };
    });
    return this.connectP;
  }

  /** 归一化中间件错误码（S3/S9/S10/S11 实测） */
  static normalizeError(retCode: number | undefined, retValue: any): SccaErrorCode | null {
    if (retCode === 184550659) return 'UKEY_PIN_REQUIRED';
    if (retCode === 184550657) return 'UKEY_PIN_INVALID';
    if (retCode === 184549377) return 'UKEY_DECRYPT_FAILED';
    if (retValue === '' || retValue === 'null' || retValue === false) return 'UKEY_TIMEOUT';
    return null;
  }
}
