/**
 * 一次性归一（2026-11-10 「与您相关」标记裁定，eaa6c8234）：存量站内信按新标准刷齐——
 *  标准：标记⟔收件人被点名/真参与（项目名册=受邀/已投递），广播类永不标。
 *  ① 采购邀请（SELECTION_NOTIFY）补【与您相关】前缀——逐家点名恒属定向，旧数据全无标
 *  ② 补遗去重：同用户同链接收敛为一条——单轨化前每次发布双通知（专用轨「补遗公告」+
 *     通用轨「新补遗公告」），反复发布还会累积；优先保留专用轨最新一条
 *  ③ 补遗参与闸：两种标题形态的带标存量按项目名册复核——名册外（仅获取过文件的潜在
 *     投标人/RESTRICTED 白名单收件人）剥标记；专用轨文案改「您获取过」、通用轨中性文案保留
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

  // ── ② 补遗去重：同用户同链接收敛为一条（组内任选）──
  // 反复发布（update 路径）会让两条轨都累积多条；优先保留专用轨（无「新」）中最新一条，
  // 全组皆通用轨时保留最新一条（RESTRICTED 白名单-only 收件人可能只有通用轨，不能删光）。
  const allAddenda = await prisma.notification.findMany({
    where: { type: 'ANNOUNCEMENT_PUBLISHED', title: { contains: '补遗公告' } },
    select: { id: true, userId: true, link: true, title: true, createdAt: true },
  });
  const groups = new Map<string, typeof allAddenda>();
  for (const n of allAddenda) {
    const key = `${n.userId}|${n.link}`;
    const list = groups.get(key) ?? [];
    list.push(n);
    groups.set(key, list);
  }
  let dedupDeleted = 0;
  let dedupGroups = 0;
  for (const list of groups.values()) {
    if (list.length <= 1) continue;
    dedupGroups++;
    const specific = list.filter(n => !n.title.includes('新补遗公告'));
    const keep = (specific.length > 0 ? specific : list)
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    for (const n of list) {
      if (n.id === keep.id) continue;
      console.log(`[②去重] 删 ${n.title.slice(0, 36)}…（组内保留 ${keep.title.slice(0, 24)}…）`);
      if (EXECUTE) {
        await prisma.$transaction([
          prisma.notification.delete({ where: { id: n.id } }),
          // 投递日志无 FK，同步清孤儿（与 cleanup-stale-notifications ④ 同口径）
          prisma.notificationDeliveryLog.deleteMany({ where: { notificationId: n.id } }),
        ]);
      }
      dedupDeleted++;
    }
  }
  console.log(`② 补遗去重：${dedupGroups} 组收敛，删 ${dedupDeleted} 条\n`);

  // ── ③ 补遗参与闸（两种标题形态的带标存量按名册复核）──
  // 覆盖「【与您相关】补遗公告」（专用轨）与「【与您相关】新补遗公告」（RESTRICTED 时代
  // 通用轨对白名单/名册全员带标）——名册外一律剥标；专用轨文案同时改「您获取过」口径。
  const markedAddenda = await prisma.notification.findMany({
    where: {
      type: 'ANNOUNCEMENT_PUBLISHED',
      title: { startsWith: MARKER, contains: '补遗公告' },
    },
    select: { id: true, userId: true, link: true, title: true },
  });
  let gateStripped = 0;
  let gateSkipped = 0;
  for (const n of markedAddenda) {
    const ann = await resolveAnn(n.link);
    const roster = await rosterUserIds(ann?.code ?? null);
    if (!ann || roster === null) {
      // 公告/项目不可解析——无从证明参与，保守维持原状（死链由 cleanup-stale-notifications 治理）
      gateSkipped++;
      continue;
    }
    if (roster.has(n.userId)) continue; // 名册内=真参与，标记照旧
    const title = n.title.slice(MARKER.length);
    // 专用轨（无「新」）原文案是「您参与的」口径——对名册外失实，改「您获取过」；
    // 通用轨文案本是中性导览（「已发布请前往查看」），对下载者/白名单收件人都成立，只剥标。
    const data = n.title.includes('新补遗公告')
      ? { title }
      : { title, content: ADDENDUM_DOWNLOADER_CONTENT };
    console.log(`[③剥标] ${title.slice(0, 36)}…（名册外）`);
    if (EXECUTE) await prisma.notification.update({ where: { id: n.id }, data });
    gateStripped++;
  }
  console.log(`③ 参与闸：剥标 ${gateStripped} 条（专用轨连带改文案），不可解析跳过 ${gateSkipped} 条\n`);

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
  console.log(`④ 项目内类补标：${scopedMarked} 条；维持不标 ${scopedLeft} 条（广播/名册外）；公告不可解析 ${unresolvable} 条`);

  // ── ⑤ 保险：广播类公告通知若带标记一律剥除 ──
  // 代码路径不可能产生（旧通用轨仅对项目内类加前缀）——幂等兜底，防手改库/异源写入。
  const markedOthers = await prisma.notification.findMany({
    where: {
      type: 'ANNOUNCEMENT_PUBLISHED',
      title: { startsWith: MARKER },
      NOT: { title: { contains: '补遗公告' } },
    },
    select: { id: true, userId: true, link: true, title: true },
  });
  let guardStripped = 0;
  for (const n of markedOthers) {
    const ann = await resolveAnn(n.link);
    if (!ann || PROJECT_SCOPED.has(ann.type)) continue; // 项目内类带标=合法（④/③ 已治理名册判定）
    console.log(`[⑤剥标] ${n.title.slice(0, 36)}…（广播类）`);
    if (EXECUTE) {
      await prisma.notification.update({ where: { id: n.id }, data: { title: n.title.slice(MARKER.length) } });
    }
    guardStripped++;
  }
  console.log(`⑤ 广播类保险剥标：${guardStripped} 条\n`);

  if (!EXECUTE) console.log('干跑结束——加 --execute 实际写库');
  else console.log('归一完成');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
