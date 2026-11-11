import { SunshinePushService } from './sunshine-push.service';

/** SCM0003 变更公告推送（2026-11-11 变更体系）：单接口直发 changes 集合——
 *  不带 SCM0001 前缀（招标计划已由首发公告建立），round=变更轮次。 */

describe('SunshinePushService — SCM0003 变更公告', () => {
  const origFetch = global.fetch;
  afterEach(() => {
    (global as unknown as { fetch: unknown }).fetch = origFetch;
  });

  const mk = () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 0, msg: 'ok' }) });
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
    process.env.SUNSHINE_PUSH_ENABLED = 'true';
    process.env.SUNSHINE_API_URL = 'http://sunshine.test';
    process.env.SUNSHINE_IDENTITY = 'id-1';
    const prisma: any = { announcement: { update: jest.fn().mockResolvedValue({}) } };
    return { fetchMock, svc: new SunshinePushService(prisma) };
  };

  it('SCM0003 快照：仅一次 POST /announcementChanges，round 取快照轮次，不触 /information', async () => {
    const { fetchMock, svc } = mk();
    await svc.onPublish({
      id: 'ann-1',
      content: '<p>变更内容</p>',
      metadata: {
        sunshinePublish: {
          enabled: true,
          interfaceCode: 'SCM0003',
          projectId: 'bp-1',
          round: 2,
          issueType: 1,
          isExternal: 1,
          config: { publishTime: '2026-11-11T02:00:00.000Z', content: '变更说明' },
        },
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://sunshine.test/dataService/import/announcementChanges');
    const body = JSON.parse((init as any).body);
    expect(body.identity).toBe('id-1');
    expect(body.planUnique).toBe('bp-1');
    expect(body.changes).toHaveLength(1);
    expect(body.changes[0].round).toBe(2);
    expect(body.changes[0].unique).toBe('bp-1-change-2');
    expect(body.changes[0].publishTime).toBe('2026-11-11 10:00:00'); // +08 归一
    expect(body.changes[0].content).toContain('变更内容');
  });

  it('round 缺省兜底 1（旧快照容错）', async () => {
    const { fetchMock, svc } = mk();
    await svc.onPublish({
      id: 'ann-2',
      content: '正文',
      metadata: {
        sunshinePublish: {
          enabled: true, interfaceCode: 'SCM0003', projectId: 'bp-2',
          issueType: 1, isExternal: 1,
          config: { publishTime: '2026-11-11T02:00:00.000Z' },
        },
      },
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.changes[0].round).toBe(1);
  });
});
