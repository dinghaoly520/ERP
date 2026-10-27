/**
 * 存量留痕串码治理（2026-10-27，配合 bid.abortBidProject / pm.terminateProject 写侧修复）：
 *   1. 「操作人 <裸 userId(cuid)>」→「操作人 <姓名>」（displayName 优先，查无该用户则保留原样并计数）
 *   2. 裸 ISO 时间戳（2026-10-26T03:32:07.193Z）→ 本地可读（2026-10-26 11:32，服务器时区）
 * 作用面：BidProject.riskNote + BidSupervisionLog.result（流标留痕两落点，文本同源）。
 * 幂等：替换目标不存在即跳过；重复运行第二遍零改动。
 * 运行：cd apps/api && npx tsx scripts/fix-risknote-actor-names.ts [--dry]
 */
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ── .env 加载（DATABASE_URL 必需；tsconfig 排除 scripts/，本文件独立类型检查）──
function loadEnvFile(candidates: string[]): string | null {
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
      if (process.env[m[1]] === undefined) process.env[m[1]] = value; // dotenv 语义：不覆盖已有
    }
    return p;
  }
  return null;
}
const scriptDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
if (!loadEnvFile([join(process.cwd(), 'apps', 'api', '.env'), join(scriptDir, '..', '.env')])) {
  console.error('未找到 apps/api/.env（DATABASE_URL 必需）');
  process.exit(1);
}

const prisma = new PrismaClient();
const dry = process.argv.includes('--dry');
const CUID = /c[a-z0-9]{20,}/g;
const ISO = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):\d{2}(?:\.\d+)?Z/g;

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO → 本地时区可读；无时区语义的裸 ISO 按 UTC 解读（服务器本地时区渲染） */
function fmtIso(iso: string): string | null {
  const d = new Date(`${iso.endsWith('Z') ? iso : `${iso}Z`}`);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function main() {
  // 姓名映射：一次拉全量（用户量级千内，内存安全）
  const users = await prisma.user.findMany({ select: { id: true, displayName: true, username: true } });
  const nameOf = new Map(users.map((u) => [u.id, (u.displayName?.trim() || u.username) ?? u.username]));

  let replacedNames = 0;
  let replacedTimes = 0;
  let unresolvedIds = new Set<string>();

  const rewrite = (text: string): string => {
    let out = text.replace(new RegExp(`操作人 (${CUID.source})`, 'g'), (_m, id: string) => {
      const name = nameOf.get(id);
      if (!name) { unresolvedIds.add(id); return _m; } // 查无此用户：保留原样，报告人工处理
      replacedNames++;
      return `操作人 ${name}`;
    });
    out = out.replace(ISO, (m) => {
      const t = fmtIso(m);
      if (!t) return m;
      replacedTimes++;
      return t;
    });
    return out;
  };

  const bps = await prisma.bidProject.findMany({
    where: { OR: [{ riskNote: { contains: '操作人 ' } }, { riskNote: { contains: 'T' } }] },
    select: { id: true, riskNote: true },
  });
  for (const bp of bps) {
    if (!bp.riskNote) continue;
    const next = rewrite(bp.riskNote);
    if (next !== bp.riskNote) {
      console.log(`[BidProject] ${bp.id}\n  旧: ${bp.riskNote}\n  新: ${next}`);
      if (!dry) await prisma.bidProject.update({ where: { id: bp.id }, data: { riskNote: next } });
    }
  }

  const logs = await prisma.bidSupervisionLog.findMany({
    where: { OR: [{ result: { contains: '操作人 ' } }, { result: { contains: 'T' } }] },
    select: { id: true, result: true },
  });
  for (const lg of logs) {
    if (!lg.result) continue;
    const next = rewrite(lg.result);
    if (next !== lg.result) {
      console.log(`[BidSupervisionLog] ${lg.id}`);
      if (!dry) await prisma.bidSupervisionLog.update({ where: { id: lg.id }, data: { result: next } });
    }
  }

  console.log(`\n完成${dry ? '（dry-run，未落库）' : ''}：姓名替换 ${replacedNames} 处、时间格式化 ${replacedTimes} 处`);
  if (unresolvedIds.size > 0) {
    console.log(`⚠ 查无对应用户、保留原样的 id：${[...unresolvedIds].join('、')}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
