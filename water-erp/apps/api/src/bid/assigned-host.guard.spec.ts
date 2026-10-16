import { AssignedHostGuard } from './assigned-host.guard';
import { PrismaService } from '../prisma/prisma.service';

/** 构造 mock ExecutionContext（express 风格 req） */
function makeCtx(req: Record<string, unknown>) {
  return { switchToHttp: () => ({ getRequest: () => req }) } as any;
}

describe('AssignedHostGuard — 主持操作执行权跟随指派（2026-10-15）', () => {
  let guard: AssignedHostGuard;
  let prisma: any;

  beforeEach(() => {
    prisma = { bidProject: { findUnique: jest.fn() } };
    guard = new AssignedHostGuard(prisma as unknown as PrismaService);
  });

  it('admin 全量放行（不查库）', async () => {
    await expect(guard.canActivate(makeCtx({ params: { id: 'p1' }, user: { sub: 'u1', role: 'admin' } }))).resolves.toBe(true);
    expect(prisma.bidProject.findUnique).not.toHaveBeenCalled();
  });

  it('被指派主持人放行——角色不限（staff 亦可）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ assignedHostUserId: 'u2' });
    await expect(guard.canActivate(makeCtx({ params: { id: 'p1' }, user: { sub: 'u2', role: 'staff' } }))).resolves.toBe(true);
  });

  it('同公司未指派的 bid_host → 403 NOT_ASSIGNED_HOST（收紧：执行权=指派而非角色）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ assignedHostUserId: 'u2' });
    await expect(guard.canActivate(makeCtx({ params: { id: 'p1' }, user: { sub: 'u9', role: 'bid_host' } })))
      .rejects.toMatchObject({ response: { code: 'NOT_ASSIGNED_HOST' } });
  });

  it('未指派 leader → 403 NOT_ASSIGNED_HOST', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ assignedHostUserId: null });
    await expect(guard.canActivate(makeCtx({ params: { id: 'p1' }, user: { sub: 'u3', role: 'leader' } })))
      .rejects.toMatchObject({ response: { code: 'NOT_ASSIGNED_HOST' } });
  });

  it('项目不存在 → 放行（404 语义交给后续业务层）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(makeCtx({ params: { id: 'pX' }, user: { sub: 'u1', role: 'staff' } }))).resolves.toBe(true);
  });

  it('无 :id 参数（列表类端点）→ 放行', async () => {
    await expect(guard.canActivate(makeCtx({ params: {}, user: { sub: 'u1', role: 'staff' } }))).resolves.toBe(true);
    expect(prisma.bidProject.findUnique).not.toHaveBeenCalled();
  });
});
