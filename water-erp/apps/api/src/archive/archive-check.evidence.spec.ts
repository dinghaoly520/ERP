// apps/api/src/archive/archive-check.evidence.spec.ts
import * as crypto from 'node:crypto';
import { ArchiveCheckService } from './archive-check.service';

/**
 * 2026-09-22 P1-1：四性检测接入证据件收集器的锁定 spec。
 * 旧行为（红）：检测只覆盖 bid_opening_handover/bid_sign_packet/bid_decrypted + 评标完整性包精确 key，
 * 回流包本体/签字扫描/引用件零检测、引用悬空无 FAIL。
 */
const itemFixture = {
  title: '测试项目',
  stages: [],
  bidProjects: [{ id: 'bp1' }],
};

function makeMocks(overrides: {
  packet?: { fileAssetId: string | null; signPageScanFileId: string | null; handoverFileAssetId: string | null } | null;
  assets?: Array<{ id: string; key: string; originalName: string | null; category: string | null; sha256: string | null }>;
  download?: (key: string) => Promise<Buffer>;
} = {}) {
  const prisma = {
    projectManagementItem: { findUnique: jest.fn().mockResolvedValue(itemFixture) },
    expertMemo: { findMany: jest.fn().mockResolvedValue([]) },
    bidExpert: { findMany: jest.fn().mockResolvedValue([]) },
    bidSignPacket: { findUnique: jest.fn().mockResolvedValue(overrides.packet ?? null) },
    bidClarification: { findMany: jest.fn().mockResolvedValue([]) },
    aiBidAnalysisTask: { findUnique: jest.fn().mockResolvedValue(null) },
    // 分页全取按 skip 截片（与 asip spec 同款）
    fileAsset: {
      findMany: jest.fn().mockImplementation(async ({ skip }: { skip: number }) =>
        (overrides.assets ?? []).slice(skip, skip + 200)),
    },
    archiveCheckResult: { create: jest.fn().mockImplementation(async ({ data }: { data: any }) => data) },
  };
  const storage = {
    download: jest.fn(overrides.download ?? (async () => Buffer.from('x'))),
  };
  const svc = new ArchiveCheckService(
    prisma as never,
    storage as never,
    { snapshot: jest.fn().mockResolvedValue({ rows: [] }) } as never,
  );
  return { prisma, storage, svc };
}

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

describe('四性检测 · 证据件（M4 经共享收集器）', () => {
  it('回流包本体（bid_evaluation_sign_handover）纳入哈希+可读检测——指纹相符 → PASS', async () => {
    const content = Buffer.from('{"packageType":"BID_EVALUATION_SIGN_HANDOVER"}');
    const { svc } = makeMocks({
      assets: [
        { id: 'fa1', key: 'bid-sign-handover/bp1.json', originalName: '评标回流包-bp1.json', category: 'bid_evaluation_sign_handover', sha256: sha(content) },
      ],
      download: async (key: string) => (key === 'bid-sign-handover/bp1.json' ? content : Buffer.from('other')),
    });
    const r = await svc.run('pmi1');
    const readable = (r.details as any[]).find(d => d.materialName.includes('评标回流包') && d.check === '可用性-可读');
    const hash = (r.details as any[]).find(d => d.materialName.includes('评标回流包') && d.check === '完整性-哈希');
    expect(readable?.status).toBe('PASS');
    expect(hash?.status).toBe('PASS');
    expect(r.overall).toBe('PASSED');
  });

  it('登记指纹与内容不符 → 完整性-哈希 FAIL、overall=FAILED', async () => {
    const content = Buffer.from('tampered');
    const { svc } = makeMocks({
      assets: [
        { id: 'fa1', key: 'bid-sign-handover/bp1.json', originalName: '评标回流包-bp1.json', category: 'bid_evaluation_sign_handover', sha256: sha(Buffer.from('original')) },
      ],
      download: async () => content,
    });
    const r = await svc.run('pmi1');
    const hash = (r.details as any[]).find(d => d.check === '完整性-哈希');
    expect(hash?.status).toBe('FAIL');
    expect(r.overall).toBe('FAILED');
  });

  it('引用悬空（FileAsset 无行）→ 完整性-范围 FAIL、overall=FAILED', async () => {
    const { svc, storage } = makeMocks({
      packet: { fileAssetId: 'fa-gone', signPageScanFileId: null, handoverFileAssetId: null },
      assets: [], // fa-gone 无行
    });
    const r = await svc.run('pmi1');
    const missing = (r.details as any[]).find(d => d.check === '完整性-范围' && d.status === 'FAIL');
    expect(missing?.materialName).toContain('证据件引用缺失');
    expect(r.overall).toBe('FAILED');
    expect(storage.download).not.toHaveBeenCalled();
  });
});
