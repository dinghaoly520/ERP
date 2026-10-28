import type { PrismaClient } from '@prisma/client';

/**
 * 幽灵待办对账消解（2026-10-22 账号管理角标错位根治）：
 * 可操作类通知（待办段）镜像着某个底层 pending 状态，但历史通知（种子快照 / 早期
 * 无消解钩子时代）在底层事项办结后从未消解——角标与「通知待办」于是长期显示有待审，
 * 点进去却是空的。本函数按四类「镜像型」逐一对账，把底层已不 pending 的通知打上
 * resolvedAt（幂等：只动 resolvedAt IS NULL 的行）。
 *
 *  - USER_REGISTRATION_PENDING：link 带 userId= 的按用户消解（已激活/已转正/已删）；
 *    无 id 存量在注册队列空时全消、非空时按 content 不含任何在审者姓名才消
 *  - SUPPLIER_PENDING：link 带 supplierId= 的按供应商消解（status≠PENDING 或已删）；
 *    自创标签通知（link=/supplier 无 id）在注册与标签队列双空时消解
 *  - SUPPLIER_LINK_PENDING：link 无实体 id，加入审批队列整体为空时全量消解
 *  - CATALOG_APPLICATION：审核人通知（link 含 appId=）按申请单消解（status≠PENDING）；
 *    供应商侧结果通知（/catalog-applications）为事件性，不属待办镜像、不消解
 *
 * 事件性通知（资质到期 / 专家退库预警 / CA 到期等）的真值是"事件发生过"，不由本扫
 * 清除——已读兜底归档即可。调用方：Scheduler 每日、seed 装载后、scripts 手动补扫。
 */

type SweepPrisma = Pick<
  PrismaClient,
  | 'notification'
  | 'user'
  | 'supplier'
  | 'supplierCompanyLink'
>;

export type SweepResult = { type: string; rule: string; resolved: number };

function extractParam(link: string | null, key: string): string | null {
  if (!link) return null;
  const m = link.match(new RegExp(`[?&]${key}=([A-Za-z0-9_-]+)`));
  return m ? m[1] : null;
}

/** 供应商通知链接两种形态（与 :3005 通知页解析同口径）：
 *  新版 `/supplier/approval?supplierId=X` 查询参数；旧版 `/supplier/<cuid>` 路径段。
 *  路径段须过 id 形状闸（含数字且 ≥19 字符——实测库内 Supplier/User id 全部 19~25
 *  字符含数字；`/supplier/selection` 等页面段无数字，误当 id 会把页面链接通知错杀）。 */
function extractSupplierId(link: string | null): string | null {
  const param = extractParam(link, 'supplierId');
  if (param) return param;
  if (!link) return null;
  const m = /\/supplier\/([A-Za-z0-9_-]+)/.exec(link);
  const seg = m?.[1];
  if (!seg || seg === 'approval' || seg === 'repository') return null;
  if (seg.length < 19 || !/\d/.test(seg)) return null; // 形状不像实体 id → 归入无 id 保守桶
  return seg;
}

export async function sweepStaleActionableNotifications(prisma: SweepPrisma): Promise<SweepResult[]> {
  const now = new Date();
  const results: SweepResult[] = [];

  const resolveIds = async (type: string, rule: string, ids: string[]) => {
    if (!ids.length) return;
    const r = await prisma.notification.updateMany({
      where: { type, resolvedAt: null, id: { in: ids } },
      data: { resolvedAt: now },
    });
    if (r.count > 0) results.push({ type, rule, resolved: r.count });
  };

  const resolveAll = async (type: string, rule: string) => {
    const r = await prisma.notification.updateMany({
      where: { type, resolvedAt: null },
      data: { resolvedAt: now },
    });
    if (r.count > 0) results.push({ type, rule, resolved: r.count });
  };

  // ── 1) 内部账号注册审核 ──
  {
    const rows = await prisma.notification.findMany({
      where: { type: 'USER_REGISTRATION_PENDING', resolvedAt: null },
      select: { id: true, link: true, content: true },
    });
    const byUser = new Map<string, string[]>();
    const noId: Array<{ id: string; content: string }> = [];
    for (const n of rows) {
      const uid = extractParam(n.link, 'userId');
      if (uid) {
        const arr = byUser.get(uid) ?? [];
        arr.push(n.id);
        byUser.set(uid, arr);
      } else {
        noId.push({ id: n.id, content: n.content });
      }
    }
    if (byUser.size > 0) {
      const users = await prisma.user.findMany({
        where: { id: { in: [...byUser.keys()] } },
        select: { id: true, isActive: true, role: true },
      });
      const userMap = new Map(users.map((u) => [u.id, u]));
      const stale: string[] = [];
      for (const [uid, ids] of byUser) {
        const u = userMap.get(uid);
        // 已删 / 已激活 / 已转正出 internal_user —— 待审事实消失
        if (!u || u.isActive || u.role !== 'internal_user') stale.push(...ids);
      }
      await resolveIds('USER_REGISTRATION_PENDING', '按 userId：已激活/转正/删除', stale);
    }
    const pendingRegistrants = await prisma.user.findMany({
      where: { role: 'internal_user', isActive: false },
      select: { displayName: true },
    });
    if (noId.length > 0) {
      // 无 id 存量（旧格式/种子快照）：队列空则全清；队列非空时按 content 含在审者
      // displayName 放行（创建文案恒以姓名开头）——滚动注册场景下存量幽灵也能清，
      // 且 contains 宽松匹配宁可漏杀（保留）不误杀（消解在审通知）
      const pendingNames = pendingRegistrants.map((u) => u.displayName).filter(Boolean);
      const stale = pendingNames.length === 0
        ? noId.map((n) => n.id)
        : noId.filter((n) => !pendingNames.some((name) => n.content.includes(name))).map((n) => n.id);
      await resolveIds('USER_REGISTRATION_PENDING', pendingNames.length === 0 ? '无 id 存量·注册队列已空' : '无 id 存量·content 不含任何在审者姓名', stale);
    }
  }

  // ── 2) 供应商注册 / 自创标签初审 ──
  {
    const rows = await prisma.notification.findMany({
      where: { type: 'SUPPLIER_PENDING', resolvedAt: null },
      select: { id: true, link: true },
    });
    const bySupplier = new Map<string, string[]>();
    const noId: string[] = [];
    for (const n of rows) {
      const sid = extractSupplierId(n.link);
      if (sid) {
        const arr = bySupplier.get(sid) ?? [];
        arr.push(n.id);
        bySupplier.set(sid, arr);
      } else {
        noId.push(n.id);
      }
    }
    if (bySupplier.size > 0) {
      const suppliers = await prisma.supplier.findMany({
        where: { id: { in: [...bySupplier.keys()] } },
        select: { id: true, status: true },
      });
      const statusById = new Map(suppliers.map((s) => [s.id, s.status]));
      const stale: string[] = [];
      for (const [sid, ids] of bySupplier) {
        if (statusById.get(sid) !== 'PENDING') stale.push(...ids); // 已审结或已删
      }
      await resolveIds('SUPPLIER_PENDING', '按 supplierId：status≠PENDING', stale);
    }
    if (noId.length > 0) {
      // mall 下线（2026-10-28）：businessTag（标签队列）模型已删，仅按注册队列判空兜底
      const pendingSup = await prisma.supplier.count({ where: { status: 'PENDING' } });
      if (pendingSup === 0) {
        await resolveIds('SUPPLIER_PENDING', '无 id 存量·注册队列已空', noId);
      }
    }
  }

  // ── 3) 供应商加入审批（link 无实体 id：队列整体为空才兜底全清）──
  {
    const pendingLinks = await prisma.supplierCompanyLink.count({ where: { status: 'PENDING' } });
    if (pendingLinks === 0) {
      await resolveAll('SUPPLIER_LINK_PENDING', '加入审批队列已空');
    }
  }

  // ── 4) 目录/报价申请（审核人 todo 按 appId 精确对账）──
  {
    const rows = await prisma.notification.findMany({
      where: { type: 'CATALOG_APPLICATION', resolvedAt: null, link: { contains: 'appId=' } },
      select: { id: true, link: true },
    });
    const byApp = new Map<string, string[]>();
    for (const n of rows) {
      const appId = extractParam(n.link, 'appId');
      if (!appId) continue;
      const arr = byApp.get(appId) ?? [];
      arr.push(n.id);
      byApp.set(appId, arr);
    }
    if (byApp.size > 0) {
      // mall 下线（2026-10-28）：supplierCatalogApplication 模型已删，实体无从对账——
      // 未决 CATALOG_APPLICATION 通知所指向的申请均已不存在，全部视为过期（stale）
      await resolveIds('CATALOG_APPLICATION', '申请实体已随商城下线移除', [...byApp.values()].flat());
    }
  }

  // ── 5) 批量报告型（EXPERT_RETIRE_CANDIDATE）：批报镜像「最新一次评估」的结果，
  //    真值在目标页实时队列——每用户只保留最新一条未消解，历史批报全部消解
  //    （创建点已同步上闸取代，本规则收敛存量。CATALOG_PRICE_ALERT 已随功能移除，
  //    2026-10-26 用户裁定：目录价格预警非系统功能，发送源与种子一并清除）
  for (const type of ['EXPERT_RETIRE_CANDIDATE'] as const) {
    const rows = await prisma.notification.findMany({
      where: { type, resolvedAt: null },
      select: { id: true, userId: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const newestPerUser = new Set<string>();
    const stale: string[] = [];
    for (const n of rows) {
      if (!newestPerUser.has(n.userId)) {
        newestPerUser.add(n.userId); // desc 序首见 = 该用户最新一批，保留
        continue;
      }
      stale.push(n.id);
    }
    await resolveIds(type, '批报取代：仅保留每用户最新一批', stale);
  }

  return results;
}
