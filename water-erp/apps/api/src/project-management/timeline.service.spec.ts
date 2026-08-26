import { NotFoundException } from '@nestjs/common';
import { TimelineService } from './timeline.service';

/** B3 项目时间信息轴（CTS-EBS01 A-204）：聚合各域时间节点，有值升序、缺值垫底 */
describe('TimelineService（B3 A-204）', () => {
  const mk = (pmi: any, bp: any = null, contract: any = null) => ({
    projectManagementItem: { findUnique: jest.fn().mockResolvedValue(pmi) },
    bidProject: { findFirst: jest.fn().mockResolvedValue(bp) },
    contract: { findFirst: jest.fn().mockResolvedValue(contract) },
  });

  it('六类节点齐全：有值按时间升序，缺值垫底保序', async () => {
    const prisma = mk(
      {
        id: 'pmi-1',
        initiationDate: new Date('2026-07-01T00:00:00Z'),
        documentAcquireTime: '2026-07-10', // String 字段（半 ISO）
        bidOpeningTime: null,
        archivedAt: new Date('2026-08-20T00:00:00Z'),
      },
      { deadline: new Date('2026-08-01T00:00:00Z'), openTime: new Date('2026-08-02T00:00:00Z') },
      { signedAt: new Date('2026-08-10T00:00:00Z') },
    );
    const nodes = await new TimelineService(prisma as any).getTimeline('pmi-1');
    expect(nodes.map(n => n.key)).toEqual([
      'initiation', 'documentAcquire', 'bidDeadline', 'bidOpening', 'contractSign', 'archived',
    ]);
    expect(nodes.every(n => n.label && n.source)).toBe(true);
  });

  it('部分缺失：缺值节点垫底且不抛错；开标回退 PMI 字符串时间', async () => {
    const prisma = mk(
      {
        id: 'pmi-1', initiationDate: new Date('2026-07-01T00:00:00Z'),
        documentAcquireTime: null, bidOpeningTime: '2026-08-02 10:00', archivedAt: null,
      },
      { deadline: null, openTime: null },
      null,
    );
    const nodes = await new TimelineService(prisma as any).getTimeline('pmi-1');
    expect(nodes.filter(n => n.time).map(n => n.key)).toEqual(['initiation', 'bidOpening']);
    expect(nodes.find(n => n.key === 'bidOpening')?.time).toMatch('2026-08-02');
    expect(nodes.filter(n => !n.time).map(n => n.key)).toEqual(['documentAcquire', 'bidDeadline', 'contractSign', 'archived']);
  });

  it('项目不存在 → 404', async () => {
    const prisma = mk(null);
    await expect(new TimelineService(prisma as any).getTimeline('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
