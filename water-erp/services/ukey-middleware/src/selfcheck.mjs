/* =================================================================
   全链自验(spec §9):随机端口起服务 → 双盾 → 计数 → 锁死 → PUK
   → 签名反验 → SM2 回环 → 拔盾/放回。node:assert 全绿即退出 0。
   运行:cd services/ukey-middleware && node src/selfcheck.mjs
   ================================================================= */
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createRequire } from 'node:module';
import { startServer } from './server.mjs';
import { issueShield, unblockShield } from './shield.mjs';

const require = createRequire(import.meta.url);
const { sm2 } = require('sm-crypto');
const hexToBytes = (h) => Array.from({ length: h.length / 2 }, (_, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16));

const slotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ukey-selfcheck-'));
const srv = await startServer({ port: 0, slotDir });
const base = `http://127.0.0.1:${srv.port}`;
const get = (p) => fetch(base + p).then((r) => r.json());
// 简报缺陷修正:原 helper 裸返 Response,而 ②③④⑤ 断言读体字段(.unlocked/.sig/.plain)、④⑤⑥ 读 .status——
// 改返 { status, ...体 },状态码与体字段两用(Response 自身只读 getter 不可混入)。
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));

try {
  // ① 双盾发行(不同 PIN,验证多盾独立)
  const a = await issueShield({ cn: '甲公司', pin: '123456', slotDir });
  const b = await issueShield({ cn: '乙公司', pin: '654321', slotDir });
  console.log('① 发行双盾', a.shield.shieldId, b.shield.shieldId);
  assert.equal((await get('/health')).shields, 2);

  // ② 全错 PIN:两盾各扣 1
  const wrong = await post('/session/unlock', { pin: '000000' });
  assert.equal(wrong.unlocked.length, 0);
  assert.deepEqual(wrong.failed.map((f) => f.retryLeft), [5, 5]);

  // ③ 甲 PIN 只解锁甲(乙再扣 1 → 4)
  const part = await post('/session/unlock', { pin: '123456' });
  assert.deepEqual(part.unlocked, [a.shield.shieldId]);
  assert.equal(part.failed.find((f) => f.shieldId === b.shield.shieldId).retryLeft, 4);

  // ④ 乙未解锁签名 → 403;甲签名可公钥验签;SM2 加解密回环
  const guard = await post('/sign', { certSn: b.shield.certSn, data: 'x' });
  assert.equal(guard.status, 403);
  const msg = 'canonical-envelope-hash-demo';
  const s = await post('/sign', { certSn: a.shield.certSn, data: msg });
  assert.equal(sm2.doVerifySignature(msg, s.sig, a.shield.publicKey, { hash: true }), true);
  const dekHex = 'cd'.repeat(24);
  const cipher = sm2.doEncrypt(hexToBytes(dekHex), a.shield.publicKey, 1);
  assert.equal((await post('/sm2/decrypt', { certSn: a.shield.certSn, cipher })).plain, dekHex);
  console.log('②③④ 计数/守卫/签名验签/SM2 回环 全通过');

  // ⑤ 乙连错 4 次锁死(4→0)→ 423;错 PUK 拒;正 PUK 解锁后乙 PIN 可用
  for (let i = 0; i < 4; i++) await post('/session/unlock', { pin: '000000' });
  assert.equal((await post('/sign', { certSn: b.shield.certSn, data: 'x' })).status, 423);
  assert.equal((await unblockShield({ slotDir, shieldId: b.shield.shieldId, puk: 'WRONGPUK000' })).ok, false);
  assert.equal((await unblockShield({ slotDir, shieldId: b.shield.shieldId, puk: b.puk })).ok, true);
  const bUnlock = await post('/session/unlock', { pin: '654321' });
  assert.deepEqual(bUnlock.unlocked, [b.shield.shieldId]);
  console.log('⑤ 锁死 → PUK 解锁 全通过');

  // ⑥ 拔盾(移文件)→ 404;放回恢复
  const file = path.join(slotDir, `${b.shield.shieldId}.ukey`);
  fs.renameSync(file, file + '.bak');
  assert.equal((await post('/sign', { certSn: b.shield.certSn, data: 'x' })).status, 404);
  assert.equal((await get('/health')).shields, 1);
  fs.renameSync(file + '.bak', file);
  assert.equal((await post('/sign', { certSn: b.shield.certSn, data: 'x' })).status, 200);
  console.log('⑥ 拔盾/放回 全通过');

  // ⑦ 全员上锁端点
  await post('/session/lock', {});
  assert.equal((await get('/health')).unlocked, 0);
  console.log('⑦ 手动上锁 全通过');
  console.log('\n✓ selfcheck 全链通过(15 项断言)');
} finally {
  srv.close();
  fs.rmSync(slotDir, { recursive: true, force: true });
}
