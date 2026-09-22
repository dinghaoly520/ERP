// apps/api/src/archive/archive-evidence.collector.spec.ts
import { ARCHIVE_PICKUP_CATEGORIES, extractEvidenceRefIds, EvidenceRefSources } from './archive-evidence.collector';

describe('extractEvidenceRefIds（证据件引用 id 提取，纯函数）', () => {
  const sources: EvidenceRefSources = {
    memoInks: [{ inkFileId: 'ink1' }, { inkFileId: null }],
    experts: [
      { signScanFileId: 'scan1', signInMeta: { photoAssetId: 'photo1' } },
      { signScanFileId: null, signInMeta: null },
    ],
    packet: { fileAssetId: 'pdf1', signPageScanFileId: 'signpage1', handoverFileAssetId: 'ho1' },
    clarifications: [{ fileAssetId: 'cl1', replyAttachmentIds: [{ fileAssetId: 'cl2' }, null] }],
    aiReport: { docxFileId: 'doc1', pdfFileId: null },
  };
  it('五源引用全提取去重', () => {
    expect([...extractEvidenceRefIds(sources)].sort()).toEqual(
      ['cl1', 'cl2', 'doc1', 'ho1', 'ink1', 'pdf1', 'photo1', 'scan1', 'signpage1'].sort(),
    );
  });
  it('packet/aiReport 为 null 时安全跳过', () => {
    const s: EvidenceRefSources = { memoInks: [], experts: [], packet: null, clarifications: [], aiReport: null };
    expect(extractEvidenceRefIds(s).size).toBe(0);
  });
  it('signInMeta 非对象（防御：mock/脏数据）不炸', () => {
    const s: EvidenceRefSources = {
      memoInks: [], experts: [{ signScanFileId: 'scan1', signInMeta: 'garbage' } as never],
      packet: null, clarifications: [], aiReport: null,
    };
    expect([...extractEvidenceRefIds(s)]).toEqual(['scan1']);
  });
});

describe('取件常量单一源（P1-1：检测/导出/勾稽共用）', () => {
  it('key 含项目 ID 的 8 类留痕件全在清单', () => {
    for (const c of [
      'bid_opening_handover', 'bid_evaluation_sign_handover', 'bid_sign_packet',
      'sign_packet_signature_page', 'expert_sign_scan', 'bid_decrypted',
      'opening_sign_page', 'opening_sign_scan',
    ] as const) {
      expect(ARCHIVE_PICKUP_CATEGORIES).toContain(c);
    }
  });
});
