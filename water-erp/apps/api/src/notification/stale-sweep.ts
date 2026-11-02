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
 *  - SUPPLIER_CHANGE_PENDING（2026-11-02 直采实录补）：link 恒无 id（/supplier?tab=changes）
 *    广播型——按在审变更记录的供应商名对账（队列空全消，与注册审核 content 规则对称）
 *  - SUPPLIER_PENDING 无 id 存量：按 PENDING 供应商名对账（原先仅队列空才清，非空队列
 *    下无 id 幽灵永挂）
 *  - PROFILE_CHANGE/PASSWORD_CHANGE/PASSWORD_RESET_PENDING（防御对账）：带 requestId 按
 *    请求实态消解；无 id 通用形态在对应队列空时兜底全消——动作侧消解钩子
 *    （password-requests.service）漏形态/换入口时由此兜底
 *  - 开标移交/解密异常（2026-11-02 他端待办对账）：BID_OPENING_HANDED_OVER 产生于 :3007
 *    完成开标、办结在 :3005 启动评标/归档/流标——带 PMI 按项目 stage 精确对账；无 PMI
 *    形态（link=/projects）在全库无开标中项目时兜底全清。BID_DECRYPT_FAILED（供应商
 *    DANGER 待办，裁决在 :3007）随项目终局（ARCHIVED/ABORTED）消解
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
  | 'supplierChangeRecord'
  | 'businessTag'
  | 'bidProject'
  | 'passwordChangeRequest'
  | 'passwordResetRequest'
  | 'profileChangeRequest'
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
      select: { id: true, link: true, content: true },
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
      // 2026-11-02 评审修正：businessTag 模型仍在、注册自创标签待办（type=SUPPLIER_PENDING、
      // link=/supplier）仍在产生——在审名单须并入「有 PENDING 标签的供应商名」，否则
      // 注册审批通过而标签未审时标签待办会被误杀。名单空全消；非空按 content 对账
      // （与注册审核 content 规则对称——注册/标签文案恒以企业名开头，名单不含即早已办结）
      const pendingSuppliers = await prisma.supplier.findMany({
        where: { status: 'PENDING' },
        select: { name: true },
      });
      const pendingTagSupplierIds = await prisma.businessTag.findMany({
        where: { status: 'PENDING', createdBySupplierId: { not: null } },
        select: { createdBySupplierId: true },
      });
      const tagSupplierNames = pendingTagSupplierIds.length
        ? (await prisma.supplier.findMany({
            where: { id: { in: pendingTagSupplierIds.map((t) => t.createdBySupplierId!) } },
            select: { name: true },
          })).map((x) => x.name).filter(Boolean)
        : [];
      const pendingNames = [...new Set([...pendingSuppliers.map((x) => x.name).filter(Boolean), ...tagSupplierNames])];
      const stale = pendingNames.length === 0
        ? noId
        : noId.filter((id) => {
            const row = rows.find((r) => r.id === id);
            return !pendingNames.some((name) => row?.content?.includes(name));
          });
      await resolveIds(
        'SUPPLIER_PENDING',
        pendingNames.length === 0 ? '无 id 存量·注册队列已空' : '无 id 存量·content 不含任何在审供应商名',
        stale,
      );
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

  // ── 4b) 供应商资料变更审批（广播型：link 恒 /supplier?tab=changes，无实体 id）──
  // 2026-11-02 直采实录：审批动作侧长期无消解钩子 + 单据办结/清理后通知永挂待办。
  // 按在审 SupplierChangeRecord 的供应商名对账：队列空全消；非空按 content 放行在审者。
  {
    const rows = await prisma.notification.findMany({
      where: { type: 'SUPPLIER_CHANGE_PENDING', resolvedAt: null },
      select: { id: true, content: true },
    });
    if (rows.length > 0) {
      const pendingRecords = await prisma.supplierChangeRecord.findMany({
        where: { status: 'PENDING' },
        select: { supplierId: true },
      });
      let pendingNames: string[] = [];
      if (pendingRecords.length > 0) {
        const suppliers = await prisma.supplier.findMany({
          where: { id: { in: pendingRecords.map((r) => r.supplierId) } },
          select: { name: true },
        });
        pendingNames = suppliers.map((x) => x.name).filter(Boolean);
      }
      const stale = pendingNames.length === 0
        ? rows.map((n) => n.id)
        : rows.filter((n) => !pendingNames.some((name) => n.content?.includes(name))).map((n) => n.id);
      await resolveIds(
        'SUPPLIER_CHANGE_PENDING',
        pendingNames.length === 0 ? '变更审批队列已空' : 'content 不含任何在审变更供应商名',
        stale,
      );
    }
  }

  // ── 4c) 安全审批防御对账（资料变更/改密申请/忘记密码重置）──
  // 动作侧消解钩子在 password-requests.service（approve/reject 时按多种 link 形态穷举），
  // 此处按请求实态兜底：带 requestId 精确对账；无 id 通用形态队列空才全消（保守）。
  {
    // 三表 findMany/count 签名互不兼容（union 不可直调）——lambda 包装为统一形状
    const securityRules: Array<{
      type: string;
      find: (ids: string[]) => Promise<Array<{ id: string; status: string }>>;
      countPending: () => Promise<number>;
    }> = [
      {
        type: 'PROFILE_CHANGE_PENDING',
        find: (ids) => prisma.profileChangeRequest.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } }),
        countPending: () => prisma.profileChangeRequest.count({ where: { status: 'PENDING' } }),
      },
      {
        type: 'PASSWORD_CHANGE_PENDING',
        find: (ids) => prisma.passwordChangeRequest.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } }),
        countPending: () => prisma.passwordChangeRequest.count({ where: { status: 'PENDING' } }),
      },
      {
        type: 'PASSWORD_RESET_PENDING',
        find: (ids) => prisma.passwordResetRequest.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } }),
        countPending: () => prisma.passwordResetRequest.count({ where: { status: 'PENDING' } }),
      },
    ];
    for (const { type, find, countPending } of securityRules) {
      const rows = await prisma.notification.findMany({
        where: { type, resolvedAt: null },
        select: { id: true, link: true },
      });
      if (rows.length === 0) continue;
      const byRequest = new Map<string, string[]>();
      const noId: string[] = [];
      for (const n of rows) {
        const rid = extractParam(n.link, 'requestId');
        if (rid) {
          const arr = byRequest.get(rid) ?? [];
          arr.push(n.id);
          byRequest.set(rid, arr);
        } else {
          noId.push(n.id);
        }
      }
      if (byRequest.size > 0) {
        const reqs = await find([...byRequest.keys()]);
        const statusById = new Map(reqs.map((r) => [r.id, r.status]));
        const stale: string[] = [];
        for (const [rid, ids] of byRequest) {
          // 请求不存在（已清理）或已办结（status≠PENDING）→ 待审事实消失
          const st = statusById.get(rid);
          if (st === undefined || st !== 'PENDING') stale.push(...ids);
        }
        await resolveIds(type, '按 requestId：已办结/不存在', stale);
      }
      if (noId.length > 0) {
        const pending = await countPending();
        if (pending === 0) {
          await resolveIds(type, '无 id 通用形态·请求队列已空', noId);
        }
      }
    }
  }

  // ── 4c2) 专家连拒预警跨公司错发清理（2026-11-02 实录：投资公司专家的预警发到了
  // 设计公司 leader/staff——发送侧已修为按专家归属公司收窄，本规则清存量错发行。
  // 按 content 提取「专家名」→ 反查专家归属公司，与接收人公司均明确且不等 → 删除
  // （错发通知不该存在于历史；专家查不到/无归属/同名歧义 → 跳过，保守不动）。
  {
    const rows = await prisma.notification.findMany({
      where: { type: 'EXPERT_DECLINE_STREAK' },
      select: { id: true, content: true, userId: true },
    });
    if (rows.length > 0) {
      const names = new Set<string>();
      for (const n of rows) {
        const m = /「(.+?)」/.exec(n.content ?? '');
        if (m?.[1]) names.add(m[1]);
      }
      const experts = names.size
        ? await prisma.user.findMany({
            where: { displayName: { in: [...names] }, role: 'bid_expert' },
            select: { displayName: true, companyId: true },
          })
        : [];
      // 同名多公司歧义 → 该名不参与清理
      const companyByExpertName = new Map<string, string>();
      for (const e of experts) {
        if (!e.companyId) continue;
        if (companyByExpertName.has(e.displayName) && companyByExpertName.get(e.displayName) !== e.companyId) {
          companyByExpertName.delete(e.displayName);
          continue;
        }
        companyByExpertName.set(e.displayName, e.companyId);
      }
      const recipientIds = [...new Set(rows.map((n) => n.userId))];
      const recipients = await prisma.user.findMany({
        where: { id: { in: recipientIds } },
        select: { id: true, companyId: true },
      });
      const companyByUser = new Map(recipients.map((u) => [u.id, u.companyId]));
      const wrongIds: string[] = [];
      for (const n of rows) {
        const m = /「(.+?)」/.exec(n.content ?? '');
        const expertCompany = m?.[1] ? companyByExpertName.get(m[1]) : undefined;
        const userCompany = companyByUser.get(n.userId) ?? null;
        if (expertCompany && userCompany && expertCompany !== userCompany) {
          wrongIds.push(n.id);
        }
      }
      if (wrongIds.length > 0) {
        const r = await prisma.notification.deleteMany({ where: { id: { in: wrongIds } } });
        if (r.count > 0) {
          results.push({ type: 'EXPERT_DECLINE_STREAK', rule: '跨公司错发删除', resolved: r.count });
        }
      }
    }
  }

  // ── 4d0) 供应商催审：link 带 supplierId——该供应商审结（status≠PENDING/删除）即失效
  {
    const rows = await prisma.notification.findMany({
      where: { type: 'SUPPLIER_REVIEW_URGE', resolvedAt: null },
      select: { id: true, link: true },
    });
    const bySupplier = new Map<string, string[]>();
    for (const n of rows) {
      // 催审链接参数名为 id（/supplier/repository?id=X），与注册通知的 supplierId= 不同
      const sid = extractParam(n.link, 'id') ?? extractSupplierId(n.link);
      if (!sid) continue;
      const arr = bySupplier.get(sid) ?? [];
      arr.push(n.id);
      bySupplier.set(sid, arr);
    }
    if (bySupplier.size > 0) {
      const suppliers = await prisma.supplier.findMany({
        where: { id: { in: [...bySupplier.keys()] } },
        select: { id: true, status: true },
      });
      const statusById = new Map(suppliers.map((x) => [x.id, x.status]));
      const stale: string[] = [];
      for (const [sid, ids] of bySupplier) {
        if (statusById.get(sid) !== 'PENDING') stale.push(...ids);
      }
      await resolveIds('SUPPLIER_REVIEW_URGE', '按供应商 id：已审结/删除', stale);
    }
  }

  // ── 4d) 开标域他端待办对账 ──
  {
    // a) 开标移交：带 PMI 精确——项目已启动评标/归档/流标（离开 OPENING）即办结；
    //    PMI 指不到项目（已删）同样办结。无 PMI 形态（link=/projects）保守：
    //    全库仍有 OPENING 项目时不清（可能已移交待处理），否则全清
    const rows = await prisma.notification.findMany({
      where: { type: 'BID_OPENING_HANDED_OVER', resolvedAt: null },
      select: { id: true, link: true },
    });
    if (rows.length > 0) {
      const byPmi = new Map<string, string[]>();
      const noPmi: string[] = [];
      for (const n of rows) {
        const pmi = extractParam(n.link, 'projectId');
        if (pmi) {
          const arr = byPmi.get(pmi) ?? [];
          arr.push(n.id);
          byPmi.set(pmi, arr);
        } else {
          noPmi.push(n.id);
        }
      }
      if (byPmi.size > 0) {
        // 同一 PMI 可挂多项目（流标重招继承 PMI）——按 PMI 聚合 stage 集合，
        // 任一轮次仍在 OPENING 即保留该 PMI 的全部待办（2026-11-02 评审 P3：
        // 此前 Map last-wins 由 DB 返回顺序决定，活动轮次待办可能被误清）
        const projects = await prisma.bidProject.findMany({
          where: { projectManagementItemId: { in: [...byPmi.keys()] } },
          select: { stage: true, projectManagementItemId: true },
        });
        const stagesByPmi = new Map<string, Set<string>>();
        for (const x of projects) {
          if (!x.projectManagementItemId) continue;
          const set = stagesByPmi.get(x.projectManagementItemId) ?? new Set<string>();
          set.add(x.stage);
          stagesByPmi.set(x.projectManagementItemId, set);
        }
        const stale: string[] = [];
        for (const [pmi, ids] of byPmi) {
          const stages = stagesByPmi.get(pmi);
          if (stages === undefined || !stages.has('OPENING')) stale.push(...ids);
        }
        await resolveIds('BID_OPENING_HANDED_OVER', '按 PMI：各轮次均已离开开标阶段/已删除', stale);
      }
      if (noPmi.length > 0) {
        const openingCount = await prisma.bidProject.count({ where: { stage: 'OPENING' } });
        if (openingCount === 0) {
          await resolveIds('BID_OPENING_HANDED_OVER', '无 PMI 形态·全库已无开标中项目', noPmi);
        }
      }
    }

    // b) 解密异常（供应商 DANGER 待办）：项目终局后无处理意义
    const decryptRows = await prisma.notification.findMany({
      where: { type: 'BID_DECRYPT_FAILED', resolvedAt: null, link: { contains: '/my-bids/' } },
      select: { id: true, link: true },
    });
    if (decryptRows.length > 0) {
      const byProject = new Map<string, string[]>();
      for (const n of decryptRows) {
        const m = /\/my-bids\/([A-Za-z0-9_-]+)/.exec(n.link ?? '');
        if (!m) continue;
        const arr = byProject.get(m[1]) ?? [];
        arr.push(n.id);
        byProject.set(m[1], arr);
      }
      if (byProject.size > 0) {
        const projects = await prisma.bidProject.findMany({
          where: { id: { in: [...byProject.keys()] } },
          select: { id: true, stage: true },
        });
        const stageById = new Map(projects.map((x) => [x.id, x.stage]));
        const stale: string[] = [];
        for (const [bid, ids] of byProject) {
          const stage = stageById.get(bid);
          if (stage === 'ARCHIVED' || stage === 'ABORTED' || stage === undefined) stale.push(...ids);
        }
        await resolveIds('BID_DECRYPT_FAILED', '项目已终局（归档/流标/删除）', stale);
      }
    }
  }

  // ── 4e) 开标域阶段窗口统一对账（2026-11-02 全量矩阵审计）──
  // 三类窗口 × link 含项目 id（/my-bids/{id}、/bid/project/{id}、?projectId=）：
  //  - 截标窗口（受邀/催投/催供应商/时间变更）：项目离开 DOWNLOAD/SUBMIT 即失效
  //  - 开标窗口（临近开标/解密临期/会场交流/异议超时）：评标启动或终局即失效
  //  - 评标窗口（评标超时/专家指派/催专家）：项目终局即失效
  // 项目删除同样消解；无 id 存量（/dashboard 等）不动——已读兜底。
  {
    const BID_STAGE_WINDOWS: Array<{ types: string[]; stale: (stage: string | undefined) => boolean }> = [
      {
        types: ['BID_INVITED', 'BID_DEADLINE_NUDGE', 'BID_NUDGE_SUPPLIER', 'BID_SCHEDULE_CHANGE'],
        stale: (st) => st === undefined || !['DOWNLOAD', 'SUBMIT'].includes(st),
      },
      {
        types: ['BID_OPENING_SOON', 'DECRYPT_WINDOW_CLOSING', 'HALL_MESSAGE', 'BID_DISPUTE_TIMEOUT'],
        stale: (st) => st === undefined || ['EVALUATING', 'ARCHIVED', 'ABORTED'].includes(st),
      },
      {
        types: ['EVAL_DEADLINE_EXPIRED', 'EXPERT_ASSIGNED', 'BID_NUDGE_EXPERT'],
        stale: (st) => st === undefined || st === 'ARCHIVED' || st === 'ABORTED',
      },
    ];
    const extractBidProjectId = (link: string | null): string | null => {
      if (!link) return null;
      const m1 = /\/my-bids\/([A-Za-z0-9_-]+)/.exec(link);
      if (m1) return m1[1];
      const m2 = /\/bid\/project\/([A-Za-z0-9_-]+)/.exec(link);
      if (m2) return m2[1];
      return extractParam(link, 'projectId');
    };
    for (const { types, stale } of BID_STAGE_WINDOWS) {
      const rows = await prisma.notification.findMany({
        where: { type: { in: types }, resolvedAt: null },
        select: { id: true, type: true, link: true },
      });
      if (rows.length === 0) continue;
      const byProject = new Map<string, Array<{ id: string; type: string }>>();
      for (const n of rows) {
        const pid = extractBidProjectId(n.link);
        if (!pid) continue;
        const arr = byProject.get(pid) ?? [];
        arr.push({ id: n.id, type: n.type });
        byProject.set(pid, arr);
      }
      if (byProject.size === 0) continue;
      const projects = await prisma.bidProject.findMany({
        where: { id: { in: [...byProject.keys()] } },
        select: { id: true, stage: true },
      });
      const stageById = new Map(projects.map((x) => [x.id, x.stage]));
      // 按类型分别归集（updateMany 一次一型）
      const staleByType = new Map<string, string[]>();
      for (const [pid, items] of byProject) {
        if (stale(stageById.get(pid))) {
          for (const item of items) {
            const arr = staleByType.get(item.type) ?? [];
            arr.push(item.id);
            staleByType.set(item.type, arr);
          }
        }
      }
      for (const [type, ids] of staleByType) {
        await resolveIds(type, '阶段窗口已过（项目推进/终局/删除）', ids);
      }
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
