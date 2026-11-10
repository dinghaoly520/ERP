/**
 * 一次性归一（2026-11-10 「与您相关」标记裁定，eaa6c8234）：存量站内信按新标准刷齐——
 *  标准：标记⟔收件人被点名/真参与（项目名册=受邀/已投递），广播类永不标。
 *  ① 采购邀请（SELECTION_NOTIFY）补【与您相关】前缀——逐家点名恒属定向，旧数据全无标
 *  ② 补遗双发去重：同用户同链接存在「补遗公告：」（syncAddendum 专用轨）时删
 *     「新补遗公告：」（通用发布钩子轨）——单轨化前每次发布同分钟双通知
 *  ③ 补遗参与闸：专用轨通知按项目名册复核——名册外收件人（仅获取过文件的潜在投标人，
 *     招标投标法 23 条告知对象）剥标记、文案改「您获取过」口径
 *  ④ 项目内类公告（中标/成交/合同/履约等 8 类）补标：2026-09-26 降噪前广播时代全量扇出的
 *     存量，名册内收件人补【与您相关】；名册外/公告不可解析维持不标
 *  ⑤ 保险：广播类公告通知若带标记一律剥除（当前无此类数据，幂等兜底）
 *
 * 默认干跑（只统计清单）；--execute 才实际写库。幂等可重跑；生产部署后同样执行一次。
 * 用法：cd apps/api && npx tsx scripts/normalize-notification-relevance.ts [--execute]
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

// ── .env 加载（先于 PrismaClient 实例化；dotenv 语义：不覆盖已有）──
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const prisma = new PrismaClient();
const EXECUTE = process.argv.includes('--execute');

const MARKER = '【与您相关】';
/** 与 announcement.service PROJECT_SCOPED_ANN_TYPES 同口径（项目内类=名册定向+标记） */
const PROJECT_SCOPED = new Set([
  'ADDENDUM', 'CLARIFY_NOTICE', 'PRE_WIN_NOTICE', 'WIN_NOTICE', 'WIN_BID_NOTICE',
  'CONTRACT_NOTICE', 'PERFORMANCE_NOTICE', 'FAILED_BID_NOTICE',
]);
const ADDENDUM_SPECIFIC_CONTENT = '您参与的采购项目发布补遗/澄清公告，请及时查看并按新要求准备响应文件。';
const ADDENDUM_DOWNLOADER_CONTENT = '您获取过采购文件的项目发布补遗/澄清公告，请及时查看并按最新要求编制响应文件。';

/** link=/announcements/{id} → 公告（缓存）；公告不存在返回 null */
const annCache = new Map<string, { type: string; code: string | null } | null>();
async function resolveAnn(link: string | null) {
  const id = link?.startsWith('/announcements/') ? link.split('/').pop()! : null;
  if (!id) return null;
  if (annCache.has(id)) return annCache.get(id)!;
  const ann = await prisma.announcement.findUnique({
    where: { id },
    select: { type: true, relatedProjectCode: true },
  });
  const v = ann ? { type: ann.type, code: ann.relatedProjectCode } : null;
  annCache.set(id, v);
  return v;
}

/** 项目名册收件人 userId 集（受邀/已投递）；项目/名册不可解析返回 null，空名册返回空集 */
const rosterCache = new Map<string, Set<string> | null>();
async function rosterUserIds(code: string | null): Promise<Set<string> | null> {
  if (!code) return null;
  if (rosterCache.has(code)) return rosterCache.get(code)!;
  const project = await prisma.bidProject.findUnique({ where: { projectCode: code }, select: { id: true } });
  if (!project) {
    rosterCache.set(code, null);
    return null;
  }
  const rows = await prisma.bidSupplier.findMany({
    where: { projectId: project.id },
    select: { supplier: { select: { userId: true } } },
  });
  const set = new Set(rows.map(r => r.supplier?.userId).filter((u): u is string => !!u));
  rosterCache.set(code, set);
  return set;
}

async function main() {
  const total = await prisma.notification.count();
  console.log(`通知总数 ${total}，模式：${EXECUTE ? 'EXECUTE（写库）' : '干跑（只统计）'}\n`);

  // ── ① 采购邀请补标记 ──
  const selection = await prisma.notification.findMany({
    where: { type: 'SELECTION_NOTIFY', NOT: { title: { startsWith: MARKER } } },
    select: { id: true, title: true },
  });
  for (const n of selection) {
    console.log(`[①补标] ${n.title.slice(0, 40)}`);
    if (EXECUTE) await prisma.notification.update({ where: { id: n.id }, data: { title: `${MARKER}${n.title}` } });
  }
  console.log(`① 采购邀请补标记：${selection.length} 条\n`);

  // ── ② 补遗双发去重（删通用轨「新补遗公告」，保留专用轨「补遗公告」）──
  const genericAddenda = await prisma.notification.findMany({
    where: { type: 'ANNOUNCEMENT_PUBLISHED', title: { contains: '新补遗公告' } },
    select: { id: true, userId: true, link: true, title: true },
  });
  let dedupDeleted = 0;
  let dedupLoneKept = 0;
  for (const g of genericAddenda) {
    const sibling = await prisma.notification.findFirst({
      where: {
        userId: g.userId,
        link: g.link,
        type: 'ANNOUNCEMENT_PUBLISHED',
        title: { contains: '补遗公告' },
        NOT: { title: { contains: '新补遗公告' } },
      },
      select: { id: true },
    });
    if (!sibling) { dedupLoneKept++; continue; } // 无专用轨配对（唯一通知）——保留不删
    console.log(`[②去重] 删 ${g.title.slice(0, 36)}…`);
    if (EXECUTE) {
      await prisma.$transaction([
        prisma.notification.delete({ where: { id: g.id } }),
        // 投递日志无 FK，同步清孤儿（与 cleanup-stale-notifications ④ 同口径）
        prisma.notificationDeliveryLog.deleteMany({ where: { notificationId: g.id } }),
      ]);
    }
    dedupDeleted++;
  }
  console.log(`② 补遗去重：删 ${dedupDeleted} 条（通用轨），无配对保留 ${dedupLoneKept} 条\n`);

  // ── ③ 补遗参与闸（专用轨存量按名册复核）──
  const specificAddenda = await prisma.notification.findMany({
    where: { type: 'ANNOUNCEMENT_PUBLISHED', title: { startsWith: `${MARKER}补遗公告` } },
    select: { id: true, userId: true, link: true, title: true },
  });
  let gateStripped = 0;
  let gateSkipped = 0;
  for (const n of specificAddenda) {
    const ann = await resolveAnn(n.link);
    const roster = await rosterUserIds(ann?.code ?? null);
    if (!ann || roster === null) {
      // 公告/项目不可解析——无从证明参与，保守维持原状（死链由 cleanup-stale-notifications 治理）
      gateSkipped++;
      continue;
    }
    if (roster.has(n.userId)) continue; // 名册内=真参与，标记照旧
    const title = n.title.slice(MARKER.length);
    console.log(`[③剥标] ${title.slice(0, 36)}…（名册外=仅获取文件）`);
    if (EXECUTE) {
      await prisma.notification.update({
        where: { id: n.id },
        data: { title, content: ADDENDUM_DOWNLOADER_CONTENT },
      });
    }
    gateStripped++;
  }
  console.log(`③ 参与闸：剥标改文案 ${gateStripped} 条，不可解析跳过 ${gateSkipped} 条\n`);

  // ── ④ 项目内类公告补标（广播时代存量，名册内收件人）+ ⑤ 广播类保险剥标 ──
  const unmarked = await prisma.notification.findMany({
    where: { type: 'ANNOUNCEMENT_PUBLISHED', NOT: { title: { startsWith: MARKER } } },
    select: { id: true, userId: true, link: true, title: true },
  });
  let scopedMarked = 0;
  let scopedLeft = 0;
  let unresolvable = 0;
  for (const n of unmarked) {
    const ann = await resolveAnn(n.link);
    if (!ann) { unresolvable++; continue; }
    const roster = await rosterUserIds(ann.code);
    const inRoster = roster !== null && roster.has(n.userId);
    if (PROJECT_SCOPED.has(ann.type) && ann.type !== 'ADDENDUM' && inRoster) {
      console.log(`[④补标] ${n.title.slice(0, 36)}…`);
      if (EXECUTE) {
        await prisma.notification.update({ where: { id: n.id }, data: { title: `${MARKER}${n.title}` } });
      }
      scopedMarked++;
    } else {
      scopedLeft++; // 广播类/名册外/项目不可解析——维持不标（⑤ 的不标即正确态，无需动）
    }
  }
  console.log(`④ 项目内类补标：${scopedMarked} 条；维持不标 ${scopedLeft} 条（广播/名册外）；公告不可解析 ${unresolvable} 条\n`);

  if (!EXECUTE) console.log('干跑结束——加 --execute 实际写库');
  else console.log('归一完成');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
