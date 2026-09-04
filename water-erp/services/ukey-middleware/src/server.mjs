/* =================================================================
   Mock U盾中间件 HTTP 服务(spec §5)—— 模拟 CA 厂商本机驱动服务

   仅绑定 loopback(UKEY_MW_BIND,默认 127.0.0.1,勿改 0.0.0.0);
   守卫次序:找盾(404) → 锁死(423) → 会话(403) → 运算;
   每请求实时扫描槽目录(插拔即时生效);请求体上限 1MB。
   ================================================================= */
import http from 'node:http';
import { createRequire } from 'node:module';
import { listShields, findShieldByCertSn, unlockShieldFile } from './shield.mjs';
import { ShieldSessions } from './session.mjs';
import { parseEnvInt } from './env.mjs';

const require = createRequire(import.meta.url);
const { sm2 } = require('sm-crypto');

const VERSION = '1.0.0';
const BODY_LIMIT = 1024 * 1024;
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const bytesToHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const ERR = {
  BAD_REQUEST: [400, '请求参数缺失或格式错误'],
  SHIELD_NOT_FOUND: [404, '未找到 U盾(可能已拔出)'],
  PIN_REQUIRED: [403, 'U盾未解锁或会话已超时,请先开锁'],
  SHIELD_LOCKED: [423, 'U盾已锁定(PIN 错误次数超限),请使用管理码解锁'],
  DECRYPT_FAILED: [422, '解密失败:密文损坏'],
};

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  const extra = (process.env.UKEY_MW_ALLOW_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!LOCAL_ORIGIN.test(origin) && !extra.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'Origin',
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > BODY_LIMIT) { reject(Object.assign(new Error('body too large'), { code: 'BAD_REQUEST' })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try { const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(parsed === null ? {} : parsed); }
      catch { reject(Object.assign(new Error('bad json'), { code: 'BAD_REQUEST' })); }
    });
    req.on('error', reject);
  });
}

export function startServer({ port = parseEnvInt('UKEY_MW_PORT', 17999), host = process.env.UKEY_MW_BIND ?? '127.0.0.1', slotDir, sessions = new ShieldSessions() } = {}) {
  const server = http.createServer(async (req, res) => {
    const cors = corsHeaders(req);
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...cors }); res.end(JSON.stringify(obj)); };
    const fail = (code, extra) => send(ERR[code][0], { error: ERR[code][1], code, ...extra });
    const url = new URL(req.url, 'http://x');

    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        const shields = listShields(slotDir);
        const unlockedCount = shields.filter((s) => sessions.peek(s.certSn) !== null).length;
        return send(200, { ok: true, version: VERSION, shields: shields.length, unlocked: unlockedCount, ttlSeconds: Math.round(sessions.ttlMs / 1000) });
      }
      if (req.method === 'GET' && url.pathname === '/certs') {
        const certs = listShields(slotDir).map((s) => ({ certSn: s.certSn, certDn: s.certDn, publicKey: s.publicKey, alg: s.alg, shieldId: s.shieldId }));
        return send(200, { certs });
      }
      if (req.method === 'POST' && url.pathname === '/session/unlock') {
        const body = await readBody(req);
        if (typeof body.pin !== 'string' || !body.pin) return fail('BAD_REQUEST');
        const shieldsNow = listShields(slotDir);
        if (shieldsNow.length === 0) return fail('SHIELD_NOT_FOUND'); // 拔盘后空盾槽:不得空成功(PIN 对着无物校验=假解锁)
        const unlocked = []; const failed = [];
        for (const s of shieldsNow) {
          if (s.pinPolicy.locked) { failed.push({ shieldId: s.shieldId, retryLeft: 0, locked: true }); continue; }
          const r = await unlockShieldFile(s, body.pin, slotDir);
          if (r.ok) { sessions.set(s.certSn, r.privKeyHex); unlocked.push(s.shieldId); }
          else failed.push({ shieldId: s.shieldId, retryLeft: r.retryLeft, ...(r.locked ? { locked: true } : {}) });
        }
        return send(200, { ok: true, unlocked, failed, ttlSeconds: Math.round(sessions.ttlMs / 1000) });
      }
      if (req.method === 'POST' && url.pathname === '/session/lock') {
        sessions.dropAll();
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && (url.pathname === '/sign' || url.pathname === '/sm2/decrypt')) {
        const body = await readBody(req);
        if (typeof body.certSn !== 'string' || !body.certSn) return fail('BAD_REQUEST');
        const shield = findShieldByCertSn(slotDir, body.certSn);
        if (!shield) return fail('SHIELD_NOT_FOUND');
        if (shield.pinPolicy.locked) return fail('SHIELD_LOCKED');
        const privKeyHex = sessions.get(shield.certSn);
        if (!privKeyHex) return fail('PIN_REQUIRED');
        if (url.pathname === '/sign') {
          if (typeof body.data !== 'string' || !body.data) return fail('BAD_REQUEST');
          return send(200, { sig: sm2.doSignature(body.data, privKeyHex, { hash: true }), ttlSeconds: Math.round(sessions.ttlMs / 1000) }); // 与 SignatureService 同参 {hash:true}；ttlSeconds 供前端同步倒计时
        }
        if (typeof body.cipher !== 'string' || !body.cipher) return fail('BAD_REQUEST');
        const plain = bytesToHex(sm2.doDecrypt(body.cipher, privKeyHex, 1, { output: 'array' })); // C1C3C2;失败返 '' 从不抛错
        if (!plain) return fail('DECRYPT_FAILED');
        return send(200, { plain, ttlSeconds: Math.round(sessions.ttlMs / 1000) });
      }
      return send(404, { error: 'not found', code: 'NOT_FOUND' });
    } catch (e) {
      if (e?.code && ERR[e.code]) return fail(e.code);
      return send(500, { error: String(e?.message ?? e), code: 'INTERNAL' });
    }
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, port: server.address().port, close: () => { sessions.dropAll(); server.close(); } }));
  });
}
