/**
 * Outbox 消费者单测（阶段2.5 T6）
 * mock Prisma/Notification——CAS 抢占/退避封顶/topic 分发/幂等
 */
const mockSend = jest.fn().mockResolvedValue({});

const mkRows = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `ob-${i}`, topic: 'bid.submitted.v3',
  payload: { projectId: 'proj-1', submissionId: 'sub-1', revision: 1 + i, operationId: 'op-1' },
  status: 'PENDING', attempts: 0, lastError: null as string | null, publishedAt: null as Date | null, claimedAt: null as Date | null,
}));

const mkPrisma = (over: Record<string, any> = {}) => {
  const state = { rows: over.rows ?? mkRows(1) };
  const prisma: any = {
    outbox: {
      findMany: jest.fn().mockImplementation(async () => state.rows.filter(r => r.status === 'PENDING')),
      updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
        // CAS 抢占语义：PENDING→DISPATCHING 仅当当前仍 PENDING；DISPATCHING→SENT/FAILED/PENDING 原子
        let count = 0;
        for (const r of state.rows) {
          if (r.id !== where.id) continue;
          if (where.status === 'PENDING' && r.status === 'PENDING') { Object.assign(r, data); count = 1; break; }
          if (where.status === 'DISPATCHING' && r.status === 'DISPATCHING'
            && (!where.claimedAt || (r.claimedAt ?? null) === (where.claimedAt ?? null))) { Object.assign(r, data); count = 1; break; }
        }
        return { count };
      }),
    },
    bidProject: { findUnique: jest.fn().mockResolvedValue(over.host ?? { assignedHostUserId: 'host-1', name: '智慧水务平台建设项目' }) },
    supplierBidSubmission: { findUnique: jest.fn().mockResolvedValue(over.submission ?? { supplier: { name: '四川水发建设有限公司' } }) },
  };
  return { prisma, state };
};

import { OutboxDispatchService } from './outbox-dispatch.service';

const mkSvc = (prisma: any) => new OutboxDispatchService(prisma, { sendToUser: mockSend } as any);

describe('OutboxDispatchService（T6）', () => {
  beforeEach(() => { mockSend.mockClear(); mockSend.mockResolvedValue({}); });

  test('成功：CAS 抢占→通知主持人→SENT+publishedAt', async () => {
    const { prisma, state } = mkPrisma();
    const r = await mkSvc(prisma).dispatchOnce();
    expect(r.sent).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith('host-1', ['in_app'], expect.objectContaining({ type: 'BID_SUBMITTED_V3', link: '/bid' }));
    expect(state.rows[0].status).toBe('SENT');
    expect(state.rows[0].publishedAt).toBeTruthy();
  });

  // 2026-10-29 文案治理锁定：项目名/供应商名入文，裸主键与 dual-v3/revision 黑话永不回潮
  test('文案：项目名+供应商名入文，不含裸 projectId/黑话', async () => {
    const { prisma } = mkPrisma();
    await mkSvc(prisma).dispatchOnce();
    const payload = mockSend.mock.calls[0][2] as { title: string; content: string };
    expect(payload.title).toBe('新投标递交：智慧水务平台建设项目');
    expect(payload.content).toContain('「智慧水务平台建设项目」');
    expect(payload.content).toContain('「四川水发建设有限公司」');
    expect(payload.content).not.toContain('proj-1'); // 裸主键
    expect(payload.title + payload.content).not.toMatch(/dual-v\d|revision/i); // 黑话
  });

  test('文案：revision≥2 标注版次；供应商查不到时兜底不露主键', async () => {
    const rows = mkRows(2); // revision 1 / 2（dispatchOnce 单轮处理两行）
    const { prisma } = mkPrisma({ rows });
    (prisma.supplierBidSubmission.findUnique as jest.Mock).mockResolvedValue(null);
    await mkSvc(prisma).dispatchOnce();
    const first = mockSend.mock.calls[0][2] as { content: string };
    const second = mockSend.mock.calls[1][2] as { content: string };
    expect(first.content).toContain('收到新的投标递交，'); // 首投无版次后缀
    expect(second.content).toContain('（第 2 版）'); // 修订标注版次
    expect(first.content + second.content).not.toContain('sub-1'); // 兜底不露主键
  });

  test('并发抢占失败（count=0）→ 跳过不通知不误标', async () => {
    const { prisma } = mkPrisma();
    prisma.outbox.updateMany.mockResolvedValue({ count: 0 }); // 对手已抢
    const r = await mkSvc(prisma).dispatchOnce();
    expect(r.sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('失败退避：1-4 次 attempts+1 回 PENDING；第 5 次 → FAILED+lastError', async () => {
    mockSend.mockRejectedValue(new Error('notify down'));
    const { prisma, state } = mkPrisma();
    const svc = mkSvc(prisma);
    for (let i = 1; i <= 4; i++) {
      await svc.dispatchOnce();
      expect(state.rows[0].status).toBe('PENDING');
      expect(state.rows[0].attempts).toBe(i);
    }
    await svc.dispatchOnce();
    expect(state.rows[0].status).toBe('FAILED');
    expect(state.rows[0].lastError).toContain('notify down');
  });

  test('无主持人 → 直接 SENT（payload 记 skipped）', async () => {
    const { prisma, state } = mkPrisma({ host: {} });
    const r = await mkSvc(prisma).dispatchOnce();
    expect(r.skipped).toBe(1);
    expect(state.rows[0].status).toBe('SENT');
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('未注册 topic → FAILED（no handler）', async () => {
    const { prisma, state } = mkPrisma({ rows: [{ id: 'ob-x', topic: 'unknown.topic', payload: {}, status: 'PENDING', attempts: 0, lastError: null, publishedAt: null }] });
    await mkSvc(prisma).dispatchOnce();
    expect(state.rows[0].status).toBe('FAILED');
    expect(state.rows[0].lastError).toContain('no handler');
  });
});

describe('终审 I-2：DISPATCHING 崩溃残留恢复', () => {
  test('滞留 >5min 的 DISPATCHING 行可重占并完成；新鲜 DISPATCHING 不捞', async () => {
    const { prisma, state } = (() => {
      const stale = { id: 'ob-stale', topic: 'bid.submitted.v3', payload: { projectId: 'proj-1' }, status: 'DISPATCHING', attempts: 0, lastError: null, publishedAt: null, claimedAt: new Date(Date.now() - 10 * 60 * 1000) };
      const s = { rows: [stale] };
      const p: any = {
        outbox: {
          findMany: jest.fn().mockImplementation(async ({ where }: any) =>
            s.rows.filter(r => r.status === 'PENDING'
              || (r.status === 'DISPATCHING' && where.OR && (r.claimedAt ?? new Date()) < where.OR[1].claimedAt.lt))),
          updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
            const r = s.rows.find(x => x.id === where.id);
            if (!r) return { count: 0 };
            if (r.status === 'DISPATCHING' && r.claimedAt === (where.claimedAt ?? r.claimedAt)) { Object.assign(r, data); return { count: 1 }; }
            if (r.status === 'PENDING' && where.status === 'PENDING') { Object.assign(r, data); return { count: 1 }; }
            return { count: 0 };
          }),
        },
        bidProject: { findUnique: jest.fn().mockResolvedValue({ assignedHostUserId: 'host-1', name: '测试项目' }) },
        supplierBidSubmission: { findUnique: jest.fn().mockResolvedValue({ supplier: { name: '测试供应商' } }) },
      };
      return { prisma: p, state: s };
    })();
    const r = await mkSvc(prisma).dispatchOnce();
    expect(r.sent).toBe(1);
    expect(state.rows[0].status).toBe('SENT');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
