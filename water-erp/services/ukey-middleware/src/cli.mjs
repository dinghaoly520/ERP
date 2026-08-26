#!/usr/bin/env node
/* =================================================================
   ukeymw —— Mock U盾中间件 CLI(spec §8)

   serve   启动中间件(默认 127.0.0.1:17999)
   issue   模拟 CA 柜台办证:生成盾文件并打印 PUK(仅此一次!)
   list    在场盾清单(证书信息 + 锁定状态 + 剩余 PIN 次数)
   unblock PUK 解锁(锁死后),可顺带 --new-pin 重设口令
   ================================================================= */
import readline from 'node:readline/promises';
import { startServer } from './server.mjs';
import { issueShield, listShields, unblockShield, defaultSlotDir } from './shield.mjs';

function parseFlags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out[a.slice(2)] = next; i++; }
      else out[a.slice(2)] = true;
    } else out._.push(a);
  }
  return out;
}

const HELP = `ukeymw — Mock U盾中间件(协议见 docs/superpowers/specs/2026-08-26-mock-ukey-middleware-design.md §5)
  serve   [--port 17999] [--slot-dir ~/.shuidi-ukey/slots]
  issue   --cn <企业名> [--pin 123456] [--slot-dir …]
  list    [--slot-dir …]
  unblock --shield <SHD-XXXXXXXX> [--puk <PUK>] [--new-pin <PIN>] [--slot-dir …]
环境变量:UKEY_SLOT_DIR / UKEY_MW_PORT / UKEY_MW_BIND / UKEY_MW_SESSION_TTL / UKEY_MW_ALLOW_ORIGIN`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseFlags(rest);
  const slotDir = args['slot-dir'] ?? defaultSlotDir();

  if (cmd === 'serve') {
    const srv = await startServer({ port: Number(args.port ?? 0) || undefined, slotDir });
    console.log(`[ukeymw] 盾槽 ${slotDir}`);
    console.log(`[ukeymw] 中间件已启动 → http://127.0.0.1:${srv.port}  (Ctrl-C 退出;插拔盾 = 移动槽目录内 .ukey 文件)`);
    process.on('SIGINT', () => { console.log('\n[ukeymw] 已停止(会话全清,重启后须重新开锁)'); srv.close(); process.exit(0); });
    return;
  }
  if (cmd === 'issue') {
    const { shield, puk } = await issueShield({ cn: args.cn, pin: args.pin ?? '123456', slotDir });
    console.log(`已发行盾文件:${slotDir}/${shield.shieldId}.ukey`);
    console.log(`  证书序列号 ${shield.certSn}`);
    console.log(`  证书主体   ${shield.certDn}`);
    console.log(`  默认 PIN   ${args.pin ?? '123456'}`);
    console.log(`  管理码 PUK ${puk}   ← 仅此一次显示,请抄录妥善保管(锁死后解锁用)`);
    return;
  }
  if (cmd === 'list') {
    const shields = listShields(slotDir);
    if (shields.length === 0) { console.log(`槽目录 ${slotDir} 内无盾(=未插盾)。办证:ukeymw issue --cn <企业名>`); return; }
    for (const s of shields) {
      console.log(`${s.shieldId}  ${s.pinPolicy.locked ? '🔒已锁死' : `PIN 剩余 ${s.pinPolicy.retryLeft}/${s.pinPolicy.maxRetry}`}  ${s.certDn}`);
    }
    return;
  }
  if (cmd === 'unblock') {
    if (!args.shield) { console.error('缺少 --shield <SHD-XXXXXXXX>'); process.exit(1); }
    let puk = args.puk;
    if (!puk) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      puk = (await rl.question('管理码 PUK: ')).trim();
      rl.close();
    }
    const r = await unblockShield({ slotDir, shieldId: args.shield, puk, newPin: args['new-pin'] });
    console.log(r.ok ? `已解锁 ${args.shield}${args['new-pin'] ? ' 并重设 PIN' : ''}(计数已重置)` : 'PUK 不符,解锁失败');
    process.exit(r.ok ? 0 : 1);
  }
  console.log(HELP);
}

main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
