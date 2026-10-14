/**
 * Outbox 消费者单测（阶段2.5 T6）
 * mock Prisma/Notification——CAS 抢占/退避封顶/topic 分发/幂等
 */
const mockSend = jest.fn().mockResolvedValue({});

const mkRows = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `ob-${i}`, topic: 'bid.submitted.v3',
  payload: { projectId: 'proj-1', submissionId: 'sub-1', revision: 1 + i, operationId: 'op-1' },
  status: 'PENDING', attempts: 0, lastError: null as string | null, publishedAt: null as Date | null,
}));

const mkPrisma = (over: Record<string, any> = {}) => {
  const state = { rows: over.rows ?? mkRows(1) };
  const prisma: any = {
    outbox: {
      findMany: jest.fn().mockResolvedValue(state.rows.filter(r => r.status === 'PENDING' || r.status === 'DISPATCHING')),
      updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
        // CAS 抢占语义：PENDING→DISPATCHING 仅当当前仍 PENDING；DISPATCHING→SENT/FAILED/PENDING 原子
        let count = 0;
        for (const r of state.rows) {
          if (r.id !== where.id) continue;
          if (where.status === 'PENDING' && r.status === 'PENDING') { r.status = data.status; count = 1; break; }
          if (where.status === 'DISPATCHING' && r.status === 'DISPATCHING') { Object.assign(r, data); count = 1; break; }
        }
        return { count };
      }),
    },
    bidProject: { findUnique: jest.fn().mockResolvedValue(over.host ?? { assignedHostUserId: 'host-1' }) },
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
