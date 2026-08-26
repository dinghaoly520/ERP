/* =================================================================
   盾解锁会话(spec §5)—— 中间件进程内存 = 「盾芯片内态」的模拟载体

   - 解锁后私钥只在进程内存;签名/解密刷新 lastActive(=盾在用)
   - 超过 TTL 惰性淘汰(下次访问时判),/health 计数用 peek(不续时)
   - 中间件重启(内存丢失)= 全部上锁,须重新开锁
   ================================================================= */
export class ShieldSessions {
  constructor(ttlSeconds = Number(process.env.UKEY_MW_SESSION_TTL ?? 300)) {
    this.ttlMs = ttlSeconds * 1000;
    /** @type {Map<string, { privKeyHex: string, lastActive: number }>} */
    this.entries = new Map();
  }

  set(id, privKeyHex) {
    this.entries.set(id, { privKeyHex, lastActive: Date.now() });
  }

  peek(id) {
    const e = this.entries.get(id);
    if (!e) return null;
    if (Date.now() - e.lastActive > this.ttlMs) { this.entries.delete(id); return null; }
    return e.privKeyHex;
  }

  get(id) {
    const key = this.peek(id);
    if (key !== null) this.entries.get(id).lastActive = Date.now();
    return key;
  }

  drop(id) { this.entries.delete(id); }
  dropAll() { this.entries.clear(); }
  unlockedIds() { return [...this.entries.keys()].filter((id) => this.peek(id) !== null); }
}
