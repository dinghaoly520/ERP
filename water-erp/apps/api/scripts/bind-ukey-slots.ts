/**
 * 种子绑盾脚本（P1 波2 Task 7：A-114 演示链路真盾化 + A-90 绑盾引导卡）
 *
 * 用途：把 mock U盾中间件槽目录（~/.shuidi-ukey/slots/*.ukey）里的盾，按盾内 CN（证书主体
 * 企业名）与 Supplier.name 精确匹配，幂等绑定 SupplierCert（certSn 唯一键）并回填
 * Supplier.sm2PublicKey——供应商门户 dualReady = !!profile.sm2PublicKey（投递页 A-90 绑盾
 * 引导卡据此切换为双信封投递）。
 *
 * 槽文件结构（services/ukey-middleware/src/shield.mjs · issueShield）：**明文 JSON**，
 * { version, shieldId, certSn(=shieldId), certDn: 'CN=<企业名>,O=蜀水云采模拟CA,C=CN',
 *   publicKey(04 开头 SM2 hex), alg, … }——仅私钥（encPrivKey/encPrivKeyPuk）是加密的，
 * 本脚本只读明文字段（certSn/CN/publicKey），无需解密。坏文件（截断/非 JSON/数组体）warn 跳过。
 *
 * 匹配与写库语义（幂等）：
 *   - supplier.name === cn 精确匹配（name 非唯一列）：0 家 → 「有盾无供应商」告警跳过；
 *     >1 家 → 重名歧义告警跳过（不猜）；
 *   - supplierCert 按 certSn 幂等 upsert：
 *       新建  { supplierId, certSn, certDn: `CN=<企业名>`, publicKey, alg: 'SM2' }
 *       更新  { publicKey, bindingStatus: 'ACTIVE', revokedAt: null }（REVOKED 复活；certDn
 *              不动——运行时经 bindCert 绑过的行是完整 DN，改写会制造无意义漂移）
 *     certSn 已被「其他供应商」占用 → 告警跳过（对齐运行时 bindCert 的 CERT_SN_EXISTS 语义）；
 *   - supplier.sm2PublicKey 与盾 publicKey 不同才写——状态已达标时零写入（连跑两次输出/库均不变）；
 *   - 不做运行时 bindCert 的「一证一 ACTIVE 旧证吊销」：演示种子一人一盾；换证走门户换证流程。
 *
 * 输出三张清单（任何清单非空不影响退出码，恒 0）：
 *   1. 绑定动作表（盾号 / CN→供应商 / 动作）；
 *   2. 有盾无供应商（CN 匹配不到唯一 supplier）；
 *   3. 有供应商无盾（绑定悬挂）：sm2PublicKey 或 ACTIVE 证书在库、但槽目录无对应盾文件
 *      ——含 e2e 冒烟残留（MOCK-*），演示前可据此清理或忽略。
 *
 * 用法：
 *   cd apps/api && npx tsx scripts/bind-ukey-slots.ts            # 实跑（幂等写库）
 *   cd apps/api && npx tsx scripts/bind-ukey-slots.ts --dry-run  # 只打印，零写入
 *
 * 槽目录覆写：UKEY_SLOT_DIR=/path/to/slots（缺省 ~/.shuidi-ukey/slots）。
 * 环境：脚本自行加载 apps/api/.env（DATABASE_URL），从 water-erp/ 根或 apps/api/ 目录运行均可。
 */
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// ── .env 加载（先于 PrismaClient 实例化，dotenv 语义：不覆盖已有）──
function loadEnvFile(candidates: string[]): string | null {
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
    return p;
  }
  return null;
}

const scriptDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
const loadedEnv = loadEnvFile([
  join(process.cwd(), 'apps', 'api', '.env'), // 从 water-erp/ 根运行
  join(process.cwd(), '.env'), // 从 apps/api 运行
  join(scriptDir, '..', '.env'), // 脚本自身位置兜底
]);

const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes('--dry-run');
const slotDir = process.env.UKEY_SLOT_DIR ?? join(homedir(), '.shuidi-ukey', 'slots');

const bar = '─'.repeat(96);

/** 定宽/超长截断（中文按 1 列计，对齐为近似即可读） */
function pad(s: string, w: number): string {
  return s.length >= w ? s.slice(0, Math.max(0, w - 1)) + '…' : s + ' '.repeat(w - s.length);
}

interface SlotShield {
  file: string;
  certSn: string;
  cn: string;
  publicKey: string;
}

/** 读单个盾文件（镜像 shield.mjs readShieldFile：坏文件 warn 跳过，不砖整个脚本） */
function readSlotShield(file: string): SlotShield | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad shield shape');
    const certSn: unknown = parsed.certSn ?? parsed.shieldId;
    const certDn: unknown = parsed.certDn;
    const publicKey: unknown = parsed.publicKey;
    if (typeof certSn !== 'string' || !certSn || typeof publicKey !== 'string' || !publicKey) {
      throw new Error('missing certSn/publicKey');
    }
    // CN 取 certDn 首个 'CN=' 段（issueShield 恒为 `CN=<企业名>,O=…,C=CN`）
    const cnMatch = typeof certDn === 'string' ? certDn.match(/(?:^|,)\s*CN=([^,]*)/) : null;
    const cn = cnMatch?.[1]?.trim();
    if (!cn) throw new Error(`cannot extract CN from certDn: ${String(certDn)}`);
    return { file, certSn, cn, publicKey };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[bind-ukey] 跳过无法解析的盾文件 ${file}: ${msg}`);
    return null;
  }
}

async function main(): Promise<void> {
  console.log(bar);
  console.log(`U盾种子绑定（P1 波2 Task 7）｜模式: ${DRY_RUN ? 'DRY-RUN（只打印，零写入）' : '实跑（幂等写库）'}`);
  console.log(`槽目录: ${slotDir}${process.env.UKEY_SLOT_DIR ? '（UKEY_SLOT_DIR）' : '（缺省）'}｜.env: ${loadedEnv ?? '未找到'}`);
  console.log(bar);

  // ── 1. 扫槽 ──
  if (!existsSync(slotDir)) {
    console.log(`槽目录不存在，无盾可绑。先发盾：node services/ukey-middleware/src/cli.mjs issue --cn <企业名> --pin 123456`);
    return;
  }
  const slots = readdirSync(slotDir)
    .filter((f) => f.endsWith('.ukey'))
    .map((f) => {
      const file = join(slotDir, f);
      // 非普通文件（目录/断链软链）跳过——对齐 shield.mjs listShields 语义
      let isFile = false;
      try {
        isFile = statSync(file).isFile();
      } catch {
        isFile = false;
      }
      return isFile ? readSlotShield(file) : null;
    })
    .filter((s): s is SlotShield => s !== null);
  console.log(`扫描到 ${slots.length} 个盾文件。`);

  // ── 2. 供匹配的库内数据 ──
  const suppliers = await prisma.supplier.findMany({ select: { id: true, name: true, sm2PublicKey: true } });
  const suppliersByName = new Map<string, typeof suppliers>();
  for (const s of suppliers) {
    const bucket = suppliersByName.get(s.name) ?? [];
    bucket.push(s);
    suppliersByName.set(s.name, bucket);
  }
  const activeCerts = await prisma.supplierCert.findMany({
    where: { bindingStatus: 'ACTIVE' },
    select: { supplierId: true, certSn: true },
  });

  const slotCertSns = new Set(slots.map((s) => s.certSn));
  const slotPublicKeys = new Set(slots.map((s) => s.publicKey));

  // ── 3. 绑定主循环 ──
  type Row = { certSn: string; cn: string; supplier: string; action: string };
  const rows: Row[] = [];
  const unmatched: { certSn: string; cn: string; reason: string }[] = [];
  const matchedSupplierIds = new Set<string>();
  let created = 0;
  let updated = 0;
  let noop = 0;
  let skipped = 0;
  let supplierWrites = 0;

  for (const slot of slots) {
    const candidates = suppliersByName.get(slot.cn) ?? [];
    if (candidates.length === 0) {
      unmatched.push({ certSn: slot.certSn, cn: slot.cn, reason: '库内无同名供应商（supplier.name 精确匹配）' });
      skipped++;
      continue;
    }
    if (candidates.length > 1) {
      unmatched.push({ certSn: slot.certSn, cn: slot.cn, reason: `同名供应商 ${candidates.length} 家（歧义，不猜）` });
      skipped++;
      continue;
    }
    const supplier = candidates[0];
    matchedSupplierIds.add(supplier.id);

    const existing = await prisma.supplierCert.findUnique({ where: { certSn: slot.certSn } });
    if (existing && existing.supplierId !== supplier.id) {
      const owner = suppliers.find((s) => s.id === existing.supplierId);
      rows.push({
        certSn: slot.certSn,
        cn: slot.cn,
        supplier: supplier.name,
        action: `跳过：certSn 已绑定其他供应商（${owner?.name ?? existing.supplierId}）`,
      });
      skipped++;
      continue;
    }

    const sm2NeedsWrite = supplier.sm2PublicKey !== slot.publicKey;
    const actions: string[] = [];

    if (
      existing &&
      existing.publicKey === slot.publicKey &&
      existing.bindingStatus === 'ACTIVE' &&
      existing.revokedAt === null &&
      !sm2NeedsWrite
    ) {
      rows.push({ certSn: slot.certSn, cn: slot.cn, supplier: supplier.name, action: '无变化（幂等，零写入）' });
      noop++;
      continue; // 状态已达标：cert/supplier 均不写，连跑 updatedAt 不漂
    }

    if (!existing) {
      if (!DRY_RUN) {
        await prisma.supplierCert.create({
          data: {
            supplierId: supplier.id,
            certSn: slot.certSn,
            certDn: `CN=${slot.cn}`,
            publicKey: slot.publicKey,
            alg: 'SM2',
          },
        });
      }
      created++;
      actions.push(`${DRY_RUN ? '将创建' : '已创建'} SupplierCert（alg=SM2）`);
    } else {
      const parts: string[] = [];
      if (existing.publicKey !== slot.publicKey) parts.push('publicKey 同步');
      if (existing.bindingStatus !== 'ACTIVE' || existing.revokedAt !== null) parts.push('REVOKED 复活');
      if (!DRY_RUN) {
        await prisma.supplierCert.update({
          where: { certSn: slot.certSn },
          data: { publicKey: slot.publicKey, bindingStatus: 'ACTIVE', revokedAt: null },
        });
      }
      updated++;
      actions.push(`${DRY_RUN ? '将更新' : '已更新'} SupplierCert（${parts.join(' / ') || '幂等重写'}）`);
    }

    if (sm2NeedsWrite) {
      if (!DRY_RUN) {
        await prisma.supplier.update({ where: { id: supplier.id }, data: { sm2PublicKey: slot.publicKey } });
      }
      supplierWrites++;
      actions.push(`${DRY_RUN ? '将回填' : '已回填'} Supplier.sm2PublicKey（dualReady 置位）`);
    } else {
      actions.push('sm2PublicKey 已一致，无需回填');
    }
    rows.push({ certSn: slot.certSn, cn: slot.cn, supplier: supplier.name, action: actions.join('；') });
  }

  // ── 4. 清单输出 ──
  console.log('\n── 绑定动作表 ──');
  if (rows.length === 0) console.log('（无动作）');
  else {
    console.log([pad('盾号(certSn)', 18), pad('CN→供应商', 42), '动作'].join(' '));
    for (const r of rows) console.log([pad(r.certSn, 18), pad(`${r.cn} → ${r.supplier}`, 42), r.action].join(' '));
  }

  console.log('\n── 有盾无供应商（跳过，不写库）──');
  if (unmatched.length === 0) console.log('（无）');
  else for (const u of unmatched) console.log(` - ${u.certSn}｜CN=${u.cn}｜${u.reason}`);

  // ── 5. 有供应商无盾（绑定悬挂）──
  const activeCertSnsBySupplier = new Map<string, string[]>();
  for (const c of activeCerts) {
    const bucket = activeCertSnsBySupplier.get(c.supplierId) ?? [];
    bucket.push(c.certSn);
    activeCertSnsBySupplier.set(c.supplierId, bucket);
  }
  const dangling: { name: string; sm2: boolean; certSns: string[] }[] = [];
  for (const s of suppliers) {
    const certSns = activeCertSnsBySupplier.get(s.id) ?? [];
    const hasBinding = s.sm2PublicKey != null || certSns.length > 0;
    if (!hasBinding) continue; // 从未绑盾的供应商不属于「悬挂」
    const covered = certSns.some((sn) => slotCertSns.has(sn)) || (s.sm2PublicKey != null && slotPublicKeys.has(s.sm2PublicKey));
    if (!covered) dangling.push({ name: s.name, sm2: s.sm2PublicKey != null, certSns });
  }
  dangling.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  console.log('\n── 有供应商无盾（绑定悬挂：库内有绑定痕迹、槽目录无对应盾文件）──');
  if (dangling.length === 0) console.log('（无）');
  else {
    for (const d of dangling) {
      console.log(` - ${d.name}｜ACTIVE 证书: ${d.certSns.length ? d.certSns.join(', ') : '无'}${d.sm2 ? '｜sm2PublicKey 已置（dualReady=true 但无盾可用）' : ''}`);
    }
  }

  console.log(`\n${bar}`);
  console.log(
    `汇总：盾 ${slots.length}｜匹配绑定 ${matchedSupplierIds.size}（新建 ${created} / 更新 ${updated} / 无变化 ${noop} / 跳过 ${skipped}）` +
      `｜sm2 回填 ${supplierWrites}｜有盾无供应商 ${unmatched.length}｜有供应商无盾（悬挂）${dangling.length}` +
      `｜模式 ${DRY_RUN ? 'DRY-RUN（以上均未写库）' : '实跑（已写库）'}`,
  );
  console.log(bar);
}

main()
  .catch((e) => {
    console.error('[bind-ukey] 执行失败:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
