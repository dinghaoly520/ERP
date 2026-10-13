/* =================================================================
   CaChallengeService — 一次性挑战（Redis Lua 原子消费）
   登录=匿名 cookie 绑定；绑定/自检=userId+sid 绑定。
   ================================================================= */
import { createHash, randomBytes } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';

export type ChallengePurpose = 'ca-login' | 'bind' | 'replace' | 'revoke' | 'self-test';

// Lua：原子比对 purpose+bindingKey → CONSUMED（失败不回 READY）
const CLAIM_LUA = `
local s = redis.call('HMGET', KEYS[1], 'state', 'purpose', 'bindingKey', 'toSign', 'payload')
if not s[1] then return nil end
if s[1] ~= 'READY' then return 'ALREADY_CLAIMED' end
if s[2] ~= ARGV[1] or s[3] ~= ARGV[2] then return 'MISMATCH' end
redis.call('HSET', KEYS[1], 'state', 'CONSUMED')
return s[4]
`;

const CHALLENGE_TTL_SECONDS = 120;

export interface ChallengePayload {
  challengeId: string;
  toSign: string;
  expiresAt: Date;
}

export class CaChallengeService {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  /** 登录挑战：匿名 cookie hash + 证书指纹绑定 */
  async createLogin(p: { portal: string; browserCookieHash: string; signCertSha256: string }): Promise<ChallengePayload> {
    const certSha = p.signCertSha256; // controller 已用 normalizeToDer 正确计算——此处不再重复哈希
    const nonce = randomBytes(32).toString('hex');
    const challengeId = `ca-ch-${Date.now()}-${randomBytes(8).toString('hex')}`;
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000);
    const toSign = `LOGONDATA:${JSON.stringify({
      version: 1, purpose: 'ca-login', portal: p.portal,
      challengeId, nonce, signFingerprint: certSha,
      expiresAt: expiresAt.toISOString(),
    })}`;
    const bindingKey = `${p.portal}:${p.browserCookieHash}`;
    await this.redis.hset(`ca:challenge:v1:${challengeId}`,
      'state', 'READY', 'purpose', 'ca-login', 'bindingKey', bindingKey,
      'toSign', toSign, 'payload', JSON.stringify({ portal: p.portal }));
    await this.redis.expire(`ca:challenge:v1:${challengeId}`, CHALLENGE_TTL_SECONDS);
    return { challengeId, toSign, expiresAt };
  }

  /** 绑定/换绑/解绑/自检挑战：userId+sid 绑定 */
  async createBound(p: {
    userId: string; sid: string; purpose: 'bind' | 'replace' | 'revoke' | 'self-test';
    signCertSha256: string; encCertSha256?: string;
  }): Promise<ChallengePayload> {
    const nonce = randomBytes(32).toString('hex');
    const challengeId = `ca-ch-${Date.now()}-${randomBytes(8).toString('hex')}`;
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000);
    const toSign = JSON.stringify({
      version: 1, purpose: p.purpose, userId: p.userId,
      challengeId, nonce,
      signCertSha256: p.signCertSha256,
      ...(p.encCertSha256 ? { encCertSha256: p.encCertSha256 } : {}),
    });
    const bindingKey = `${p.userId}:${p.sid}`;
    await this.redis.hset(`ca:challenge:v1:${challengeId}`,
      'state', 'READY', 'purpose', p.purpose, 'bindingKey', bindingKey,
      'toSign', toSign, 'payload', JSON.stringify({ userId: p.userId }));
    await this.redis.expire(`ca:challenge:v1:${challengeId}`, CHALLENGE_TTL_SECONDS);
    return { challengeId, toSign, expiresAt };
  }

  /** 只读取挑战 purpose（供 claim 用创建时的实际值——bind/replace 同族不同名） */
  async getPurpose(challengeId: string): Promise<string | null> {
    return this.redis.hget(`ca:challenge:v1:${challengeId}`, 'purpose');
  }

  /** 原子消费：READY → CONSUMED（一次性）。失败/超时后不可复用。 */
  async claimAndConsume(
    challengeId: string, purpose: ChallengePurpose, bindingKey: string,
  ): Promise<{ toSign: string; payload: unknown } | null> {
    const result = await this.redis.eval(CLAIM_LUA, 1,
      `ca:challenge:v1:${challengeId}`, purpose, bindingKey);
    if (result === null || result === undefined) return null;       // 不存在/过期
    if (result === 'ALREADY_CLAIMED') return null;                   // 已消费
    if (result === 'MISMATCH') return null;                          // purpose/binding 不符
    // Lua 返回 toSign；payload 需另取（Lua 只返 toSign——payload 在 hash 中）
    const payloadStr = result as string; // Lua 只返 toSign 字段
    return { toSign: payloadStr, payload: null }; // payload 简化——需要时另取
  }
}
