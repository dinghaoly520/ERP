import { NotFoundException } from '@nestjs/common';
import { BID_DEADLINE_BEFORE_OPENING_MS, formatDurationCn } from '@water-erp/shared';
import { TimelineService } from './timeline.service';

/** B3 项目时间信息轴（CTS-EBS01 A-204）：聚合各域时间节点，有值升序、缺值垫底 */
describe('TimelineService（B3 A-204）', () => {
  const mk = (pmi: any, bp: any = null, contract: any = null, stage: any = null, published: any[] = [], opts: { hasPublicStage?: boolean | null; firstRsvp?: any; handoverPacket?: any; handoverAsset?: any } = {}) => ({
    projectManagementItem: { findUnique: jest.fn().mockResolvedValue(pmi) },
    bidProject: { findFirst: jest.fn().mockResolvedValue(bp), findMany: jest.fn().mockResolvedValue([]) },
    contract: { findFirst: jest.fn().mockResolvedValue(contract) },
    // 评标结束（2026-10-13）：回流包 packet → FileAsset.createdAt
    bidSignPacket: { findFirst: jest.fn().mockResolvedValue(opts.handoverPacket ?? null) },
    fileAsset: { findUnique: jest.fn().mockResolvedValue(opts.handoverAsset ?? null) },
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
      'initiation', 'bidNoticePublish', 'documentAcquire', 'bidDeadline', 'bidOpening', 'evaluationEnd',
      'winNoticePublish', 'failedNoticePublish', 'contractSign', 'archived',
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
    // BP.deadline 未登记但有开标时间 → 投标截止按开标前间隔常量（10 分钟）自动推算，不再显示未登记
    expect(nodes.filter(n => n.time).map(n => n.key)).toEqual(['initiation', 'bidDeadline', 'bidOpening']);
    // Prisma DateTime 为 instant 锚定（timestamp without tz 由驱动按 UTC 读写）——
    // 时间轴 ISO 输出必须恒等。此前 toIsoFromBare 按「DB 裸值=本地时刻」假设 −8h 补偿，
    // 与写侧本地构造口径双重折算：立项 2026-10-08 显示成 10-07 16:00（2026-10-09 实录）
    expect(nodes.find(n => n.key === 'initiation')!.time).toBe('2026-07-01T00:00:00.000Z');
    // 字符串开标时间按本地语义解析（10:00 本地）——本地渲染往返恒为 10 点，跨时区 runner 皆成立
    const openingLocal = new Date(nodes.find(n => n.key === 'bidOpening')!.time!);
    expect(`${openingLocal.getFullYear()}-${openingLocal.getMonth() + 1}-${openingLocal.getDate()}`).toBe('2026-8-2');
    expect(openingLocal.getHours()).toBe(10);
    const deadlineNode = nodes.find(n => n.key === 'bidDeadline')!;
    expect(deadlineNode.source).toBe(`按开标时间推算（前${formatDurationCn(BID_DEADLINE_BEFORE_OPENING_MS)}）`);
    expect(new Date(deadlineNode.time!).getTime()).toBe(new Date(openingLocal.getTime() - BID_DEADLINE_BEFORE_OPENING_MS).getTime());
    expect(nodes.filter(n => !n.time).map(n => n.key)).toEqual(['bidNoticePublish', 'documentAcquire', 'evaluationEnd', 'winNoticePublish', 'failedNoticePublish', 'contractSign', 'archived']);
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
    expect(init.time).toBe('2026-09-07T02:00:00.000Z'); // 建档时刻 instant 恒等输出
    expect(init.source).toBe('项目建档');
    expect(nodes.find(n => n.key === 'archived')!.time).toBe('2026-09-07T06:00:00.000Z');
    const sign = nodes.find(n => n.key === 'contractSign')!;
    expect(sign.time).toBeTruthy();
    expect(sign.source).toBe('合同阶段完成');
  });

  it('公告发布时间（2026-10-13 改口径）：采购/中标公告取关联公告的最后一次 publishDate（重发后以末次为准）', async () => {
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
    expect(bid.time).toMatch(/^2026-09-12/); // 两次 BID_NOTICE，取末次（9/12）而非首发布（9/10）
    expect(bid.source).toBe('公告');
    expect(win.time).toMatch(/^2026-09-25/); // 成交(9/25)晚于预成交(9/20)，取末次
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

  it('评标结束（2026-10-13）= :3007 回流包生成时刻（handoverFileAssetId → FileAsset.createdAt）；未回流 → 未登记', async () => {
    const base = { id: 'pmi-5', projectCode: 'SWHI-YQ-2026090703', initiationDate: new Date('2026-09-01T00:00:00Z'), documentAcquireTime: null, bidOpeningTime: null, archivedAt: null };
    const withHandover = mk(base, null, null, null, [], {
      handoverPacket: { handoverFileAssetId: 'asset-h1' },
      handoverAsset: { createdAt: new Date('2026-09-15T09:30:00Z') },
    });
    let nodes = await new TimelineService(withHandover as any).getTimeline('pmi-5');
    const ev = nodes.find(n => n.key === 'evaluationEnd')!;
    expect(ev.label).toBe('评标结束');
    expect(ev.time).toMatch(/^2026-09-15T09:30/);
    expect(ev.source).toBe('评标回流包');
    // 查询口径：仅取已回流（handoverFileAssetId 非空）的签字包，多轮取最新
    expect(withHandover.bidSignPacket.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ handoverFileAssetId: { not: null } }),
      orderBy: { generatedAt: 'desc' },
    }));

    const noHandover = mk(base);
    nodes = await new TimelineService(noHandover as any).getTimeline('pmi-5');
    expect(nodes.find(n => n.key === 'evaluationEnd')!.time).toBeNull();

    // 边界：packet 置位但资产行已删（FileAsset 清理）→ 不抛错、未登记
    const orphanAsset = mk(base, null, null, null, [], {
      handoverPacket: { handoverFileAssetId: 'asset-gone' },
      handoverAsset: null,
    });
    nodes = await new TimelineService(orphanAsset as any).getTimeline('pmi-5');
    expect(nodes.find(n => n.key === 'evaluationEnd')!.time).toBeNull();
  });

  it('流标公告发布（2026-10-13）= FAILED_BID_NOTICE 的最后一次发布时刻', async () => {
    const prisma = mk(
      { id: 'pmi-6', projectCode: 'SWHI-JJ-2026090707', initiationDate: new Date('2026-09-01T00:00:00Z'), documentAcquireTime: null, bidOpeningTime: null, archivedAt: null },
      null, null, null,
      [
        { type: 'FAILED_BID_NOTICE', publishDate: new Date('2026-09-18T10:00:00Z'), createdAt: new Date('2026-09-18T10:00:00Z') },
        { type: 'FAILED_BID_NOTICE', publishDate: new Date('2026-09-20T10:00:00Z'), createdAt: new Date('2026-09-20T10:00:00Z') },
      ],
    );
    const nodes = await new TimelineService(prisma as any).getTimeline('pmi-6');
    const failed = nodes.find(n => n.key === 'failedNoticePublish')!;
    expect(failed.label).toBe('流标公告发布');
    expect(failed.time).toMatch(/^2026-09-20/); // 两次流标公告取末次
    expect(failed.source).toBe('公告');
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

  it('纯日期区间（无时分）不被次段年份误读成时分——"10月10日-2026年10月14日"回归', async () => {
    // 2026-10-12 实录：旧正则时分组冒号可选，\D+ 跨段吞位把次段年份 2026 的
    // "20""26" 当成 20:26 → 单点 2026-10-10 20:26，区间终点丢失
    const prisma = mk(
      {
        id: 'pmi-1',
        initiationDate: new Date('2026-03-18T00:00:00Z'),
        documentAcquireTime: '2026年10月10日-2026年10月14日',
        bidOpeningTime: null,
        archivedAt: null,
      },
      { deadline: null, openTime: null },
      null,
    );
    const nodes = await new TimelineService(prisma as any).getTimeline('pmi-1');
    const acquire = nodes.find(n => n.key === 'documentAcquire');
    // 本地零点 → ISO 为 UTC 前一日 16:00（前端渲染时转回本地 10-10/10-14 00:00）
    expect(acquire?.time).toBe('2026-10-09T16:00:00.000Z'); // 起点零点，不是 20:26
    expect(acquire?.timeEnd).toBe('2026-10-13T16:00:00.000Z'); // 终点恢复成区间
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
