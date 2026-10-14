/**
 * v3-staging 过期清理单测（阶段2.5 T7）
 * Review Focus 3：被引用/未过期不删，仅过期且未引用删（MinIO+DB 双删）
 */
jest.mock('../upload/minio.client', () => ({
  minioClient: { removeObject: jest.fn().mockResolvedValue({}) },
  MINIO_BUCKET: 'test-bucket',
}));

import { StagingCleanupService } from './staging-cleanup.service';
import { minioClient } from '../upload/minio.client';

const OLD = new Date(Date.now() - 25 * 3600 * 1000);
const FRESH = new Date(Date.now() - 3600 * 1000);

const mkPrisma = (over: Record<string, any> = {}) => ({
  fileAsset: {
    // 实现服务端 where 语义（前缀+过期）——fresh 由查询层排除，引用/未过期判定在服务内
    findMany: jest.fn().mockImplementation(async ({ where }: any) =>
      (over.assets ?? [
        { id: 'fa-stale', key: 'v3-staging/p1/s1/a.outer', createdAt: OLD },   // 过期未引用 → 删
        { id: 'fa-kept', key: 'v3-staging/p1/s1/b.outer', createdAt: OLD },     // 过期但被引用 → 留
        { id: 'fa-fresh', key: 'v3-staging/p1/s1/c.outer', createdAt: FRESH },  // 未过期 → 留
      ]).filter(a => a.createdAt < where.createdAt.lt)),
    delete: jest.fn().mockResolvedValue({}),
  },
  submissionVersion: {
    findMany: jest.fn().mockResolvedValue(over.versions ?? [
      { envelope: { files: { technical: { assetId: 'fa-kept' } } } },
    ]),
  },
  bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
});

describe('StagingCleanupService（T7）', () => {
  beforeEach(() => { (minioClient.removeObject as jest.Mock).mockClear(); });

  test('仅过期且未引用的暂存被删（MinIO+DB 双删）', async () => {
    const prisma = mkPrisma();
    const r = await new StagingCleanupService(prisma as any).cleanupOnce();
    expect(r.removed).toBe(1);
    expect(minioClient.removeObject).toHaveBeenCalledTimes(1);
    expect((minioClient.removeObject as jest.Mock).mock.calls[0][1]).toBe('v3-staging/p1/s1/a.outer');
    expect(prisma.fileAsset.delete).toHaveBeenCalledWith({ where: { id: 'fa-stale' } });
    // 被引用与未过期不动
    expect(prisma.fileAsset.delete).toHaveBeenCalledTimes(1);
  });

  test('引用集含多版本多 role——任一命中即保留', async () => {
    const prisma = mkPrisma({
      versions: [
        { envelope: { files: { technical: { assetId: 'fa-stale' } } } },
        { envelope: { files: { business: { assetId: 'fa-kept' } } } },
      ],
    });
    const r = await new StagingCleanupService(prisma as any).cleanupOnce();
    expect(r.removed).toBe(0);
    expect(minioClient.removeObject).not.toHaveBeenCalled();
  });

  test('MinIO 对象已缺失（NoSuchKey）仍删 DB 行（孤儿行收敛）', async () => {
    const prisma = mkPrisma({ assets: [{ id: 'fa-stale', key: 'v3-staging/x/y.outer', createdAt: OLD }] });
    (minioClient.removeObject as jest.Mock).mockRejectedValue({ code: 'NoSuchKey' });
    const r = await new StagingCleanupService(prisma as any).cleanupOnce();
    expect(r.removed).toBe(1);
    expect(prisma.fileAsset.delete).toHaveBeenCalledTimes(1);
  });
});
