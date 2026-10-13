/* =================================================================
   scca-fixture — FakeWS（Node 测试用假 WebSocket，模拟证书助手中间件）
   phase0 t1-run.mjs/t1e.mjs 语义移植为可复用测试工具。
   ================================================================= */

export class FakeWS {
  static openDelay = 50;
  static failOpen = false;
  static closeBeforeOpen = false;
  static instances: FakeWS[] = [];
  static script: Array<(sock: FakeWS, sent: string) => void> = [];

  url: string;
  readyState = 0;
  lastSent: string | null = null;
  private _l = new Map<string, Array<(ev: any) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeWS.instances.push(this);
    if (FakeWS.closeBeforeOpen) {
      setTimeout(() => { this.readyState = 3; this.onclose?.(); }, 10);
      return;
    }
    setTimeout(() => {
      if (FakeWS.failOpen) { this.onerror?.({} as any); this.readyState = 3; this.onclose?.(); return; }
      this.readyState = 1; this.onopen?.();
    }, FakeWS.openDelay);
  }

  addEventListener(t: string, fn: (ev: any) => void) {
    if (!this._l.has(t)) this._l.set(t, []);
    this._l.get(t)!.push(fn);
  }
  removeEventListener(t: string, fn: (ev: any) => void) {
    const a = this._l.get(t);
    if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  }
  send(data: string) {
    this.lastSent = data;
    const act = FakeWS.script.shift();
    if (act) setTimeout(() => act(this, data), 0);
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    const cb = this.onclose;
    this.onclose = null;
    cb?.();
  }
  emit(t: string, ev: any) {
    for (const fn of this._l.get(t) ?? []) fn(ev);
    if (t === 'message' && this.onmessage) this.onmessage(ev);
  }

  onopen: (() => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: any) => void) | null = null;

  static reset() {
    FakeWS.openDelay = 50;
    FakeWS.failOpen = false;
    FakeWS.closeBeforeOpen = false;
    FakeWS.instances = [];
    FakeWS.script = [];
  }
}

/** 测试辅助：全局注入 FakeWS */
export function injectFakeWS() {
  (globalThis as any).window = globalThis;
  (globalThis as any).WebSocket = FakeWS;
}
