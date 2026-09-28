/* =================================================================
   bindCertWithPop — 绑定流 PoP 化（challenge → 盾内签名 → 带证明提交）
   对应后端 b43c77e4（GET profile/cert/challenge + bindCert popNonce/popSignature）
   ================================================================= */
import assert from "node:assert/strict";
import { test } from "node:test";
import { bindCertWithPop } from "../ukey-pop-bind";

const CERT = {
  certSn: "SHD-TEST-01",
  certDn: "CN=四川水发建设有限公司,O=蜀水云采模拟CA,C=CN",
  publicKey: `04${"ab".repeat(64)}`,
  alg: "SM2" as const,
  notBefore: "2026-09-01T00:00:00.000Z",
  notAfter: "2026-11-01T00:00:00.000Z",
};

function makeDeps() {
  const calls = { challenge: 0, sign: [] as Array<[string, string]>, bindPayloads: [] as Array<Record<string, unknown>> };
  const nonce = "a".repeat(64);
  const sig = "b".repeat(128);
  let signErr: Error | null = null;
  let challengeErr: Error | null = null;
  const api = {
    certBindChallenge: async () => {
      if (challengeErr) throw challengeErr;
      calls.challenge += 1;
      return { nonce, expiresIn: 300 };
    },
    bindCert: async (data: Record<string, unknown>) => {
      calls.bindPayloads.push(data);
      return { cert: { id: "cert-1" } };
    },
  };
  const adapter = {
    sign: async (certSn: string, msg: string) => {
      if (signErr) throw signErr;
      calls.sign.push([certSn, msg]);
      return sig;
    },
  };
  return { api, adapter, calls, nonce, sig, failSign: (e: Error) => (signErr = e), failChallenge: (e: Error) => (challengeErr = e) };
}

test("happy path：取挑战 → 盾内签名(certSn, nonce) → 声明字段 + popNonce/popSignature 提交", async () => {
  const { api, adapter, calls, nonce, sig } = makeDeps();
  await bindCertWithPop(api, adapter, CERT);
  assert.equal(calls.challenge, 1);
  assert.deepEqual(calls.sign, [["SHD-TEST-01", nonce]]);
  assert.equal(calls.bindPayloads.length, 1);
  const p = calls.bindPayloads[0];
  assert.equal(p.certSn, "SHD-TEST-01");
  assert.equal(p.certDn, CERT.certDn);
  assert.equal(p.publicKey, CERT.publicKey);
  assert.equal(p.alg, "SM2");
  assert.equal(p.notBefore, CERT.notBefore);
  assert.equal(p.expiresAt, CERT.notAfter);
  assert.equal(p.popNonce, nonce);
  assert.equal(p.popSignature, sig);
});

test("可选有效期缺省时不传字段", async () => {
  const { api, adapter, calls } = makeDeps();
  const { notBefore: _nb, notAfter: _na, ...bare } = CERT;
  await bindCertWithPop(api, adapter, bare);
  const p = calls.bindPayloads[0];
  assert.equal(p.notBefore, undefined);
  assert.equal(p.expiresAt, undefined);
  assert.ok(p.popNonce);
});

test("rawCert（真盾轨 DER）在场时透传，缺省不传", async () => {
  const withRaw = { ...CERT, rawCert: "MIIB..." };
  const { api, adapter, calls } = makeDeps();
  await bindCertWithPop(api, adapter, withRaw);
  assert.equal(calls.bindPayloads[0].rawCert, "MIIB...");
  const { api: api2, adapter: adapter2, calls: calls2 } = makeDeps();
  await bindCertWithPop(api2, adapter2, CERT);
  assert.equal(calls2.bindPayloads[0].rawCert, undefined);
});

test("盾内签名失败（盾拔出/会话超时）→ 上抛且不提交绑定", async () => {
  const { api, adapter, calls, failSign } = makeDeps();
  failSign(new Error("U盾中间件连接失败或已退出"));
  await assert.rejects(() => bindCertWithPop(api, adapter, CERT), /U盾中间件/);
  assert.equal(calls.bindPayloads.length, 0);
});

test("挑战获取失败 → 上抛且不签名不提交", async () => {
  const { api, adapter, calls, failChallenge } = makeDeps();
  failChallenge(new Error("网络异常"));
  await assert.rejects(() => bindCertWithPop(api, adapter, CERT), /网络异常/);
  assert.equal(calls.sign.length, 0);
  assert.equal(calls.bindPayloads.length, 0);
});
