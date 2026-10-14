import { CaChallengeService, ChallengePurpose } from './ca-challenge.service';

// ─── mock Redis（HMGET/HSET/EXPIRE/EVAL 模拟）───
class MockRedis {
  store = new Map<string, Record<string, string>>();
  async hset(key: string, ...kv: string[]): Promise<number> {
    if (!this.store.has(key)) this.store.set(key, {});
    const obj = this.store.get(key)!;
    for (let i = 0; i < kv.length; i += 2) obj[kv[i]!] = kv[i + 1]!;
    return 1;
  }
  async expire(key: string, _s: number): Promise<number> { return 1; }
  async eval(script: string, _n: number, ...args: string[]): Promise<unknown> {
    const key = args[0]!;
    if (script.includes('HGETALL')) {
      // CONSUME_PROOF_LUA：userId+action 校验 → DEL
      const data = this.store.get(key);
      if (!data) return null;
      if (data['userId'] !== args[1] || data['action'] !== args[2]) return 'MISMATCH';
      this.store.delete(key);
      return 'CONSUMED';
    }
    const purpose = args[1]!, bindingKey = args[2]!;
    const data = this.store.get(key);
    if (!data) return null;
    if (data['state'] !== 'READY') return 'ALREADY_CLAIMED';
    if (data['purpose'] !== purpose || data['bindingKey'] !== bindingKey) return 'MISMATCH';
    data['state'] = 'CONSUMED';
    return data['toSign'];
  }
  async del(key: string): Promise<number> { this.store.delete(key); return 1; }
}

describe('CaChallengeService（一次性挑战原子消费）', () => {
  let svc: CaChallengeService;
  let redis: MockRedis;

  beforeEach(() => { redis = new MockRedis(); svc = new CaChallengeService(redis as any); });

  test('登录挑战 toSign 以 LOGONDATA: 开头且含 challengeId/nonce', async () => {
    const ch = await svc.createLogin({ portal: 'supplier', browserCookieHash: 'bh1', signCertSha256: 'aa'.repeat(32) });
    expect(ch.toSign).toMatch(/^LOGONDATA:/);
    expect(ch.toSign).toContain(ch.challengeId);
    expect(ch.toSign).toContain('"nonce"');
    expect(ch.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  test('原子消费：同一挑战只能成功一次', async () => {
    const ch = await svc.createBound({ userId: 'u1', sid: 's1', purpose: 'bind', signCertSha256: 'aa' });
    const key = 'supplier:bh';
    // 第一次成功
    const r1 = await svc.claimAndConsume(ch.challengeId, 'bind', 'u1:s1');
    expect(r1).not.toBeNull();
    expect(r1!.toSign).toBe(ch.toSign);
    // 第二次拒绝（已 CONSUMED）
    const r2 = await svc.claimAndConsume(ch.challengeId, 'bind', 'u1:s1');
    expect(r2).toBeNull();
  });

  test('错误的 purpose 拒绝', async () => {
    const ch = await svc.createBound({ userId: 'u1', sid: 's1', purpose: 'bind', signCertSha256: 'aa' });
    const r = await svc.claimAndConsume(ch.challengeId, 'revoke' as ChallengePurpose, 'u1:s1');
    expect(r).toBeNull();
  });

  test('错误的 bindingKey 拒绝', async () => {
    const ch = await svc.createBound({ userId: 'u1', sid: 's1', purpose: 'bind', signCertSha256: 'aa' });
    const r = await svc.claimAndConsume(ch.challengeId, 'bind', 'u2:s2');
    expect(r).toBeNull();
  });

  test('不存在的挑战 → null', async () => {
    const r = await svc.claimAndConsume('nonexistent', 'bind', 'u1:s1');
    expect(r).toBeNull();
  });

  describe('C1 修复：凭据证明存/消费', () => {
    test('storeProof → consumeProof 成功（userId+action 匹配）', async () => {
      await svc.storeProof({ proofId: 'p1', userId: 'u1', sid: 's1', action: 'bind' });
      const ok = await svc.consumeProof('p1', 'u1', 'bind');
      expect(ok).toBe(true);
    });

    test('consumeProof 一次性——二次消费失败', async () => {
      await svc.storeProof({ proofId: 'p2', userId: 'u1', sid: 's1', action: 'bind' });
      expect(await svc.consumeProof('p2', 'u1', 'bind')).toBe(true);
      expect(await svc.consumeProof('p2', 'u1', 'bind')).toBe(false);
    });

    test('consumeProof userId 不符 → 拒绝且不消费', async () => {
      await svc.storeProof({ proofId: 'p3', userId: 'u1', sid: 's1', action: 'bind' });
      expect(await svc.consumeProof('p3', 'u2', 'bind')).toBe(false);
      // 未被消费——正确用户仍可消费
      expect(await svc.consumeProof('p3', 'u1', 'bind')).toBe(true);
    });

    test('consumeProof action 不符 → 拒绝', async () => {
      await svc.storeProof({ proofId: 'p4', userId: 'u1', sid: 's1', action: 'bind' });
      expect(await svc.consumeProof('p4', 'u1', 'revoke')).toBe(false);
    });

    test('consumeProof 不存在/过期 → false', async () => {
      expect(await svc.consumeProof('nonexistent', 'u1', 'bind')).toBe(false);
    });
  });

  test('绑定挑战 toSign 含双证指纹', async () => {
    const ch = await svc.createBound({
      userId: 'u1', sid: 's1', purpose: 'bind',
      signCertSha256: 'sign-sha', encCertSha256: 'enc-sha',
    });
    expect(ch.toSign).toContain('sign-sha');
    expect(ch.toSign).toContain('enc-sha');
  });
});
