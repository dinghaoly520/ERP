// apps/api/scripts/backfill-opening-handover.spec.ts
import * as crypto from 'node:crypto';
import { applyOpeningPackageBackfill, buildOpeningPackageFromRows, LegacyPkg, HallMsgRow, RebuildInput } from './backfill-opening-handover';

const basePkg: LegacyPkg = {
  packageType: 'BID_OPENING_HANDOVER', packageVersion: 1,
  openingRecords: [
    { supplierName: '甲', bidSupplierId: 'bs1', amount: '152.9', amountUnit: null },
    { supplierName: '乙', bidSupplierId: 'bs2', amount: '88 万元', amountUnit: '万元' }, // 已带单位，跳过
    { supplierName: '丙', bidSupplierId: 'bs3', amount: '壹佰万元整', amountUnit: null }, // 非裸数字（旧轨文本），跳过
  ],
  fingerprint: 'old',
};

describe('applyOpeningPackageBackfill（存量开标文件包回填，纯函数）', () => {
  it('dual-v2 裸数字补单位戳并渲染「N 万元」', () => {
    const { pkg, plan } = applyOpeningPackageBackfill(
      basePkg, new Map([['bs1', '万元'], ['bs2', '万元'], ['bs3', null]]), [], new Map(), new Date('2026-09-22T00:00:00Z'),
    );
    expect(pkg.openingRecords![0]).toMatchObject({ amount: '152.9 万元', amountUnit: '万元' });
    expect(pkg.openingRecords![1].amount).toBe('88 万元');   // 不动
    expect(pkg.openingRecords![2].amount).toBe('壹佰万元整'); // 不动
    expect(plan.changed).toBe(true);
    expect(plan.fields).toContain('amountUnit');
    expect(plan.recordChanges).toEqual([{ supplierName: '甲', from: '152.9', to: '152.9 万元' }]);
  });

  it('hallMessages 注入升 v2 并解析私聊公司名；fingerprint 重算自洽', () => {
    const msgs: HallMsgRow[] = [
      { roomType: 'PRIVATE', supplierId: 'sup1', senderName: '陈源远', senderRole: 'HOST', type: 'TEXT', content: '请确认', fileAssetId: null, createdAt: new Date('2026-09-10T06:00:00Z') },
    ];
    const { pkg, plan } = applyOpeningPackageBackfill(
      basePkg, new Map([['bs1', '万元']]), msgs, new Map([['sup1', '成都华建']]), new Date('2026-09-22T00:00:00Z'),
    );
    expect(pkg.packageVersion).toBe(2);
    expect(pkg.hallMessages![0]).toMatchObject({ room: 'PRIVATE', supplierName: '成都华建', content: '请确认' });
    expect((pkg.legacyBackfill as any).fields.sort()).toEqual(['amountUnit', 'hallMessages']);
    // fingerprint 自洽：去掉 fingerprint 后重算 sha256(JSON.stringify(body)) 应相等
    const { fingerprint, ...body } = pkg as Record<string, unknown> & { fingerprint: string };
    expect(crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')).toBe(fingerprint);
  });

  it('无变化时 changed=false 且不重算指纹（幂等）', () => {
    const { pkg, plan } = applyOpeningPackageBackfill(basePkg, new Map(), [], new Map(), new Date());
    expect(plan.changed).toBe(false);
    expect(plan.fields).toEqual([]);
    expect(pkg.fingerprint).toBe('old');
    expect(pkg).toEqual(basePkg);
  });

  it('包已有 hallMessages（新轨 v2 包）不重复注入', () => {
    const pkgV2: LegacyPkg = { ...basePkg, packageVersion: 2, hallMessages: [{ room: 'PUBLIC' }] } as LegacyPkg;
    const msgs: HallMsgRow[] = [
      { roomType: 'PUBLIC', supplierId: null, senderName: 'x', senderRole: 'HOST', type: 'TEXT', content: 'y', fileAssetId: null, createdAt: new Date() },
    ];
    const { pkg, plan } = applyOpeningPackageBackfill(pkgV2, new Map(), msgs, new Map(), new Date());
    expect((pkg.hallMessages as unknown[]).length).toBe(1);
    expect(plan.fields).not.toContain('hallMessages');
  });
});

describe('buildOpeningPackageFromRows（对象缺失时从 DB 重建，--rebuild-missing）', () => {
  const input: RebuildInput = {
    project: { id: 'p1', projectCode: 'C1', name: '测试项目', procurementMethod: '公开招标', openTime: new Date('2026-07-01T00:00:00Z'), deadline: new Date('2026-06-30T00:00:00Z'), stage: 'EVALUATING', roundMode: null },
    session: { host: '李主任', supervisor: null, decryptWindowStart: new Date('2026-07-01T01:00:00Z'), decryptWindowEnd: new Date('2026-07-01T02:00:00Z'), status: '开标完成' },
    suppliers: [
      { id: 'bs1', supplierId: 's1', supplierName: '甲公司', submitStatus: '已提交', decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED', encryptStatus: 'ENCRYPTED', receiptNo: 'R1', dangerAttribution: null, decryptedAt: new Date('2026-07-01T01:30:00Z') },
      { id: 'bs2', supplierId: 's2', supplierName: '乙公司', submitStatus: '已提交', decryptStatus: 'PENDING', confirmStatus: 'PENDING', encryptStatus: 'ENCRYPTED', receiptNo: 'R2', dangerAttribution: 'PLATFORM', decryptedAt: null },
    ],
    submissions: [
      { supplierId: 's1', envelopeVersion: 'dual-v2', decryptedAssets: { technical: 'fa-dec-1' }, status: 'submitted', submittedAt: new Date('2026-06-30T10:00:00Z') },
      { supplierId: 's2', envelopeVersion: 'dual-v2', decryptedAssets: null, status: 'submitted', submittedAt: new Date('2026-06-30T11:00:00Z') },
    ],
    records: [
      { bidSupplierId: 'bs1', supplierName: '甲公司', amount: '152.9', amountUnit: null, period: '90天', qualityTarget: '合格', bondStatus: '已缴纳', confirmStatus: 'CONFIRMED', confirmSignature: { certSn: 'x' }, confirmSignedAt: new Date('2026-07-01T02:00:00Z'), objectionReason: null, handleResult: null },
    ],
    logs: [{ time: new Date('2026-07-01T02:10:00Z'), role: '李主任', action: '完成开标·资料移交', target: '测试项目', result: 'ok', riskFlag: '无' }],
    bidRounds: [],
    hallMessages: [
      { roomType: 'PRIVATE', supplierId: 's1', senderName: '李主任', senderRole: 'HOST', type: 'TEXT', content: '请确认', fileAssetId: null, createdAt: new Date('2026-07-01T01:45:00Z') },
    ],
    decryptedShaByAssetId: new Map([['fa-dec-1', 'deadbeef']]),
    unitByBsId: new Map([['bs1', '万元'], ['bs2', '万元']]),
    supplierNameBySupplierId: new Map([['s1', '甲公司'], ['s2', '乙公司']]),
    now: new Date('2026-09-22T03:00:00Z'),
  };

  it('重建 v2 包：单位戳 + 解密指纹 + 会场交流 + 重建标记 + 指纹自洽 + 无 signatures 段', () => {
    const pkg = buildOpeningPackageFromRows(input) as Record<string, any>;
    expect(pkg.packageType).toBe('BID_OPENING_HANDOVER');
    expect(pkg.packageVersion).toBe(2);
    expect(pkg.openingRecords[0]).toMatchObject({ amount: '152.9 万元', amountUnit: '万元' });
    expect(pkg.suppliers[0]).toMatchObject({ supplierName: '甲公司', decryptedFileSha256: { technical: 'deadbeef' } });
    expect(pkg.hallMessages[0]).toMatchObject({ room: 'PRIVATE', supplierName: '甲公司' });
    expect(pkg.legacyBackfill).toEqual({ at: '2026-09-22T03:00:00.000Z', fields: ['rebuild'] });
    expect('signatures' in pkg).toBe(false); // 重登记开标签字时由 rebuildHandoverWithSignatures 追加
    expect(pkg.summary).toMatchObject({ supplierTotal: 2, active: 2, decrypted: 1, confirmed: 1 });
    const { fingerprint, ...body } = pkg;
    expect(crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')).toBe(fingerprint);
  });

  it('供应商行按接收序（已递交 submittedAt 升序）且排序临时键剥离', () => {
    const pkg = buildOpeningPackageFromRows(input) as Record<string, any>;
    expect(pkg.suppliers.map((s: any) => s.supplierName)).toEqual(['甲公司', '乙公司']);
    for (const s of pkg.suppliers) {
      expect('submitted' in s).toBe(false);
      expect('withdrawn' in s).toBe(false);
      expect('submission' in s).toBe(false);
    }
  });
});
