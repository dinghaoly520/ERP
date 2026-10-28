import { SunshinePushService } from './sunshine-push.service';

/* 阳光采购推送服务单测：mock global.fetch + prisma.update。
   锁定：SCM0001 先行→公告侧随后、路径按接口编码、identity 注入、
   status≠0 中止留痕、env 未配 skipped 不触网。 */

const ENV = {
  SUNSHINE_PUSH_ENABLED: 'true',
  SUNSHINE_API_URL: 'http://preplatform2.scjzy.net',
  SUNSHINE_IDENTITY: 'test-identity-0001',
};

const snap = (interfaceCode: 'SCM0002' | 'SCM0004' | 'SCM0006') => ({
  sunshinePublish: {
    enabled: true,
    interfaceCode,
    projectId: 'proj-1',
    issueType: 1,
    isExternal: 1,
    config: {
      planCode: 'SWHI-TP-1', planName: '钻机采购', projectCode: 'SWHI-TP-1', projectName: '钻机采购',
      proctype: 24, type: 11, tenderAmount: 120, centralized: 1,
      handUserName: '张三', handOrganizationName: '采购中心', contacts: '张三', phone: '13800000000', email: 'a@b.c',
      organizationCode: 'ORG1', organizationName: '设计院', organizationUnique: 'U1', parentOrganization: '集团',
      standardQuota: 400, publicQuota: 200, procuringentity: 'PE1', packageName: '钻机采购',
      publishTime: '2026-10-28T10:00', deadline: '2026-11-04T10:00',
      annrequire: 1, annreason: '', startTime: '2026-10-28T10:00', endTime: '2026-10-31T10:00',
      issueUserName: '张三', content: '',
      candidates: [{ packageName: '钻机采购', packageUnique: 'proj-1', supplierName: '甲公司', ranking: 1, companyUnique: 'SUP1', bidAmount: 118 }],
    },
  },
});

describe('SunshinePushService', () => {
  let service: SunshinePushService;
  const fetchMock = jest.fn();
  const prisma = { announcement: { update: jest.fn().mockResolvedValue({}) } };

  beforeAll(() => { global.fetch = fetchMock as unknown as typeof fetch; });
  afterAll(() => { // @ts-expect-error 恢复宿主 fetch
    delete global.fetch; });
  beforeEach(() => {
    fetchMock.mockReset();
    prisma.announcement.update.mockReset().mockResolvedValue({});
    Object.entries(ENV).forEach(([k, v]) => (process.env[k] = v));
    service = new SunshinePushService(prisma as never);
  });
  afterEach(() => { Object.keys(ENV).forEach(k => delete process.env[k]); });

  const okBody = { json: async () => ({ status: 0, message: '成功' }) } as unknown as Response;

  it('SCM0002 流程：先推基础信息(/information)再推公告(/announcement)，identity 注入、时间格式、unique 溯源', async () => {
    fetchMock.mockResolvedValue(okBody);
    await service.onPublish({ id: 'ann-1', content: '<p>正文</p>', metadata: snap('SCM0002') });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [u1, b1] = fetchMock.mock.calls[0];
    const [u2, b2] = fetchMock.mock.calls[1];
    expect(u1).toBe('http://preplatform2.scjzy.net/dataService/import/information');
    expect(u2).toBe('http://preplatform2.scjzy.net/dataService/import/announcement');
    const p1 = JSON.parse(b1.body); const p2 = JSON.parse(b2.body);
    expect(p1.identity).toBe('test-identity-0001');
    expect(p1.unique).toBe('proj-1'); // projectId 溯源
    expect(p1.phase).toBe(4); // 采购公告 → 公告已发布
    expect(p1.createTime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/); // 文档必传（联调实录漏字段）
    expect(p2.planUnique).toBe('proj-1');
    expect(p2.publishTime).toBe('2026-10-28 10:00:00'); // datetime-local → 文档格式
    expect(p2.content).toBe('<p>正文</p>');
    // 留痕 ok
    const rec = prisma.announcement.update.mock.calls[prisma.announcement.update.mock.calls.length - 1][0].data.metadata;
    expect(rec.sunshinePushResult.ok).toBe(true);
    expect(rec.sunshinePushResult.results).toHaveLength(2);
  });

  it('SCM0004：走 /publicity，候选单位与空 changes 集合、isPublicityPublish 随对外口径', async () => {
    fetchMock.mockResolvedValue(okBody);
    await service.onPublish({ id: 'ann-2', content: '公示正文', metadata: snap('SCM0004') });
    const [u, b] = fetchMock.mock.calls[1];
    expect(u).toContain('/dataService/import/publicity');
    const p = JSON.parse(b.body);
    expect(p.unique).toBe('proj-1-publicity');
    expect(p.phase ?? p.isPublicityPublish).toBe(1);
    expect(p.candidates[0].supplierName).toBe('甲公司');
    expect(p.changes).toEqual([]);
  });

  it('基础信息返回非 0（status=4 主体缺失）→ 中止后续推送并留痕失败', async () => {
    fetchMock.mockResolvedValueOnce({ json: async () => ({ status: 4, message: '主体数据缺失' }) } as unknown as Response);
    await service.onPublish({ id: 'ann-3', content: 'x', metadata: snap('SCM0002') });
    expect(fetchMock).toHaveBeenCalledTimes(1); // 公告侧不再推
    const rec = prisma.announcement.update.mock.calls[prisma.announcement.update.mock.calls.length - 1][0].data.metadata;
    expect(rec.sunshinePushResult.ok).toBe(false);
    expect(rec.sunshinePushResult.results[0].status).toBe(4);
  });

  it('env 未启用 → skipped 留痕、不触网', async () => {
    delete process.env.SUNSHINE_PUSH_ENABLED;
    await service.onPublish({ id: 'ann-4', content: 'x', metadata: snap('SCM0002') });
    expect(fetchMock).not.toHaveBeenCalled();
    const rec = prisma.announcement.update.mock.calls[prisma.announcement.update.mock.calls.length - 1][0].data.metadata;
    expect(rec.sunshinePushResult.skipped).toBe(true);
  });

  it('快照未启用/缺失 → 完全静默（无留痕）', async () => {
    await service.onPublish({ id: 'ann-5', content: 'x', metadata: { other: 1 } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.announcement.update).not.toHaveBeenCalled();
  });
});
