// apps/api/src/platform-push/platform-push.service.spec.ts
// 对接专项 Phase 1 定向 spec：pending 完整度判定 / preview hash 一致 / dispatch 幂等 409 /
// PAYLOAD_DRIFT 400 / stub 501 / mock 全链 / offline EXPORTED / 脱敏生效 / ITEM_NOT_READY。
// 依赖全部 mock（同 supervision-push.service.spec 的轻量直构风格）；通道用真实薄实现。
import { canonicalJson } from '@water-erp/ukey';
import * as crypto from 'crypto';
import { PlatformPushService } from './platform-push.service';
import { ScProvinceChannel } from './channels/sc-province.channel';
import { CebNationalChannel } from './channels/ceb-national.channel';
import { MwrWaterChannel } from './channels/mwr-water.channel';
import { MockChannel } from './channels/mock.channel';
import { OfflineExportChannel } from './channels/offline.export-channel';

const PROJECT = {
  id: 'p1', projectCode: 'BID-1786934256839', name: '引大济岷工程', gbProcureCode: 'GX-SC-2026-000000-01-001',
  procurementMethod: '公开招标', deadline: new Date('2026-08-20T09:00:00Z'), openTime: new Date('2026-08-21T09:00:00Z'),
  ceilingPrice: { toString: () => '1200000.00' } as any, budget: { toString: () => '1500000.00' } as any,
};

const ANN = {
  id: 'a1', type: 'BID_NOTICE', title: '引大济岷工程招标公告', content: '<p>正文</p>',
  publishDate: new Date('2026-08-05T00:00:00Z'), publicityEnd: null,
  relatedProjectCode: PROJECT.projectCode, metadata: null, status: 'PUBLISHED',
};

const CONTRACT = {
  id: 'c1', contractCode: 'HT-2026-001', supplierName: '中科院成都信息技术股份有限公司',
  amount: { toString: () => '980000.00' } as any, signedAt: new Date('2026-08-25T00:00:00Z'),
  contractType: 'standard', status: 'signed', projectCode: PROJECT.projectCode, projectId: PROJECT.id,
};

const PENALTY = {
  id: 'pen1', penaltyDocNo: '川水发罚〔2026〕15号', authority: '四川省水利厅',
  decisionDate: new Date('2026-07-01T00:00:00Z'), penaltyContent: '弄虚作假，限制投标 1 年',
  publicUntil: new Date('2027-07-01T00:00:00Z'), supplier: { name: '某建设集团有限公司' },
};

/** 单项路径（preview/dispatch/export——loadItems 走 findUnique） */
function makeSvc(ov: {
  bidProject?: unknown; announcements?: unknown[]; contracts?: unknown[]; penalties?: unknown[];
  existingLogs?: unknown[]; evalResults?: unknown[]; uploadError?: Error;
} = {}) {
  const created = { pushLogs: [] as any[], supervisionLogs: [] as any[], auditLogs: [] as any[], fileAssets: [] as any[] };
  const prisma = {
    bidProject: { findUnique: async (a: any) =>
      a.where.id === 'p1' || a.where.projectCode === PROJECT.projectCode ? (ov.bidProject ?? PROJECT) : null },
    announcement: { findUnique: async (a: any) => (a.where.id === 'a1' ? (ov.announcements?.[0] ?? ANN) : null) },
    contract: { findUnique: async (a: any) => (a.where.id === 'c1' ? (ov.contracts?.[0] ?? CONTRACT) : null) },
    supplierPenalty: { findUnique: async (a: any) => (a.where.id === 'pen1' ? (ov.penalties?.[0] ?? PENALTY) : null) },
    bidEvaluationResult: { findMany: async () => ov.evalResults ?? [] },
    platformPushLog: {
      findMany: async () => ov.existingLogs ?? [],
      count: async () => 0,
      create: async (a: any) => { created.pushLogs.push(a.data); return { id: `log-${created.pushLogs.length}`, ...a.data }; },
    },
    bidSupervisionLog: { create: async (a: any) => { created.supervisionLogs.push(a.data); return {}; } },
    auditLog: { create: async (a: any) => { created.auditLogs.push(a.data); return {}; } },
    fileAsset: { create: async (a: any) => { created.fileAssets.push(a.data); return { id: 'asset-1' }; } },
  };
  const storage = { upload: async () => { if (ov.uploadError) throw ov.uploadError; return { key: 'ok' }; } };
  const svc = new PlatformPushService(
    prisma as never,
    new ScProvinceChannel(), new CebNationalChannel(), new MwrWaterChannel(),
    new MockChannel(), new OfflineExportChannel(prisma as never, storage as never),
  );
  return { svc, created };
}

/** 批量路径（pending——findMany 三源聚合 + lastPush 归并） */
function makePendingSvc(data: { anns: any[]; contracts: any[]; penalties: any[]; project: any; logs?: any[] }) {
  const prisma = {
    bidProject: { findUnique: async () => data.project },
    announcement: { findMany: async () => data.anns },
    contract: { findMany: async () => data.contracts },
    supplierPenalty: { findMany: async () => data.penalties },
    platformPushLog: { findMany: async () => data.logs ?? [], count: async () => 0, create: async (a: any) => ({ id: 'l', ...a.data }) },
    bidSupervisionLog: { create: async () => ({}) },
    auditLog: { create: async () => ({}) },
    fileAsset: { create: async () => ({ id: 'a' }) },
    bidEvaluationResult: { findMany: async () => [] },
  };
  return new PlatformPushService(
    prisma as never,
    new ScProvinceChannel(), new CebNationalChannel(), new MwrWaterChannel(),
    new MockChannel(), new OfflineExportChannel(prisma as never, { upload: async () => ({}) } as never),
  );
}

const sha = (v: unknown) => crypto.createHash('sha256').update(canonicalJson(v as any)).digest('hex');

describe('PlatformPushService.pending 完整度判定', () => {
  it('公告/合同/全局处罚三源聚合；缺 gbProcureCode+publishDate 的公告行 missing 标注禁推', async () => {
    const svc = makePendingSvc({
      anns: [{ ...ANN, publishDate: null }],
      contracts: [CONTRACT],
      penalties: [PENALTY],
      project: { ...PROJECT, gbProcureCode: null },
    });
    const out = await svc.pending({ projectId: 'p1' });
    const annRow = out.items.find((i: any) => i.itemId === 'announcement:a1')!;
    expect(annRow.ready).toBe(false);
    expect(annRow.missing).toEqual(expect.arrayContaining(['gbProcureCode', 'publishDate']));
    // 同项目缺码传导至合同行；金额/签约时间完整
    const conRow = out.items.find((i: any) => i.itemId === 'contract:c1')!;
    expect(conRow.missing).toEqual(['gbProcureCode']);
    // 处罚为全局行（不挂项目），结构化字段全量 → ready
    const penaltyRow = out.items.find((i: any) => i.itemId === 'penalty:pen1')!;
    expect(penaltyRow.ready).toBe(true);
    expect(penaltyRow.missing).toEqual([]);
    expect(out.project.gbProcureCode).toBeNull();
    expect(out.channels.map((c: any) => c.code)).toEqual(['sc_province', 'ceb_national', 'mwr_water', 'mock', 'offline']);
  });

  it('映射完整时 ready=true 且 lastPush 挂最近一次推送态', async () => {
    const svc = makePendingSvc({
      anns: [ANN], contracts: [], penalties: [], project: PROJECT,
      logs: [{ itemId: 'announcement:a1', channel: 'mock', status: 'SUCCESS', createdAt: new Date(), responseSnippet: 'MOCK-1' }],
    });
    const out = await svc.pending({ projectId: 'p1' });
    const annRow = out.items.find((i: any) => i.itemId === 'announcement:a1')!;
    expect(annRow.ready).toBe(true);
    expect(annRow.lastPush).toMatchObject({ channel: 'mock', status: 'SUCCESS', responseSnippet: 'MOCK-1' });
  });

  it('项目不存在 → 404 PROJECT_NOT_FOUND', async () => {
    const svc = makePendingSvc({ anns: [], contracts: [], penalties: [], project: null });
    await expect(svc.pending({ projectId: 'nope' })).rejects.toMatchObject({
      status: 404, response: { code: 'PROJECT_NOT_FOUND' },
    });
  });
});

describe('PlatformPushService.preview', () => {
  it('返回中间信封+payloadHash；hash=sha256(canonicalJson(envelope)) 且两次调用一致', async () => {
    const { svc } = makeSvc();
    const r1 = await svc.preview({ itemIds: ['announcement:a1'] });
    const r2 = await svc.preview({ itemIds: ['announcement:a1'] });
    expect(r1.items[0].payloadHash).toBe(r2.items[0].payloadHash);
    expect(r1.items[0].payloadHash).toBe(sha(r1.items[0].envelope));
    const env = r1.items[0].envelope;
    expect(env.schema).toBe('sc-v2-preview');
    expect(env.itemType).toBe('bid_notice');
    expect(env.gbProcureCode).toBe(PROJECT.gbProcureCode);
    expect(env.fields.procurementMethod).toBe('公开招标');
  });

  it('脱敏生效：mask.ceilingPrice → fields.ceilingPrice=null 且 masked 记录、hash 随之变化', async () => {
    const { svc } = makeSvc();
    const r = await svc.preview({ itemIds: ['announcement:a1'], mask: { ceilingPrice: true } });
    expect(r.items[0].envelope.fields.ceilingPrice).toBeNull();
    expect(r.items[0].envelope.masked).toEqual(['ceilingPrice']);
    const plain = await svc.preview({ itemIds: ['announcement:a1'] });
    expect(plain.items[0].envelope.fields.ceilingPrice).toBe('1200000.00');
    expect(r.items[0].payloadHash).not.toBe(plain.items[0].payloadHash);
  });

  it('不完整行 preview → 400 ITEM_NOT_READY', async () => {
    const { svc } = makeSvc({ bidProject: { ...PROJECT, gbProcureCode: null } });
    await expect(svc.preview({ itemIds: ['announcement:a1'] })).rejects.toMatchObject({
      status: 400, response: { code: 'ITEM_NOT_READY' },
    });
  });

  it('itemId 前缀不合法 → 400 INVALID_ITEM_ID', async () => {
    const { svc } = makeSvc();
    await expect(svc.preview({ itemIds: ['plan:xyz'] })).rejects.toMatchObject({
      status: 400, response: { code: 'INVALID_ITEM_ID' },
    });
  });
});

describe('PlatformPushService.dispatch（人工确认制铁律）', () => {
  it('hash 不一致 → 400 PAYLOAD_DRIFT', async () => {
    const { svc } = makeSvc();
    await expect(svc.dispatch({
      itemIds: ['announcement:a1'], channel: 'mock',
      payloadHashes: [{ itemId: 'announcement:a1', payloadHash: '0'.repeat(64) }],
    }, 'u1')).rejects.toMatchObject({ status: 400, response: { code: 'PAYLOAD_DRIFT' } });
  });

  it('幂等三元组命中 → 409 ALREADY_PUSHED', async () => {
    const { svc: s0 } = makeSvc();
    const hash = (await s0.preview({ itemIds: ['announcement:a1'] })).items[0].payloadHash;
    const { svc } = makeSvc({ existingLogs: [{ itemId: 'announcement:a1' }] });
    await expect(svc.dispatch({
      itemIds: ['announcement:a1'], channel: 'mock',
      payloadHashes: [{ itemId: 'announcement:a1', payloadHash: hash }],
    }, 'u1')).rejects.toMatchObject({ status: 409, response: { code: 'ALREADY_PUSHED' } });
  });

  it('stub 通道 → 落 STUB_REFUSED 台账行后 501 CHANNEL_NOT_CONNECTED', async () => {
    const { svc, created } = makeSvc();
    const hash = (await svc.preview({ itemIds: ['announcement:a1'] })).items[0].payloadHash;
    await expect(svc.dispatch({
      itemIds: ['announcement:a1'], channel: 'sc_province',
      payloadHashes: [{ itemId: 'announcement:a1', payloadHash: hash }],
    }, 'u1')).rejects.toMatchObject({ status: 501, response: { code: 'CHANNEL_NOT_CONNECTED' } });
    expect(created.pushLogs).toHaveLength(1);
    expect(created.pushLogs[0]).toMatchObject({ channel: 'sc_province', status: 'STUB_REFUSED', itemType: 'bid_notice' });
  });

  it('mock 通道全链：SUCCESS 台账行（回执前缀 MOCK-）+ 监督日志 + AuditLog 各就位', async () => {
    const { svc, created } = makeSvc();
    const hash = (await svc.preview({ itemIds: ['announcement:a1'] })).items[0].payloadHash;
    const r = await svc.dispatch({
      itemIds: ['announcement:a1'], channel: 'mock',
      payloadHashes: [{ itemId: 'announcement:a1', payloadHash: hash }],
    }, 'u1');
    expect(r.channel).toBe('mock');
    expect(r.results[0].status).toBe('SUCCESS');
    expect(r.results[0].responseSnippet).toMatch(/^MOCK-\d+$/);
    expect(created.pushLogs[0]).toMatchObject({ channel: 'mock', itemType: 'bid_notice', payloadSha256: hash, createdById: 'u1' });
    expect(created.supervisionLogs[0]).toMatchObject({ action: '上级平台推送', riskFlag: '无', operatorId: 'u1', projectId: 'p1' });
    expect(created.auditLogs[0]).toMatchObject({ userId: 'u1', action: 'PLATFORM_PUSH' });
  });

  it('offline 走 dispatch → 400 OFFLINE_USE_EXPORT（离线须走 export 端点）', async () => {
    const { svc } = makeSvc();
    await expect(svc.dispatch({
      itemIds: ['announcement:a1'], channel: 'offline',
      payloadHashes: [{ itemId: 'announcement:a1', payloadHash: '0'.repeat(64) }],
    }, 'u1')).rejects.toMatchObject({ status: 400, response: { code: 'OFFLINE_USE_EXPORT' } });
  });
});

describe('PlatformPushService.exportItems（offline 三件套）', () => {
  it('EXPORTED 台账行 + FileAsset(platform_push_package) + 下载 URL；脱敏随载荷进导出包', async () => {
    const { svc, created } = makeSvc();
    const preview = await svc.preview({ itemIds: ['contract:c1'], mask: { contractAmount: true } });
    const hash = preview.items[0].payloadHash;
    expect(preview.items[0].envelope.fields.amount).toBeNull();
    expect(preview.items[0].envelope.masked).toEqual(['contractAmount']);
    const r = await svc.exportItems({
      itemIds: ['contract:c1'], mask: { contractAmount: true },
      payloadHashes: [{ itemId: 'contract:c1', payloadHash: hash }],
    }, 'u1');
    expect(r.results[0].status).toBe('EXPORTED');
    expect(r.results[0].packetAssetId).toBe('asset-1');
    expect(r.results[0].downloadUrl).toBe('/api/upload/files/asset-1');
    expect(created.pushLogs[0]).toMatchObject({ channel: 'offline', status: 'EXPORTED', packetAssetId: 'asset-1', payloadSha256: hash });
    expect(created.fileAssets[0]).toMatchObject({ category: 'platform_push_package' });
    expect(created.fileAssets[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(created.fileAssets[0].key).toMatch(/^platform-push\/p1\/contract-\d+\.json$/);
  });

  it('通道异常（MinIO 不可用）→ FAILED 台账行且不丢留痕', async () => {
    const { svc, created } = makeSvc({ uploadError: new Error('minio down') });
    const hash = (await svc.preview({ itemIds: ['announcement:a1'] })).items[0].payloadHash;
    const r = await svc.exportItems({
      itemIds: ['announcement:a1'],
      payloadHashes: [{ itemId: 'announcement:a1', payloadHash: hash }],
    }, 'u1');
    expect(r.results[0].status).toBe('FAILED');
    expect(created.pushLogs[0].status).toBe('FAILED');
    expect(created.pushLogs[0].errorMessage).toContain('minio down');
  });
});
