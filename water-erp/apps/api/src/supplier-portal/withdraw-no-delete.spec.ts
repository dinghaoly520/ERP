/**
 * P1-7（第三波）：撤回投标不得删除 C_outer 本体（sealedPath=asset.key）——
 * dual-v2 轨重投时 submitBid 备份 staging 需重读该对象，删本体即反复 500 死胡同。
 * 撤回的保密边界由下载授权链收口（withdrawn 后无下载授权），密文本体留 MinIO 供重投。
 */
jest.mock('../upload/minio.client', () => ({
  minioClient: { getObject: jest.fn(), removeObject: jest.fn() },
  MINIO_BUCKET: 'test-bucket',
}));

import { minioClient } from '../upload/minio.client';
import { SupplierPortalService } from './supplier-portal.service';

describe('SupplierPortalService — withdrawSubmission 不删 C_outer 本体（P1-7）', () => {
  let svc: any;
  let prisma: any;

  beforeEach(() => {
    (minioClient.removeObject as jest.Mock).mockClear();
    prisma = {
      supplierBidSubmission: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'sub1', supplierId: 'sup1', projectId: 'p1', status: 'submitted',
          technicalFileAssetId: 'fa1', businessFileAssetId: null, coverLetterFileAssetId: 'fa2',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'SUBMIT', name: 'P', deadline: new Date(Date.now() + 86400000) }) },
      bidSupplier: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      fileAsset: { findMany: jest.fn().mockResolvedValue([{ sealedPath: 'uploads/fa1.enc' }, { sealedPath: 'uploads/fa2.enc' }]) },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    svc = Object.create(SupplierPortalService.prototype);
    svc.prisma = prisma;
  });

  it('撤回成功且不删任何 MinIO 对象（旧实现删 sealedPath=asset.key=C_outer 本体 → 重投 500）', async () => {
    await svc.withdrawSubmission('sup1', 'sub1');
    expect(prisma.supplierBidSubmission.update).toHaveBeenCalled();
    expect(minioClient.removeObject).not.toHaveBeenCalled();
  });
});
