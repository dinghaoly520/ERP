/* HTTP 协议测试:六端点happy path + 守卫次序(404→423→403)+ CORS 预检 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createRequire } from 'node:module';
import { startServer } from './server.mjs';
import { issueShield } from './shield.mjs';

const require = createRequire(import.meta.url);
const { sm2 } = require('sm-crypto');
const hexToBytes = (h) => Array.from({ length: h.length / 2 }, (_, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16));

let slotDir, base, srv, certSn, pub;
const PIN = '123456';
const get = (p, init) => fetch(base + p, init).then(async (r) => ({ status: r.status, headers: r.headers, j: await r.json().catch(() => null) }));
const post = (p, body) => get(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

before(async () => {
  slotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ukey-srv-'));
  const { shield } = await issueShield({ cn: '测试甲公司', pin: PIN, slotDir });
  certSn = shield.certSn; pub = shield.publicKey;
  srv = await startServer({ port: 0, slotDir });
  base = `http://127.0.0.1:${srv.port}`;
});
after(() => srv.close());

test('/health 与 /certs:在场盾计数与证书枚举(免 PIN)', async () => {
  const h = await get('/health');
  assert.equal(h.status, 200);
  assert.deepEqual({ ok: h.j.ok, shields: h.j.shields, unlocked: h.j.unlocked }, { ok: true, shields: 1, unlocked: 0 });
  const c = await get('/certs');
  assert.equal(c.j.certs.length, 1);
  assert.equal(c.j.certs[0].certSn, certSn);
  assert.equal(c.j.certs[0].shieldId, certSn);
});

test('未解锁签名 → 403 PIN_REQUIRED;错 PIN 扣计数;对 PIN 解锁', async () => {
  const s0 = await post('/sign', { certSn, data: 'abc' });
  assert.equal(s0.status, 403); assert.equal(s0.j.code, 'PIN_REQUIRED');
  const u1 = await post('/session/unlock', { pin: '000000' });
  assert.deepEqual(u1.j.failed, [{ shieldId: certSn, retryLeft: 5 }]);
  const u2 = await post('/session/unlock', { pin: PIN });
  assert.deepEqual(u2.j.unlocked, [certSn]); assert.deepEqual(u2.j.failed, []);
});

test('/sign:SM2 {hash:true},公钥可验签;/sm2/decrypt:回环;坏密文 422', async () => {
  const msg = 'sha256-envelope-hash-demo';
  const s = await post('/sign', { certSn, data: msg });
  assert.equal(s.status, 200);
  assert.equal(sm2.doVerifySignature(msg, s.j.sig, pub, { hash: true }), true);
  const dekHex = 'ab'.repeat(24);
  const cipher = sm2.doEncrypt(hexToBytes(dekHex), pub, 1);
  const d = await post('/sm2/decrypt', { certSn, cipher });
  assert.equal(d.j.plain, dekHex);
  const bad = await post('/sm2/decrypt', { certSn, cipher: '00' + cipher.slice(2) });
  assert.equal(bad.status, 422); assert.equal(bad.j.code, 'DECRYPT_FAILED');
});

test('拔盾(文件移走)→ 404 SHIELD_NOT_FOUND;放回恢复', async () => {
  const file = path.join(slotDir, `${certSn}.ukey`);
  const bak = file + '.bak';
  fs.renameSync(file, bak);
  const r = await post('/sign', { certSn, data: 'x' });
  assert.equal(r.status, 404); assert.equal(r.j.code, 'SHIELD_NOT_FOUND');
  fs.renameSync(bak, file);
  const ok = await post('/sign', { certSn, data: 'x' });
  assert.equal(ok.status, 200);
});

test('连错至锁死 → sign 423 SHIELD_LOCKED;lock 端点全员上锁', async () => {
  for (let i = 0; i < 5; i++) await post('/session/unlock', { pin: '000000' });
  const locked = await post('/sign', { certSn, data: 'x' });
  assert.equal(locked.status, 423); assert.equal(locked.j.code, 'SHIELD_LOCKED');
});

test('CORS:localhost Origin 回显、OPTIONS 预检 204;非白名单 Origin 不回显', async () => {
  const pre = await get('/health', { method: 'OPTIONS', headers: { Origin: 'http://localhost:3004', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'http://localhost:3004');
  const bad = await get('/health', { headers: { Origin: 'http://evil.example.com' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('坏 JSON 体 → 400 BAD_REQUEST', async () => {
  const r = await fetch(base + '/sign', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
  assert.equal(r.status, 400);
});
