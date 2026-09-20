import JSZip = require('jszip'); // CJS 包，无 esModuleInterop（见 CLAUDE.md TS import 约定）
import { ArchiveExportService } from './archive-export.service';

/**
 * 2026-09-20 审查修复的集成锁定：exportAsip 取件循环的三守卫端到端行为。
 * （起因：替换循环时曾误删 dir.file 一行，helper 单测不覆盖集成点——此 spec 锁死。）
 */
const itemFixture = {
  id: 'pmi1', title: '测试项目', projectCode: 'SC-2026-1', requesterName: '甲', requesterDepartment: '采购中心',
  procurementMethod: '公开招标', createdAt: new Date('2026-09-01T00:00:00Z'),
  stages: [], bidProjects: [{ id: 'bp1', projectCode: 'SC-2026-1' }],
};

function makeMocks(overrides: {
  assets?: Array<{ id: string; key: string; originalName: string; category: string }>;
  fileAssetPages?: Array<Array<{ id: string; key: string; originalName: string; category: string }>>;
  memoInks?: Array<{ inkFileId: string | null }>;
  packet?: { fileAssetId: string | null; signPageScanFileId: string | null; handoverFileAssetId: string | null } | null;
} = {}) {
  const prisma = {
    projectManagementItem: {
      findUnique: jest.fn().mockResolvedValue(itemFixture),
      update: jest.fn().mockResolvedValue({}),
    },
    archiveMetadata: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    nonTenderDealRecord: { findFirst: jest.fn().mockResolvedValue(null) },
    expertMemo: { findMany: jest.fn().mockResolvedValue(overrides.memoInks ?? []) },
    bidExpert: { findMany: jest.fn().mockResolvedValue([]) },
    bidSignPacket: { findUnique: jest.fn().mockResolvedValue(overrides.packet ?? null) },
    bidClarification: { findMany: jest.fn().mockResolvedValue([]) },
    aiBidAnalysisTask: { findUnique: jest.fn().mockResolvedValue(null) },
    fileAsset: { findMany: jest.fn() },
  };
  if (overrides.fileAssetPages) {
    let call = 0;
    prisma.fileAsset.findMany.mockImplementation(async () => {
      const page = overrides.fileAssetPages![Math.min(call, overrides.fileAssetPages!.length - 1)];
      call += 1;
      return page;
    });
  } else {
    // 2026-09-20 复审硬化：按 skip 截片（同一数组整页返回会在恰 200 件 fixture 时让 fetchAllPaged 永不穷尽）
    prisma.fileAsset.findMany.mockImplementation(async ({ skip }: { skip: number }) =>
      (overrides.assets ?? []).slice(skip, skip + 200));
  }
  const storage = { download: jest.fn().mockResolvedValue(Buffer.from('x')), upload: jest.fn().mockResolvedValue(undefined) };
  const svc = new ArchiveExportService(
    prisma as any,
    storage as any,
    { snapshot: jest.fn().mockResolvedValue({ requiredMissing: [] }) } as any,
    { latest: jest.fn().mockResolvedValue({ overall: 'PASSED' }) } as any,
    { build: jest.fn().mockResolvedValue(Buffer.from('trail')) } as any,
  );
  return { prisma, storage, svc };
}

async function zipKeysOf(storage: { upload: jest.Mock }): Promise<string[]> {
  const buf = storage.upload.mock.calls[0][1] as Buffer;
  const zip = await JSZip.loadAsync(buf);
  return Object.keys(zip.files);
}

describe('exportAsip 取件三守卫集成', () => {
  it('同名资产 → ZIP 内两条消歧路径都在（dir.file 写入未被遗漏）', async () => {
    const { storage, svc } = makeMocks({
      memoInks: [{ inkFileId: 'fa1' }],
      packet: { fileAssetId: 'fa2', signPageScanFileId: null, handoverFileAssetId: null },
      assets: [
        { id: 'fa1', key: 'k1', originalName: '签字.jpg', category: 'expert_sign_scan' },
        { id: 'fa2', key: 'k2', originalName: '签字.jpg', category: 'expert_sign_scan' },
      ],
    });

    await svc.exportAsip('pmi1');

    expect(storage.download).toHaveBeenCalledTimes(2); // 两件都下载（无静默覆盖）
    const keys = await zipKeysOf(storage);
    expect(keys).toContain('SC-2026-1/项目管理/09_开评标接收件/expert_sign_scan/签字.jpg');
    expect(keys).toContain('SC-2026-1/项目管理/09_开评标接收件/expert_sign_scan/签字_2.jpg');
    // 2026-09-20 复审补强：manifest 与卷内容一一对应——固化验证清单（由 manifest 生成）须含两条消歧路径
    const buf = storage.upload.mock.calls[0][1] as Buffer;
    const zip = await JSZip.loadAsync(buf);
    const verify = await zip.file('SC-2026-1/其他/固化验证信息.txt')!.async('string');
    expect(verify).toContain('09_开评标接收件/expert_sign_scan/签字.jpg');
    expect(verify).toContain('09_开评标接收件/expert_sign_scan/签字_2.jpg');
  });

  it('引用件缺行（FileAsset 行不存在）→ ARCHIVE_HANDOVER_FETCH_FAILED 整体拒绝', async () => {
    const { storage, svc } = makeMocks({
      packet: { fileAssetId: 'fa-missing', signPageScanFileId: null, handoverFileAssetId: null },
      assets: [], // fa-missing 的行缺失
    });

    await expect(svc.exportAsip('pmi1')).rejects.toMatchObject({
      response: { code: 'ARCHIVE_HANDOVER_FETCH_FAILED' },
    });
    expect(storage.download).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('250 件资产 → 分页两次全取（无 take 截断），卷内 250 件', async () => {
    const full = Array.from({ length: 250 }, (_, i) => ({
      id: `fa${i}`, key: `k${i}`, originalName: `文件${i}.pdf`, category: 'bid_decrypted',
    }));
    const { prisma, storage, svc } = makeMocks({
      packet: { fileAssetId: full[0].id, signPageScanFileId: full[1].id, handoverFileAssetId: null },
      fileAssetPages: [full.slice(0, 200), full.slice(200)],
    });

    await svc.exportAsip('pmi1');

    expect(prisma.fileAsset.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.fileAsset.findMany.mock.calls[1][0].skip).toBe(200);
    const keys = await zipKeysOf(storage);
    const picked = keys.filter((k) => k.includes('09_开评标接收件/bid_decrypted/') && !k.endsWith('/')); // 排除 JSZip 目录条目
    expect(picked).toHaveLength(250);
  });
});
