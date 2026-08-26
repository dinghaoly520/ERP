/* 盾介质文件单测:发行形状 / PIN 计数与锁死 / PUK 解锁与重设 PIN / 目录扫描 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { issueShield, listShields, findShieldByCertSn, unlockShieldFile, unblockShield } from './shield.mjs';

const require = createRequire(import.meta.url);
const { sm2 } = require('sm-crypto');

const tmpSlot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ukey-shield-'));

test('issueShield:文件形状与持久化(0600,私钥仅密文)', async () => {
  const slotDir = tmpSlot();
  const { shield, puk } = await issueShield({ cn: '四川水发建设有限公司', pin: '123456', slotDir });
  assert.match(shield.shieldId, /^SHD-[0-9A-F]{8}$/);
  assert.equal(shield.certSn, shield.shieldId);
  assert.equal(shield.certDn, 'CN=四川水发建设有限公司,O=蜀水云采模拟CA,C=CN');
  assert.match(shield.publicKey, /^04[0-9a-fA-F]{128}$/);
  assert.match(puk, /^[A-Z2-9]{12}$/);
  assert.equal(shield.pinPolicy.retryLeft, 6);
  assert.ok(shield.encPrivKey.ct && shield.encPrivKeyPuk.ct);
  const raw = fs.readFileSync(path.join(slotDir, `${shield.shieldId}.ukey`), 'utf8');
  assert.ok(!raw.includes(puk), 'PUK 不得明文落盘(只存 pukHash)');
  assert.ok(!raw.includes('123456'), 'PIN 不得明文落盘');
  assert.equal((fs.statSync(path.join(slotDir, `${shield.shieldId}.ukey`)).mode & 0o777), 0o600);
});

test('unlockShieldFile:错 PIN 扣计数、6 次锁死、锁死后正 PIN 也拒', async () => {
  const slotDir = tmpSlot();
  const { shield } = await issueShield({ cn: '甲公司', pin: '123456', slotDir });
  for (let i = 0; i < 6; i++) {
    const r = await unlockShieldFile(shield, '000000', slotDir);
    assert.equal(r.ok, false);
    assert.equal(r.retryLeft, 5 - i);
  }
  assert.equal(shield.pinPolicy.locked, true);
  const lockedTry = await unlockShieldFile(shield, '123456', slotDir);
  assert.equal(lockedTry.ok, false, '锁死后正确 PIN 也不放行');
  assert.equal(lockedTry.locked, true);
});

test('unlockShieldFile:正确 PIN 返回私钥且不扣计数', async () => {
  const slotDir = tmpSlot();
  const { shield } = await issueShield({ cn: '乙公司', pin: '654321', slotDir });
  const r = await unlockShieldFile(shield, '654321', slotDir);
  assert.equal(r.ok, true);
  assert.match(r.privKeyHex, /^[0-9a-fA-F]{64}$/);
  assert.equal(r.retryLeft, 6);
});

test('unblockShield:错 PUK 拒;正 PUK 重置计数;--new-pin 重设后旧 PIN 失效新 PIN 生效', async () => {
  const slotDir = tmpSlot();
  const { shield, puk } = await issueShield({ cn: '丙公司', pin: '111111', slotDir });
  for (let i = 0; i < 6; i++) await unlockShieldFile(shield, '000000', slotDir);
  const bad = await unblockShield({ slotDir, shieldId: shield.shieldId, puk: 'WRONGPUK000' });
  assert.equal(bad.ok, false);
  const r1 = await unblockShield({ slotDir, shieldId: shield.shieldId, puk, newPin: '222222' });
  assert.equal(r1.ok, true);
  // unblockShield 重写磁盘文件后,内存 shield 快照已过期——盾文件即真相,须重扫后再验
  const fresh = findShieldByCertSn(slotDir, shield.shieldId);
  assert.equal(fresh.pinPolicy.retryLeft, 6, '正 PUK 重置计数');
  assert.equal(fresh.pinPolicy.locked, false);
  const oldPin = await unlockShieldFile(fresh, '111111', slotDir);
  assert.equal(oldPin.ok, false, 'PUK 通道重设 PIN 后旧 PIN 不再可用');
  const newPin = await unlockShieldFile(fresh, '222222', slotDir);
  assert.equal(newPin.ok, true);
});

test('listShields:扫描槽目录全部 .ukey 文件', async () => {
  const slotDir = tmpSlot();
  await issueShield({ cn: '丁公司', pin: '123456', slotDir });
  await issueShield({ cn: '戊公司', pin: '123456', slotDir });
  const all = listShields(slotDir);
  assert.equal(all.length, 2);
  assert.ok(all.every((s) => s.certSn.startsWith('SHD-')));
});
