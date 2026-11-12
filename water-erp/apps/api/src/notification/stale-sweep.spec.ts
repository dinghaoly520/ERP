import { sweepStaleActionableNotifications } from './stale-sweep';

/**
 * 幽灵待办对账引擎的行为锁定测试（2026-10-22）：假 Prisma 按引擎实际发出的
 * 查询形状实现最小语义，逐规则验证「消解谁/保留谁」——尤其防两类回归：
 *  - 误杀（页面段当 id、在审者姓名命中却消解、队列非空时清无 id 存量）
 *  - 漏杀（旧路径段格式、转正/删除用户）
 */

type NotifRow = { id: string; type: string; link: string | null; content: string; resolvedAt: Date | null; userId?: string; createdAt?: Date };
type UserRow = { id: string; isActive: boolean; role: string; displayName: string; companyId?: string | null };

function makePrisma(tables: {
  notifications?: NotifRow[];
  users?: UserRow[];
  suppliers?: Array<{ id: string; status: string; name?: string; companyId?: string | null }>;
  links?: Array<{ id: string; status: string }>;
  apps?: Array<{ id: string; status: string }>;
  tags?: Array<{ id: string; status: string; createdBySupplierId?: string | null }>;
  changeRecords?: Array<{ supplierId: string; status: string }>;
  bidProjects?: Array<{ id: string; stage: string; projectManagementItemId: string | null }>;

  pwChanges?: Array<{ id: string; status: string }>;
  pwResets?: Array<{ id: string; status: string }>;
  profileChanges?: Array<{ id: string; status: string }>;
}) {
  const notifications = (tables.notifications ?? []).map((n) => ({ ...n }));
  const users = tables.users ?? [];
  const suppliers = tables.suppliers ?? [];
  const links = tables.links ?? [];
  const apps = tables.apps ?? [];
  const tags = tables.tags ?? [];
  const changeRecords = tables.changeRecords ?? []; // SupplierChangeRecord（含 supplierId）
  const bidProjects = tables.bidProjects ?? [];     // BidProject（stage 镜像）

  const pwChanges = tables.pwChanges ?? [];         // PasswordChangeRequest
  const pwResets = tables.pwResets ?? [];           // PasswordResetRequest
  const profileChanges = tables.profileChanges ?? []; // ProfileChangeRequest

  const notifMatches = (n: NotifRow, where: any) => {
    if (where.type?.in) {
      if (!where.type.in.includes(n.type)) return false;
    } else if (where.type !== undefined && n.type !== where.type) {
      return false;
    }
    if (where.resolvedAt === null && n.resolvedAt !== null) return false;
    if (where.id?.in && !where.id.in.includes(n.id)) return false;
    if (where.link?.contains && !(n.link ?? '').includes(where.link.contains)) return false;
    return true;
  };

  const notifSort = (rows: NotifRow[], orderBy?: any[]) => {
    if (!orderBy?.length) return rows;
    return [...rows].sort((a, b) => {
      const at = a.createdAt?.getTime() ?? 0;
      const bt = b.createdAt?.getTime() ?? 0;
      if (at !== bt) return orderBy[0].createdAt === 'desc' ? bt - at : at - bt;
      return orderBy[0].id === 'desc' ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id);
    });
  };

  return {
    notification: {
      findMany: jest.fn(async ({ where, orderBy }: any) =>
        notifSort(notifications.filter((n) => notifMatches(n, where)), orderBy).map((n) => ({ ...n }))),
      deleteMany: jest.fn(async ({ where }: any) => {
        let count = 0;
        for (const n of notifications) {
          if (where.id?.in?.includes(n.id)) {
            notifications.splice(notifications.indexOf(n), 1);
            count += 1;
          }
        }
        return { count };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const n of notifications) {
          if (notifMatches(n, where)) {
            n.resolvedAt = data.resolvedAt;
            count += 1;
          }
        }
        return { count };
      }),
    },
    user: {
      findMany: jest.fn(async ({ where }: any) => {
        if (where.id?.in) return users.filter((u) => where.id.in.includes(u.id));
        return users.filter(
          (u) =>
            (where.role === undefined || u.role === where.role) &&
            (where.isActive === undefined || u.isActive === where.isActive) &&
            (where.displayName?.in === undefined || where.displayName.in.includes(u.displayName)),
        );
      }),
    },
    supplier: {
      findMany: jest.fn(async ({ where }: any) =>
        suppliers.filter((s) =>
          where.id?.in ? where.id.in.includes(s.id)
            : where.status === undefined || s.status === where.status)),
      count: jest.fn(async ({ where }: any) => suppliers.filter((s) => s.status === where.status).length),
    },
    supplierCompanyLink: {
      count: jest.fn(async ({ where }: any) => links.filter((l) =>
        where.status?.in ? where.status.in.includes(l.status) : l.status === where.status).length),
    },
    supplierCatalogApplication: {
      findMany: jest.fn(async ({ where }: any) => apps.filter((a) => where.id.in.includes(a.id))),
    },
    businessTag: {
      count: jest.fn(async ({ where }: any) => tags.filter((t) => t.status === where.status).length),
      findMany: jest.fn(async ({ where }: any) =>
        tags.filter((t) =>
          (where.status === undefined || t.status === where.status) &&
          (where.createdBySupplierId?.not === undefined ? t.createdBySupplierId !== null : true))),
    },
    bidProject: {
      findMany: jest.fn(async ({ where }: any) =>
        bidProjects.filter((x) =>
          where.id?.in ? where.id.in.includes(x.id)
            : where.projectManagementItemId?.in ? where.projectManagementItemId.in.includes(x.projectManagementItemId)
              : where.stage === undefined || x.stage === where.stage)),
      count: jest.fn(async ({ where }: any) =>
        bidProjects.filter((x) => where.stage === undefined || x.stage === where.stage).length),
    },
    supplierChangeRecord: {
      findMany: jest.fn(async ({ where }: any) =>
        changeRecords.filter((r) => where.status === undefined || r.status === where.status)),
    },
    passwordChangeRequest: {
      findMany: jest.fn(async ({ where }: any) => pwChanges.filter((r) => where.id?.in ? where.id.in.includes(r.id) : r.status === where.status)),
      count: jest.fn(async ({ where }: any) => pwChanges.filter((r) => r.status === where.status).length),
    },
    passwordResetRequest: {
      findMany: jest.fn(async ({ where }: any) => pwResets.filter((r) => where.id?.in ? where.id.in.includes(r.id) : r.status === where.status)),
      count: jest.fn(async ({ where }: any) => pwResets.filter((r) => r.status === where.status).length),
    },
    profileChangeRequest: {
      findMany: jest.fn(async ({ where }: any) => profileChanges.filter((r) => where.id?.in ? where.id.in.includes(r.id) : r.status === where.status)),
      count: jest.fn(async ({ where }: any) => profileChanges.filter((r) => r.status === where.status).length),
    },
    // 检视用：取当前未消解通知 id 集
    _unresolved: () => notifications.filter((n) => n.resolvedAt === null).map((n) => n.id),
  };
}

const N = (id: string, type: string, link: string | null, content = '') => ({ id, type, link, content, resolvedAt: null });

describe('sweepStaleActionableNotifications', () => {
  it('注册·按 userId：已转正/已删用户消解，在审 internal_user 保留', async () => {
    const prisma = makePrisma({
      notifications: [
        N('n1', 'USER_REGISTRATION_PENDING', '/admin/accounts?tab=registration&userId=u-gone'),
        N('n2', 'USER_REGISTRATION_PENDING', '/admin/accounts?tab=registration&userId=u-staff'),
        N('n3', 'USER_REGISTRATION_PENDING', '/admin/accounts?tab=registration&userId=u-wait'),
      ],
      users: [
        { id: 'u-staff', isActive: true, role: 'staff', displayName: '张三' },
        { id: 'u-wait', isActive: false, role: 'internal_user', displayName: '李四' },
      ],
    });
    const results = await sweepStaleActionableNotifications(prisma as any);
    expect(prisma._unresolved()).toEqual(['n3']);
    expect(results.find((r) => r.type === 'USER_REGISTRATION_PENDING')?.resolved).toBe(2);
  });

  it('注册·无 id 存量：队列空全消；队列非空按在审者姓名放行', async () => {
    // 场景 A：无在审注册 → 全消
    const a = makePrisma({
      notifications: [N('nA', 'USER_REGISTRATION_PENDING', '/admin/accounts', '王五（集团）')],
      users: [],
    });
    await sweepStaleActionableNotifications(a as any);
    expect(a._unresolved()).toEqual([]);

    // 场景 B：有在审注册 → content 含其姓名的保留、不含的消解
    const b = makePrisma({
      notifications: [
        N('nB1', 'USER_REGISTRATION_PENDING', '/admin/accounts', '李四（集团 · 工程部）'),
        N('nB2', 'USER_REGISTRATION_PENDING', '/admin/accounts', '王五（集团 · 财务部）'),
      ],
      users: [{ id: 'u-wait', isActive: false, role: 'internal_user', displayName: '李四' }],
    });
    await sweepStaleActionableNotifications(b as any);
    expect(b._unresolved()).toEqual(['nB1']); // 李四在审 → 他的通知保留；王五的消解
  });

  it('供应商·双链接格式按 supplierId 对账；无 id 按 PENDING 供应商名对账（2026-11-02 语义升级）', async () => {
    const pathId = 'cmsup000111222333444555'; // 21 字符含数字（旧路径段格式）
    const pageSeg = 'selection'; // 页面段：无数字 → 归无 id 桶
    const prisma = makePrisma({
      notifications: [
        N('s1', 'SUPPLIER_PENDING', `/supplier/approval?supplierId=${pathId}`), // 已审结
        N('s2', 'SUPPLIER_PENDING', `/supplier/${pathId}x`), // 旧路径段格式，已审结
        N('s3', 'SUPPLIER_PENDING', '/supplier/approval?supplierId=sup-wait'), // 在审
        N('s4', 'SUPPLIER_PENDING', `/supplier/${pageSeg}`), // 页面段无 id：content 空不含在审者名 → 幽灵消解
        N('s5', 'SUPPLIER_PENDING', `/supplier/${pageSeg}`, '在审公司 提交了注册申请'), // 页面段含在审者名 → 保留
      ],
      suppliers: [
        { id: pathId, status: 'APPROVED', name: '已审公司' },
        { id: `${pathId}x`, status: 'REJECTED', name: '驳回公司' },
        { id: 'sup-wait', status: 'PENDING', name: '在审公司' },
      ],
    });
    await sweepStaleActionableNotifications(prisma as any);
    expect(prisma._unresolved().sort()).toEqual(['s3', 's5']);
  });

  it('供应商·无 id 通知按在审者名对账：在审者保留、队列空消解', async () => {
    const tagNotif = [N('t1', 'SUPPLIER_PENDING', '/supplier', '甲司 注册时自创标签：x')];
    // 有在审供应商（具名）→ content 含其名保留
    const a = makePrisma({ notifications: tagNotif.map((n) => ({ ...n })), suppliers: [{ id: 's', status: 'PENDING', name: '甲司' }], tags: [] });
    await sweepStaleActionableNotifications(a as any);
    expect(a._unresolved()).toEqual(['t1']);
    // 队列空 → 消解
    const b = makePrisma({ notifications: tagNotif.map((n) => ({ ...n })), suppliers: [], tags: [] });
    await sweepStaleActionableNotifications(b as any);
    expect(b._unresolved()).toEqual([]);
  });

  it('加入/退库审批：队列空全清、非空全留（无实体 id 可归因；退库件 2026-11-10 同 type）', async () => {
    const rows = [N('l1', 'SUPPLIER_LINK_PENDING', '/supplier?tab=company-links')];
    const a = makePrisma({ notifications: rows.map((n) => ({ ...n })), links: [{ id: 'l', status: 'PENDING' }, { id: 'l2', status: 'LEAVE_PENDING' }] });
    await sweepStaleActionableNotifications(a as any);
    expect(a._unresolved()).toEqual(['l1']);
    const b = makePrisma({ notifications: rows.map((n) => ({ ...n })), links: [] });
    await sweepStaleActionableNotifications(b as any);
    expect(b._unresolved()).toEqual([]);
  });

  it('目录申请（mall 下线 2026-10-28）：带 appId 的全部按实体已删消解；供应商侧结果通知（无 appId）不动', async () => {
    const prisma = makePrisma({
      notifications: [
        N('c1', 'CATALOG_APPLICATION', '/mall-management/catalog?tab=approval&appId=app-done'),
        N('c2', 'CATALOG_APPLICATION', '/mall-management/catalog?tab=approval&appId=app-wait'),
        N('c3', 'CATALOG_APPLICATION', '/catalog-applications'),
      ],
    });
    await sweepStaleActionableNotifications(prisma as any);
    expect(prisma._unresolved().sort()).toEqual(['c3']);
  });

  it('批量报告型：每用户仅保留最新一批（含同毫秒并列按 id 决出）', async () => {
    const t = (h: number) => new Date(Date.now() - h * 3600_000);
    const prisma = makePrisma({
      notifications: [
        // CATALOG_PRICE_ALERT 已随功能移除（2026-10-26），夹具改用 EXPERT_RETIRE_CANDIDATE
        // 双用户覆盖同一规则语义（每用户仅留最新一批）
        { id: 'r-old-a', type: 'EXPERT_RETIRE_CANDIDATE', link: '/expert/retirement', content: '', resolvedAt: null, userId: 'u1', createdAt: t(48) },
        { id: 'r-new-a', type: 'EXPERT_RETIRE_CANDIDATE', link: '/expert/retirement', content: '', resolvedAt: null, userId: 'u1', createdAt: t(1) },
        { id: 'r-old-b', type: 'EXPERT_RETIRE_CANDIDATE', link: '/expert/retirement', content: '', resolvedAt: null, userId: 'u2', createdAt: t(24) },
      ],
    });
    await sweepStaleActionableNotifications(prisma as any);
    expect(prisma._unresolved().sort()).toEqual(['r-new-a', 'r-old-b']);
  });

  it('幂等：复跑第二轮零消解', async () => {
    const prisma = makePrisma({
      notifications: [
        N('n1', 'USER_REGISTRATION_PENDING', '/admin/accounts?tab=registration&userId=u-staff'),
        N('s1', 'SUPPLIER_PENDING', '/supplier/approval?supplierId=sup-done'),
      ],
      users: [{ id: 'u-staff', isActive: true, role: 'staff', displayName: '张三' }],
      suppliers: [{ id: 'sup-done', status: 'APPROVED' }],
    });
    const first = await sweepStaleActionableNotifications(prisma as any);
    expect(first.reduce((s, r) => s + r.resolved, 0)).toBe(2);
    const second = await sweepStaleActionableNotifications(prisma as any);
    expect(second).toEqual([]);
    expect(prisma._unresolved()).toEqual([]);
  });

  it('资料变更·SUPPLIER_CHANGE_PENDING：队列空全消；队列非空按在审供应商名放行', async () => {
    // 场景 A：变更记录已全部办结（本库实况：表空）→ 幽灵通知全消
    const a = makePrisma({
      notifications: [
        N('nA1', 'SUPPLIER_CHANGE_PENDING', '/supplier?tab=changes', '「甲公司」提交资料变更申请（字段：联系人）'),
        N('nA2', 'SUPPLIER_CHANGE_PENDING', '/supplier?tab=changes', '「乙公司」提交资料变更申请（字段：地址）'),
      ],
      changeRecords: [],
    });
    await sweepStaleActionableNotifications(a as any);
    expect(a._unresolved()).toEqual([]);

    // 场景 B：仍有在审变更 → content 含在审供应商名的保留、不含的消解
    const bPrisma = makePrisma({
      notifications: [
        N('nB1', 'SUPPLIER_CHANGE_PENDING', '/supplier?tab=changes', '「甲公司」提交资料变更申请（字段：联系人）'),
        N('nB2', 'SUPPLIER_CHANGE_PENDING', '/supplier?tab=changes', '「乙公司」提交资料变更申请（字段：地址）'),
      ],
      changeRecords: [{ supplierId: 's1', status: 'PENDING' }],
      suppliers: [{ id: 's1', status: 'PENDING', name: '甲公司' }],
    });
    await sweepStaleActionableNotifications(bPrisma as any);
    expect(bPrisma._unresolved()).toEqual(['nB1']);
  });

  it('供应商注册·无 id 幽灵：队列非空按 PENDING 供应商名对账（与注册审核对称）', async () => {
    const prisma = makePrisma({
      notifications: [
        N('n1', 'SUPPLIER_PENDING', '/supplier', '甲公司 提交了注册申请，信用代码 X，请前往初审。'),
        N('n2', 'SUPPLIER_PENDING', '/supplier', '丙公司 提交了注册申请，信用代码 Y，请前往初审。'),
      ],
      suppliers: [
        { id: 's1', status: 'PENDING', name: '甲公司' },
        { id: 's2', status: 'APPROVED', name: '乙公司' },
      ],
    });
    await sweepStaleActionableNotifications(prisma as any);
    // 甲公司在审保留；丙公司不在 PENDING 名单（其通知早已办结）消解
    expect(prisma._unresolved()).toEqual(['n1']);
  });

  it('安全审批·带 requestId 精确对账：请求已办结/不存在消解，仍 PENDING 保留', async () => {
    const link = (id: string) => `/admin/accounts?tab=password&section=profile&requestId=${id}`;
    const prisma = makePrisma({
      notifications: [
        N('n1', 'PROFILE_CHANGE_PENDING', link('r-approved'), ''),
        N('n2', 'PROFILE_CHANGE_PENDING', link('r-pending'), ''),
        N('n3', 'PROFILE_CHANGE_PENDING', link('r-gone'), ''),
        N('n4', 'PASSWORD_CHANGE_PENDING', link('c-approved'), ''),
        N('n5', 'PASSWORD_RESET_PENDING', link('z-gone'), ''),
      ],
      profileChanges: [
        { id: 'r-approved', status: 'APPROVED' },
        { id: 'r-pending', status: 'PENDING' },
      ],
      pwChanges: [{ id: 'c-approved', status: 'APPROVED' }],
      pwResets: [],
    });
    await sweepStaleActionableNotifications(prisma as any);
    expect(prisma._unresolved()).toEqual(['n2']);
  });

  it('安全审批·无 id 通用形态：对应请求队列空时兜底全消', async () => {
    const prisma = makePrisma({
      notifications: [
        N('n1', 'PROFILE_CHANGE_PENDING', '/admin/accounts?tab=password&section=profile', ''),
        N('n2', 'PASSWORD_CHANGE_PENDING', '/admin/accounts', ''),
        // 密码重置队列非空 → 其通用通知保留
        N('n3', 'PASSWORD_RESET_PENDING', '/admin/accounts', ''),
      ],
      profileChanges: [],
      pwChanges: [],
      pwResets: [{ id: 'r1', status: 'PENDING' }],
    });
    await sweepStaleActionableNotifications(prisma as any);
    expect(prisma._unresolved()).toEqual(['n3']);
  });

  it('开标移交·带 PMI 精确对账：项目已启动评标/归档/流标消解，仍在开标中保留', async () => {
    const link = (pmi: string) => `/projects?projectId=${pmi}&panel=bid-confirm`;
    const prisma = makePrisma({
      notifications: [
        N('h1', 'BID_OPENING_HANDED_OVER', link('pmi-eval'), ''),
        N('h2', 'BID_OPENING_HANDED_OVER', link('pmi-archived'), ''),
        N('h3', 'BID_OPENING_HANDED_OVER', link('pmi-aborted'), ''),
        N('h4', 'BID_OPENING_HANDED_OVER', link('pmi-opening'), ''),
        N('h5', 'BID_OPENING_HANDED_OVER', link('pmi-gone'), ''),
      ],
      bidProjects: [
        { id: 'b1', stage: 'EVALUATING', projectManagementItemId: 'pmi-eval' },
        { id: 'b2', stage: 'ARCHIVED', projectManagementItemId: 'pmi-archived' },
        { id: 'b3', stage: 'ABORTED', projectManagementItemId: 'pmi-aborted' },
        { id: 'b4', stage: 'OPENING', projectManagementItemId: 'pmi-opening' },
      ],
    });
    await sweepStaleActionableNotifications(prisma as any);
    // 启动评标/归档/流标=移交待办已办结；PMI 消失（项目删除）同消；仍在开标中保留
    expect(prisma._unresolved()).toEqual(['h4']);
  });

  it('开标移交·无 PMI 形态（link=/projects）：全库仍有开标中项目时保守保留，否则全清', async () => {
    // 场景 A：仍有 OPENING 项目（可能已移交未处理）→ 不清（宁留勿杀）
    const a = makePrisma({
      notifications: [N('h1', 'BID_OPENING_HANDED_OVER', '/projects', '')],
      bidProjects: [{ id: 'b1', stage: 'OPENING', projectManagementItemId: null }],
    });
    await sweepStaleActionableNotifications(a as any);
    expect(a._unresolved()).toEqual(['h1']);

    // 场景 B：无任何 OPENING 项目 → 无 id 形态全部办结，清
    const b = makePrisma({
      notifications: [N('h1', 'BID_OPENING_HANDED_OVER', '/projects', '')],
      bidProjects: [{ id: 'b2', stage: 'ARCHIVED', projectManagementItemId: null }],
    });
    await sweepStaleActionableNotifications(b as any);
    expect(b._unresolved()).toEqual([]);
  });

  it('解密异常·供应商待办随项目终局消解：归档/流标消，评标中（裁决窗口）保留', async () => {
    const link = (bid: string) => `/my-bids/${bid}/opening-hall`;
    const prisma = makePrisma({
      notifications: [
        N('d1', 'BID_DECRYPT_FAILED', link('b-archived'), ''),
        N('d2', 'BID_DECRYPT_FAILED', link('b-aborted'), ''),
        N('d3', 'BID_DECRYPT_FAILED', link('b-evaluating'), ''),
      ],
      bidProjects: [
        { id: 'b-archived', stage: 'ARCHIVED', projectManagementItemId: null },
        { id: 'b-aborted', stage: 'ABORTED', projectManagementItemId: null },
        { id: 'b-evaluating', stage: 'EVALUATING', projectManagementItemId: null },
      ],
    });
    await sweepStaleActionableNotifications(prisma as any);
    expect(prisma._unresolved()).toEqual(['d3']);
  });

  it('开标域阶段窗口·统一规则：三类窗口按项目 stage 消解、窗口内保留、多 link 形态识别', async () => {
    const prisma = makePrisma({
      notifications: [
        // 截标窗口类：离开 DOWNLOAD/SUBMIT 即失效
        N('c1', 'BID_INVITED', '/dashboard?projectId=b-eval', ''),
        N('c2', 'BID_DEADLINE_NUDGE', '/dashboard?projectId=b-submit', ''),
        N('c3', 'BID_NUDGE_SUPPLIER', '/dashboard?projectId=b-gone', ''),
        N('c4', 'BID_SCHEDULE_CHANGE', '/dashboard?projectId=b-download', ''),
        // 开标窗口类：评标启动/终局即失效
        N('c5', 'BID_OPENING_SOON', '/my-bids/b-eval/opening-hall', ''),
        N('c6', 'DECRYPT_WINDOW_CLOSING', '/my-bids/b-opening/opening-hall', ''),
        N('c7', 'HALL_MESSAGE', '/my-bids/b-opening/opening-hall', ''),
        N('c8', 'BID_DISPUTE_TIMEOUT', '/bid/project/b-eval', ''),
        // 评标窗口类：终局即失效
        N('c9', 'EVAL_DEADLINE_EXPIRED', '/bid/project/b-archived', ''),
        N('c10', 'EXPERT_ASSIGNED', '/expert/evaluate?projectId=b-evaluating', ''),
        N('c11', 'BID_NUDGE_EXPERT', '/?projectId=b-archived', ''),
        // 无 id 存量：不动（自然已读兜底）
        N('c12', 'BID_DEADLINE_NUDGE', '/dashboard', ''),
      ],
      bidProjects: [
        { id: 'b-eval', stage: 'EVALUATING', projectManagementItemId: null },
        { id: 'b-submit', stage: 'SUBMIT', projectManagementItemId: null },
        { id: 'b-download', stage: 'DOWNLOAD', projectManagementItemId: null },
        { id: 'b-opening', stage: 'OPENING', projectManagementItemId: null },
        { id: 'b-archived', stage: 'ARCHIVED', projectManagementItemId: null },
        { id: 'b-evaluating', stage: 'EVALUATING', projectManagementItemId: null },
      ],
    });
    await sweepStaleActionableNotifications(prisma as any);
    // 保留：截标窗口内的 b-submit/b-download、开标窗口内的 b-opening、评标中的 b-evaluating、无 id 存量
    expect(prisma._unresolved().sort()).toEqual(['c10', 'c12', 'c2', 'c4', 'c6', 'c7']);
  });

  it('澄清/报价轮·/bids/{id} link 形态 + 项目终局消解（2026-11-12 举一反三：该两型无窗口覆盖、/bids/ 前缀不被提取）', async () => {
    const prisma = makePrisma({
      notifications: [
        N('e1', 'BID_CLARIFICATION_CREATED', '/bids/b-archived/clarifications', ''),
        N('e2', 'BID_CLARIFICATION_CREATED', '/bids/b-evaluating/clarifications', ''),
        N('e3', 'BID_ROUND_OPEN', '/bids/b-aborted/round-quote', ''),
        N('e4', 'BID_ROUND_OPEN', '/bids/b-evaluating/round-quote', ''),
      ],
      bidProjects: [
        { id: 'b-archived', stage: 'ARCHIVED', projectManagementItemId: null },
        { id: 'b-aborted', stage: 'ABORTED', projectManagementItemId: null },
        { id: 'b-evaluating', stage: 'EVALUATING', projectManagementItemId: null },
      ],
    });
    await sweepStaleActionableNotifications(prisma as any);
    expect(prisma._unresolved().sort()).toEqual(['e2', 'e4']);
  });

  it('供应商催审·按 supplierId：审结/删除消解，仍在审保留', async () => {
    const prisma = makePrisma({
      notifications: [
        N('u1', 'SUPPLIER_REVIEW_URGE', '/supplier/repository?id=s-approved', ''),
        N('u2', 'SUPPLIER_REVIEW_URGE', '/supplier/repository?id=s-pending', ''),
      ],
      suppliers: [{ id: 's-approved', status: 'APPROVED' }, { id: 's-pending', status: 'PENDING' }],
    });
    await sweepStaleActionableNotifications(prisma as any);
    expect(prisma._unresolved()).toEqual(['u2']);
  });

  it('供应商·无 id：注册已审但自创标签在审时，标签待办保留（2026-11-02 评审 P2b）', async () => {
    const prisma = makePrisma({
      notifications: [N('t1', 'SUPPLIER_PENDING', '/supplier', '甲司 注册时自创标签：x')],
      // 供应商已 APPROVED（注册审毕）但其标签 PENDING
      suppliers: [{ id: 's1', status: 'APPROVED', name: '甲司' }],
      tags: [{ id: 'tag1', status: 'PENDING', createdBySupplierId: 's1' }],
    });
    await sweepStaleActionableNotifications(prisma as any);
    expect(prisma._unresolved()).toEqual(['t1']);
    // 标签队列也空（审毕）→ 允许消解
    const b = makePrisma({
      notifications: [N('t1', 'SUPPLIER_PENDING', '/supplier', '甲司 注册时自创标签：x')],
      suppliers: [{ id: 's1', status: 'APPROVED', name: '甲司' }],
      tags: [{ id: 'tag1', status: 'APPROVED', createdBySupplierId: 's1' }],
    });
    await sweepStaleActionableNotifications(b as any);
    expect(b._unresolved()).toEqual([]);
  });

  it('开标移交·共享 PMI 多轮次：任一轮仍在 OPENING 即保留全部（2026-11-02 评审 P3）', async () => {
    const link = (pmi: string) => `/projects?projectId=${pmi}&panel=bid-confirm`;
    const prisma = makePrisma({
      notifications: [N('h1', 'BID_OPENING_HANDED_OVER', link('pmi-shared'), '')],
      // 同一 PMI 两轮：R1 已流标 + R2 开标中——Map 顺序不定也不得误清 R2 的活动待办
      bidProjects: [
        { id: 'r1', stage: 'ABORTED', projectManagementItemId: 'pmi-shared' },
        { id: 'r2', stage: 'OPENING', projectManagementItemId: 'pmi-shared' },
      ],
    });
    await sweepStaleActionableNotifications(prisma as any);
    expect(prisma._unresolved()).toEqual(['h1']);
    // 两轮都离开 OPENING → 消解
    const b = makePrisma({
      notifications: [N('h1', 'BID_OPENING_HANDED_OVER', link('pmi-shared'), '')],
      bidProjects: [
        { id: 'r1', stage: 'ABORTED', projectManagementItemId: 'pmi-shared' },
        { id: 'r2', stage: 'EVALUATING', projectManagementItemId: 'pmi-shared' },
      ],
    });
    await sweepStaleActionableNotifications(b as any);
    expect(b._unresolved()).toEqual([]);
  });

  it('专家连拒预警·跨公司错发删除：他司接收人删除、本公司保留、归属不明跳过', async () => {
    // w1=设计公司 leader 收投资公司专家预警（错发）；w2=投资公司 leader（正确）；w3=专家查无（跳过）
    const rows = [
      { id: 'w1', type: 'EXPERT_DECLINE_STREAK', link: '/expert/repository', content: '专家「冯杰」已连续 3 次拒绝评审邀请', resolvedAt: null, userId: 'u-design' },
      { id: 'w2', type: 'EXPERT_DECLINE_STREAK', link: '/expert/repository', content: '专家「冯杰」已连续 3 次拒绝评审邀请', resolvedAt: null, userId: 'u-invest' },
      { id: 'w3', type: 'EXPERT_DECLINE_STREAK', link: '/expert/repository', content: '专家「无名氏」已连续 3 次拒绝评审邀请', resolvedAt: null, userId: 'u-design' },
    ];
    const p2 = makePrisma({ notifications: rows, users: [
      { id: 'u-design', isActive: true, role: 'leader', displayName: '设计师', companyId: 'co-design' },
      { id: 'u-invest', isActive: true, role: 'leader', displayName: '投资员', companyId: 'co-invest' },
      { id: 'ex-fengjie', isActive: true, role: 'bid_expert', displayName: '冯杰', companyId: 'co-invest' },
    ] });
    await sweepStaleActionableNotifications(p2 as any);
    expect(p2._unresolved().sort()).toEqual(['w2', 'w3']);
  });

  it('供应商连拒预警·跨公司错发删除（与专家版同构）', async () => {
    const p2 = makePrisma({
      notifications: [
        { id: 'v1', type: 'SUPPLIER_DECLINE_STREAK', link: '/supplier/repository', content: '供应商「甲公司」已连续 3 次拒绝采购邀请', resolvedAt: null, userId: 'u-design' },
        { id: 'v2', type: 'SUPPLIER_DECLINE_STREAK', link: '/supplier/repository', content: '供应商「甲公司」已连续 3 次拒绝采购邀请', resolvedAt: null, userId: 'u-invest' },
      ],
      users: [
        { id: 'u-design', isActive: true, role: 'leader', displayName: '设计师', companyId: 'co-design' },
        { id: 'u-invest', isActive: true, role: 'leader', displayName: '投资员', companyId: 'co-invest' },
      ],
      suppliers: [{ id: 's1', status: 'APPROVED', name: '甲公司', companyId: 'co-invest' }],
    });
    await sweepStaleActionableNotifications(p2 as any);
    expect(p2._unresolved()).toEqual(['v2']);
  });
});
