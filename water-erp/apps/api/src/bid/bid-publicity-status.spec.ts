import { BidService } from './bid.service';

/**
 * getPublicityStatus 公示载体识别——发布向导「中标公告」（WIN_BID_NOTICE）轨道。
 * 2026-10-19 实测缺陷：定标阶段经发布向导发布中标公告（type=WIN_BID_NOTICE）后，
 * 中标通知书对话框/开标确认面板仍提示「尚未发布中标候选人公示」，中标通知书被
 * PUBLICITY_NOT_ENDED 永久卡死——公示载体查找只认 PRE_WIN_NOTICE/WIN_NOTICE。
 */
describe('BidService — getPublicityStatus 中标公告（WIN_BID_NOTICE）公示载体识别', () => {
  const generatedAt = new Date('2026-09-28T08:00:00.000Z');
  const annCreatedAt = new Date('2026-09-29T08:00:00.000Z');
  const publicityEndPast = new Date('2026-10-02T08:00:00.000Z');
  const publicityEndFuture = new Date('2999-01-01T00:00:00.000Z');

  const winBidAnnouncement = (overrides: Record<string, unknown> = {}) => ({
    id: 'ann-winbid-1',
    title: '中标公告：智慧水务平台建设',
    type: 'WIN_BID_NOTICE',
    status: 'PUBLISHED',
    publishDate: annCreatedAt,
    publicityEnd: publicityEndPast,
    ...overrides,
  });

  const makeService = (announceFindFirst: jest.Mock) => {
    const prisma: any = {
      bidProject: {
        findUnique: jest.fn().mockResolvedValue({ projectCode: 'BID-1787', projectManagementItemId: 'pmi-1' }),
      },
      projectManagementItem: {
        findUnique: jest.fn().mockResolvedValue({ projectCode: 'ZJ-2026001' }),
      },
      bidEvaluationResult: {
        // 第一次调用：最近评标结果 generatedAt（roundFilter 用）；第二次：rank1 推荐中标人
        findFirst: jest.fn().mockImplementation((args: any) =>
          args?.where?.recommended
            ? Promise.resolve({ supplierName: '四川水发建设有限公司', bidPrice: 1539500 })
            : Promise.resolve({ generatedAt }),
        ),
      },
      announcement: { findFirst: announceFindFirst },
    };
    const service = Object.create(BidService.prototype) as BidService;
    Object.assign(service as object, { prisma });
    return { service, prisma };
  };

  it('已发布中标公告（WIN_BID_NOTICE，公示期满）→ 视为公示载体，可发出中标通知书', async () => {
    const findFirst = jest.fn().mockImplementation((args: any) =>
      args.where?.type === 'WIN_BID_NOTICE'
        ? Promise.resolve(winBidAnnouncement())
        : Promise.resolve(null),
    );
    const { service } = makeService(findFirst);

    const result: any = await service.getPublicityStatus('project-1');

    expect(result.hasPublicity).toBe(true);
    expect(result.canIssueAward).toBe(true);
    expect(result.publicityEnd).toBe(publicityEndPast);
    // 公示载体与已确认中标候选人随行（前端「公示载体」展示消费）
    expect(result.announcement).toMatchObject({ id: 'ann-winbid-1', type: 'WIN_BID_NOTICE' });
    expect(result.winner).toMatchObject({ supplierName: '四川水发建设有限公司' });
  });

  it('中标公告公示期未满 → hasPublicity=true 但 canIssueAward=false（法定公示期闸门不放松）', async () => {
    const findFirst = jest.fn().mockImplementation((args: any) =>
      args.where?.type === 'WIN_BID_NOTICE'
        ? Promise.resolve(winBidAnnouncement({ publicityEnd: publicityEndFuture }))
        : Promise.resolve(null),
    );
    const { service } = makeService(findFirst);

    const result: any = await service.getPublicityStatus('project-1');

    expect(result.hasPublicity).toBe(true);
    expect(result.canIssueAward).toBe(false);
  });

  it('中标公告创建于本轮评标结果之前（评标结果重生成）→ 回落全量查找仍可识别', async () => {
    // roundFilter（createdAt > generatedAt）筛掉 → 各 type 的本轮查询均 null；
    // 回落全量查询（无 roundFilter）命中 WIN_BID_NOTICE
    const findFirst = jest.fn().mockImplementation((args: any) => {
      if (args.where?.type === 'WIN_BID_NOTICE' && !args.where?.createdAt) {
        return Promise.resolve(winBidAnnouncement());
      }
      return Promise.resolve(null);
    });
    const { service } = makeService(findFirst);

    const result: any = await service.getPublicityStatus('project-1');

    expect(result.canIssueAward).toBe(true);
    expect(result.announcement).toMatchObject({ id: 'ann-winbid-1' });
  });

  it('无任何公示公告 → hasPublicity=false / canIssueAward=false，announcement=null', async () => {
    const { service } = makeService(jest.fn().mockResolvedValue(null));

    const result: any = await service.getPublicityStatus('project-1');

    expect(result.hasPublicity).toBe(false);
    expect(result.canIssueAward).toBe(false);
    expect(result.announcement).toBeNull();
    expect(result.winner).toMatchObject({ supplierName: '四川水发建设有限公司' });
  });

  it('中标公告为草稿（未发布）→ 不构成公示', async () => {
    const findFirst = jest.fn().mockImplementation((args: any) =>
      args.where?.type === 'WIN_BID_NOTICE'
        ? Promise.resolve(winBidAnnouncement({ status: 'DRAFT', publicityEnd: null }))
        : Promise.resolve(null),
    );
    const { service } = makeService(findFirst);

    const result: any = await service.getPublicityStatus('project-1');

    expect(result.hasPublicity).toBe(false);
    expect(result.canIssueAward).toBe(false);
  });

  it('预成交公示草稿（归档自动生成）不得遮蔽已发布的中标公告', async () => {
    const findFirst = jest.fn().mockImplementation((args: any) => {
      if (args.where?.type === 'PRE_WIN_NOTICE') {
        return Promise.resolve({
          id: 'ann-pre-draft', title: '预成交公示：智慧水务平台建设', type: 'PRE_WIN_NOTICE',
          status: 'DRAFT', publishDate: annCreatedAt, publicityEnd: null,
        });
      }
      if (args.where?.type === 'WIN_BID_NOTICE') {
        return Promise.resolve(winBidAnnouncement());
      }
      return Promise.resolve(null);
    });
    const { service } = makeService(findFirst);

    const result: any = await service.getPublicityStatus('project-1');

    expect(result.hasPublicity).toBe(true);
    expect(result.canIssueAward).toBe(true);
    expect(result.announcement).toMatchObject({ id: 'ann-winbid-1', type: 'WIN_BID_NOTICE' });
  });

  it('存量中标公告（修复前发布，publicityEnd 恒 null）→ 读时按 publishDate+3d 推导自愈', async () => {
    // publishDate 5 天前 → 推导公示截止（+3d）已过 → 闸门开启（无需数据迁移）
    const legacyPublish = new Date('2026-10-14T08:00:00.000Z');
    const findFirst = jest.fn().mockImplementation((args: any) =>
      args.where?.type === 'WIN_BID_NOTICE'
        ? Promise.resolve(winBidAnnouncement({ publishDate: legacyPublish, publicityEnd: null }))
        : Promise.resolve(null),
    );
    const { service } = makeService(findFirst);

    const result: any = await service.getPublicityStatus('project-1');

    expect(result.hasPublicity).toBe(true);
    expect(result.canIssueAward).toBe(true);
    expect(result.publicityEnd).toEqual(new Date('2026-10-17T08:00:00.000Z'));
  });

  it('新发布中标公告（publishDate=now，publicityEnd null）→ 推导公示期未满，canIssueAward=false', async () => {
    const findFirst = jest.fn().mockImplementation((args: any) =>
      args.where?.type === 'WIN_BID_NOTICE'
        ? Promise.resolve(winBidAnnouncement({ publishDate: new Date(), publicityEnd: null }))
        : Promise.resolve(null),
    );
    const { service } = makeService(findFirst);

    const result: any = await service.getPublicityStatus('project-1');

    expect(result.hasPublicity).toBe(true);
    expect(result.canIssueAward).toBe(false);
    expect(result.publicityEnd).toBeTruthy();
  });
});
