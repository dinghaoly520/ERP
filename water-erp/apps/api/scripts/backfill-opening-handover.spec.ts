// apps/api/scripts/backfill-opening-handover.spec.ts
import * as crypto from 'node:crypto';
import { applyOpeningPackageBackfill, LegacyPkg, HallMsgRow } from './backfill-opening-handover';

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
