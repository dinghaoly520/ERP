import { sweepStaleActionableNotifications } from './stale-sweep';

/**
 * 幽灵待办对账引擎的行为锁定测试（2026-10-22）：假 Prisma 按引擎实际发出的
 * 查询形状实现最小语义，逐规则验证「消解谁/保留谁」——尤其防两类回归：
 *  - 误杀（页面段当 id、在审者姓名命中却消解、队列非空时清无 id 存量）
 *  - 漏杀（旧路径段格式、转正/删除用户）
 */

type NotifRow = { id: string; type: string; link: string | null; content: string; resolvedAt: Date | null; userId?: string; createdAt?: Date };
type UserRow = { id: string; isActive: boolean; role: string; displayName: string };

function makePrisma(tables: {
  notifications?: NotifRow[];
  users?: UserRow[];
  suppliers?: Array<{ id: string; status: string }>;
  links?: Array<{ id: string; status: string }>;
  apps?: Array<{ id: string; status: string }>;
  tags?: Array<{ id: string; status: string }>;
}) {
  const notifications = (tables.notifications ?? []).map((n) => ({ ...n }));
  const users = tables.users ?? [];
  const suppliers = tables.suppliers ?? [];
  const links = tables.links ?? [];
  const apps = tables.apps ?? [];
  const tags = tables.tags ?? [];

  const notifMatches = (n: NotifRow, where: any) => {
    if (where.type !== undefined && n.type !== where.type) return false;
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
          (u) => (where.role === undefined || u.role === where.role) &&
            (where.isActive === undefined || u.isActive === where.isActive),
        );
      }),
    },
    supplier: {
      findMany: jest.fn(async ({ where }: any) => suppliers.filter((s) => where.id.in.includes(s.id))),
      count: jest.fn(async ({ where }: any) => suppliers.filter((s) => s.status === where.status).length),
    },
    supplierCompanyLink: {
      count: jest.fn(async ({ where }: any) => links.filter((l) => l.status === where.status).length),
    },
    supplierCatalogApplication: {
      findMany: jest.fn(async ({ where }: any) => apps.filter((a) => where.id.in.includes(a.id))),
    },
    businessTag: {
      count: jest.fn(async ({ where }: any) => tags.filter((t) => t.status === where.status).length),
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

  it('供应商·双链接格式按 supplierId 对账，页面段不误杀', async () => {
    const pathId = 'cmsup000111222333444555'; // 21 字符含数字（旧路径段格式）
    const pageSeg = 'selection'; // 页面段：无数字 → 归保守桶
    const prisma = makePrisma({
      notifications: [
        N('s1', 'SUPPLIER_PENDING', `/supplier/approval?supplierId=${pathId}`), // 已审结
        N('s2', 'SUPPLIER_PENDING', `/supplier/${pathId}x`), // 旧路径段格式，已审结
        N('s3', 'SUPPLIER_PENDING', '/supplier/approval?supplierId=sup-wait'), // 在审
        N('s4', 'SUPPLIER_PENDING', `/supplier/${pageSeg}`), // 页面段：队列非空 → 保留（防误杀）
      ],
      suppliers: [
        { id: pathId, status: 'APPROVED' },
        { id: `${pathId}x`, status: 'REJECTED' },
        { id: 'sup-wait', status: 'PENDING' },
      ],
    });
    await sweepStaleActionableNotifications(prisma as any);
    expect(prisma._unresolved().sort()).toEqual(['s3', 's4']);
  });

  it('供应商·自创标签通知（无 id）仅在注册与标签队列双空时消解', async () => {
    const tagNotif = [N('t1', 'SUPPLIER_PENDING', '/supplier', '甲司 注册时自创标签：x')];
    // 有在审供应商 → 保留
    const a = makePrisma({ notifications: tagNotif.map((n) => ({ ...n })), suppliers: [{ id: 's', status: 'PENDING' }], tags: [] });
    await sweepStaleActionableNotifications(a as any);
    expect(a._unresolved()).toEqual(['t1']);
    // 双空 → 消解
    const b = makePrisma({ notifications: tagNotif.map((n) => ({ ...n })), suppliers: [], tags: [] });
    await sweepStaleActionableNotifications(b as any);
    expect(b._unresolved()).toEqual([]);
  });

  it('加入审批：队列空全清、非空全留（无实体 id 可归因）', async () => {
    const rows = [N('l1', 'SUPPLIER_LINK_PENDING', '/supplier?tab=company-links')];
    const a = makePrisma({ notifications: rows.map((n) => ({ ...n })), links: [{ id: 'l', status: 'PENDING' }] });
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
});
