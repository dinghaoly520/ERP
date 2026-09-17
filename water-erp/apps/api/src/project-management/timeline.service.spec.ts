import { NotFoundException } from '@nestjs/common';
import { TimelineService } from './timeline.service';

/** B3 项目时间信息轴（CTS-EBS01 A-204）：聚合各域时间节点，有值升序、缺值垫底 */
describe('TimelineService（B3 A-204）', () => {
  const mk = (pmi: any, bp: any = null, contract: any = null, stage: any = null, published: any[] = [], opts: { hasPublicStage?: boolean | null; firstRsvp?: any } = {}) => ({
    projectManagementItem: { findUnique: jest.fn().mockResolvedValue(pmi) },
    bidProject: { findFirst: jest.fn().mockResolvedValue(bp), findMany: jest.fn().mockResolvedValue([]) },
    contract: { findFirst: jest.fn().mockResolvedValue(contract) },
    // findFirst 两用：PUBLIC_ANNOUNCEMENT 存在性（默认有→走公告分支）与 CONTRACT 兜底（stage）
    projectManagementStage: { findFirst: jest.fn().mockImplementation((args: any) =>
      args?.where?.stageKey === 'PUBLIC_ANNOUNCEMENT'
        ? (opts.hasPublicStage === false ? null : { id: 'pub-stage' })
        : stage) },
    announcement: { findMany: jest.fn().mockResolvedValue(published) },
    invitationRsvp: { findFirst: jest.fn().mockResolvedValue(opts.firstRsvp ?? null) },
  });

  it('固定业务顺序（2026-09-08）：时间乱序（归档早于文件获取/开标）也不重排', async () => {
    const prisma = mk(
      {
        id: 'pmi-1',
        createdAt: new Date('2026-06-30T00:00:00Z'),
        // 刻意乱序：归档(8/20)早于文件获取(9/10)与开标(9/12)——固定顺序下不得重排
        initiationDate: new Date('2026-07-01T00:00:00Z'),
        documentAcquireTime: '2026-09-10',
        bidOpeningTime: null,
        archivedAt: new Date('2026-08-20T00:00:00Z'),
      },
      { deadline: new Date('2026-09-11T00:00:00Z'), openTime: new Date('2026-09-12T00:00:00Z') },
      { signedAt: new Date('2026-08-21T00:00:00Z') },
    );
    const nodes = await new TimelineService(prisma as any).getTimeline('pmi-1');
    expect(nodes.map(n => n.key)).toEqual([
      'initiation', 'documentAcquire', 'bidNoticePublish', 'bidDeadline', 'bidOpening',
      'winNoticePublish', 'contractSign', 'archived',
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
    // BP.deadline 未登记但有开标时间 → 投标截止按「开标前 24 小时」自动推算，不再显示未登记
    expect(nodes.filter(n => n.time).map(n => n.key)).toEqual(['initiation', 'bidDeadline', 'bidOpening']);
    // Prisma 裸值时间经 toIsoFromBare 按"本地时刻"输出——前端 new Date() 解析后应回到裸值日期
    const initiationLocal = new Date(nodes.find(n => n.key === 'initiation')!.time!);
    expect(`${initiationLocal.getFullYear()}-${initiationLocal.getMonth() + 1}-${initiationLocal.getDate()}`).toBe('2026-7-1');
    const openingLocal = new Date(nodes.find(n => n.key === 'bidOpening')!.time!);
    expect(`${openingLocal.getFullYear()}-${openingLocal.getMonth() + 1}-${openingLocal.getDate()}`).toBe('2026-8-2');
    const deadlineNode = nodes.find(n => n.key === 'bidDeadline')!;
    expect(deadlineNode.source).toBe('按开标时间推算（前24小时）');
    expect(new Date(deadlineNode.time!).getTime()).toBe(new Date(openingLocal.getTime() - 24 * 3600 * 1000).getTime());
    expect(nodes.filter(n => !n.time).map(n => n.key)).toEqual(['documentAcquire', 'bidNoticePublish', 'winNoticePublish', 'contractSign', 'archived']);
  });

  it('兜底：立项缺 initiationDate → 建档时刻；合同缺 Contract 记录 → CONTRACT 阶段完成时刻', async () => {
    const prisma = mk(
      { id: 'pmi-1', createdAt: new Date('2026-09-07T02:00:00Z'), initiationDate: null, documentAcquireTime: null, bidOpeningTime: null, archivedAt: new Date('2026-09-07T06:00:00Z') },
      null,
      null, // 无 Contract 行
      { completedAt: new Date('2026-09-07T05:00:00Z') }, // CONTRACT 阶段已完成
    );
    const nodes = await new TimelineService(prisma as any).getTimeline('pmi-1');
    const init = nodes.find(n => n.key === 'initiation')!;
    expect(init.time).toBeTruthy();
    expect(init.source).toBe('项目建档');
    const sign = nodes.find(n => n.key === 'contractSign')!;
    expect(sign.time).toBeTruthy();
    expect(sign.source).toBe('合同阶段完成');
  });

  it('公告发布时间（2026-09-16）：采购/中标公告取关联公告的最早 publishDate', async () => {
    const prisma = mk(
      { id: 'pmi-1', projectCode: 'SWHI-TP-2026090901', initiationDate: new Date('2026-09-01T00:00:00Z'), documentAcquireTime: null, bidOpeningTime: null, archivedAt: null },
      null, null, null,
      [
        { type: 'BID_NOTICE', publishDate: new Date('2026-09-10T10:00:00Z'), createdAt: new Date('2026-09-10T10:00:00Z') },
        { type: 'BID_NOTICE', publishDate: new Date('2026-09-12T10:00:00Z'), createdAt: new Date('2026-09-12T10:00:00Z') },
        { type: 'PRE_WIN_NOTICE', publishDate: new Date('2026-09-20T10:00:00Z'), createdAt: new Date('2026-09-20T10:00:00Z') },
        { type: 'WIN_NOTICE', publishDate: new Date('2026-09-25T10:00:00Z'), createdAt: new Date('2026-09-25T10:00:00Z') },
      ],
    );
    const nodes = await new TimelineService(prisma as any).getTimeline('pmi-1');
    const bid = nodes.find(n => n.key === 'bidNoticePublish')!;
    const win = nodes.find(n => n.key === 'winNoticePublish')!;
    expect(bid.time).toMatch(/^2026-09-10/);
    expect(bid.source).toBe('公告');
    expect(win.time).toMatch(/^2026-09-20/); // 预成交(9/20)早于成交(9/25)
    expect(prisma.announcement.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'PUBLISHED' }),
    }));
  });

  it('无公告步骤（谈判/直接采购）→ 第三节点为「供应商邀请」，取最早邀请通知批次时刻', async () => {
    const prisma = mk(
      { id: 'pmi-9', projectCode: 'SWHI-TP-2026091601', initiationDate: new Date('2026-09-16T00:00:00Z'), documentAcquireTime: null, bidOpeningTime: null, archivedAt: null },
      null, null, null, [],
      { hasPublicStage: false, firstRsvp: { createdAt: new Date('2026-09-16T10:00:00Z') } },
    );
    const nodes = await new TimelineService(prisma as any).getTimeline('pmi-9');
    const invite = nodes.find(n => n.key === 'supplierInvitation')!;
    expect(invite.label).toBe('供应商邀请');
    expect(invite.source).toBe('邀请通知');
    expect(invite.time).toMatch(/^2026-09-16/);
    expect(prisma.invitationRsvp.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ projectId: { in: expect.arrayContaining(['pmi-9']) } }),
    }));
  });

  it('项目不存在 → 404', async () => {
    const prisma = mk(null);
    await expect(new TimelineService(prisma as any).getTimeline('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('AI 提取的中文时间可解析：documentAcquireTime 区间文本起止、bidOpeningTime 中文时刻', async () => {
    const prisma = mk(
      {
        id: 'pmi-1',
        initiationDate: new Date('2026-03-18T00:00:00Z'),
        // AI 提取的原始区间文本——曾因 new Date() 解析失败显示"未登记"
        documentAcquireTime: '2026年03月23日09:00至2026年03月26日15:00',
        bidOpeningTime: '2026年3月23日14:00',
        archivedAt: null,
      },
      { deadline: null, openTime: null },
      null,
    );
    const nodes = await new TimelineService(prisma as any).getTimeline('pmi-1');
    const acquire = nodes.find(n => n.key === 'documentAcquire');
    const opening = nodes.find(n => n.key === 'bidOpening');
    expect(acquire?.time).not.toBeNull(); // 区间起点 2026-03-23 09:00
    expect(acquire?.time).toMatch(/^2026-03-23/);
    expect(acquire?.timeEnd).toMatch(/^2026-03-26/); // 区间终点 2026-03-26 15:00
    expect(opening?.time).toMatch(/^2026-03-23/); // 中文时刻 → 2026-03-23 14:00（本地）
    expect(opening?.timeEnd).toBeUndefined(); // 非区间节点无终点
  });

  it('上传同步的单点 documentAcquireTime（无区间）→ timeEnd 为 null', async () => {
    const prisma = mk(
      {
        id: 'pmi-1',
        initiationDate: new Date('2026-03-18T00:00:00Z'),
        documentAcquireTime: '2026年08月27日14:58',
        bidOpeningTime: null,
        archivedAt: null,
      },
      { deadline: null, openTime: null },
      null,
    );
    const nodes = await new TimelineService(prisma as any).getTimeline('pmi-1');
    const acquire = nodes.find(n => n.key === 'documentAcquire');
    expect(acquire?.time).toMatch(/^2026-08-27/);
    expect(acquire?.timeEnd).toBeNull();
  });

  it('彻底无法解析的文本 → 该节点仍为未登记（null），不影响其他节点', async () => {
    const prisma = mk(
      {
        id: 'pmi-1',
        initiationDate: new Date('2026-03-18T00:00:00Z'),
        documentAcquireTime: '见公告',
        bidOpeningTime: '',
        archivedAt: null,
      },
      { deadline: null, openTime: null },
      null,
    );
    const nodes = await new TimelineService(prisma as any).getTimeline('pmi-1');
    expect(nodes.find(n => n.key === 'documentAcquire')?.time).toBeNull();
    const initiationLocal = new Date(nodes.find(n => n.key === 'initiation')!.time!);
    expect(`${initiationLocal.getFullYear()}-${initiationLocal.getMonth() + 1}-${initiationLocal.getDate()}`).toBe('2026-3-18');
  });
});
