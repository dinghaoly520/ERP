/**
 * dual-v3 encrypted-assets 暂存端点单测（Task5）
 * mock Prisma——实算哈希+暂存字段验证
 */
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { createHash } from 'crypto';

jest.mock('../upload/minio.client', () => ({
  minioClient: { putObject: jest.fn().mockResolvedValue({}) },
  MINIO_BUCKET: 'test-bucket',
}));

const mockPrisma: any = {
  supplier: { findUnique: async () => ({ id: 'sup-1', userId: 'user-1' }) },
  fileAsset: { create: async (d: any) => ({ id: 'fa-1', ...d.data }) },
  // P3-3：暂存资格闸（项目存在+投递阶段）；F2：补传窗查询（默认无 dual-v3 投递=窗关）
  bidProject: { findUnique: async () => ({ stage: 'SUBMIT' }) },
  supplierBidSubmission: { findFirst: async () => null },
};

import { EncryptedAssetController } from './encrypted-asset.controller';

describe('EncryptedAssetController（dual-v3 暂存）', () => {
  const ctrl = new EncryptedAssetController(mockPrisma);
  const mockReq = { user: { sub: 'user-1' } } as any;

  test('P3-3：项目不存在 → 400 PROJECT_NOT_FOUND；已开标项目 → 409 PROJECT_NOT_SUBMITTING', async () => {
    const buffer = Buffer.from('x');
    const mockFile = { buffer, originalname: 't.outer', mimetype: 'application/octet-stream', size: 1 } as Express.Multer.File;
    const orig = mockPrisma.bidProject.findUnique;
    mockPrisma.bidProject.findUnique = async () => null;
    await expect(ctrl.uploadEncryptedAsset('proj-x', mockReq, mockFile)).rejects.toMatchObject({ response: { code: 'PROJECT_NOT_FOUND' } });
    mockPrisma.bidProject.findUnique = async () => ({ stage: 'OPENING' });
    await expect(ctrl.uploadEncryptedAsset('proj-x', mockReq, mockFile)).rejects.toMatchObject({ response: { code: 'PROJECT_NOT_SUBMITTING' } });
    mockPrisma.bidProject.findUnique = orig;
  });

  test('N11：截标已过（stage 仍 SUBMIT）→ 409 DEADLINE_PASSED 不可暂存', async () => {
    const buffer = Buffer.from('y');
    const mockFile = { buffer, originalname: 't.outer', mimetype: 'application/octet-stream', size: 1 } as Express.Multer.File;
    const orig = mockPrisma.bidProject.findUnique;
    mockPrisma.bidProject.findUnique = async () => ({ stage: 'SUBMIT', deadline: new Date(Date.now() - 3600_000) });
    await expect(ctrl.uploadEncryptedAsset('proj-x', mockReq, mockFile)).rejects.toMatchObject({ response: { code: 'DEADLINE_PASSED' } });
    mockPrisma.bidProject.findUnique = orig;
  });

  test('F2 终审：OPENING 期 dual-v3 已投递家的补传暂存放行（reupload 前置步不可被拦死）', async () => {
    const buffer = Buffer.from('z');
    const mockFile = { buffer, originalname: 't.outer', mimetype: 'application/octet-stream', size: 1 } as Express.Multer.File;
    const origProject = mockPrisma.bidProject.findUnique;
    mockPrisma.bidProject.findUnique = async () => ({ stage: 'OPENING', deadline: new Date(Date.now() - 3600_000) });
    // 无 v3 submitted 投递 → 仍拒（阶段闸原语义）
    mockPrisma.supplierBidSubmission = { findFirst: async () => null };
    await expect(ctrl.uploadEncryptedAsset('proj-x', mockReq, mockFile)).rejects.toMatchObject({ response: { code: 'PROJECT_NOT_SUBMITTING' } });
    // 有 v3 submitted 投递 → 放行（补传资格由 reuploadBidV3 六闸把守）
    mockPrisma.supplierBidSubmission = { findFirst: async () => ({ id: 'sub-1', status: 'submitted', envelopeVersion: 'dual-v3' }) };
    const result = await ctrl.uploadEncryptedAsset('proj-x', mockReq, mockFile);
    expect(result.fileAssetId).toBeTruthy();
    mockPrisma.bidProject.findUnique = origProject;
  });

  test('上传密文→服务端实算 outerSha256+返回暂存信息', async () => {
    const { minioClient: mc } = require('../upload/minio.client');
    (mc.putObject as jest.Mock).mockClear(); // F2 用例放行路径真实上传过一次——计数复位
    const buffer = Buffer.from('encrypted-data-outer-ciphertext');
    const mockFile = { buffer, originalname: 'test.outer', mimetype: 'application/octet-stream', size: buffer.length } as Express.Multer.File;
    const result = await ctrl.uploadEncryptedAsset('proj-1', mockReq, mockFile);
    expect(result.fileAssetId).toBeTruthy();
    expect(result.outerSha256).toBe(createHash('sha256').update(buffer).digest('hex'));
    expect(result.outerBytes).toBe(buffer.length);
    expect(result.expiresAt).toBeTruthy();
    // C1（评审修复）：密文必须真实落 MinIO——否则开标 decryptOuterOneV3 getObject 必 NoSuchKey
    const { minioClient, MINIO_BUCKET } = require('../upload/minio.client');
    expect(minioClient.putObject).toHaveBeenCalledTimes(1);
    const [bucket, key, buf, len] = minioClient.putObject.mock.calls[0];
    expect(bucket).toBe(MINIO_BUCKET);
    expect(key).toMatch(/^v3-staging\/proj-1\/sup-1\//);
    expect(buf.equals(buffer)).toBe(true);
    expect(len).toBe(buffer.length);
  });

  test('无文件→400 NO_FILE', () => {
    const err = new BadRequestException({ error: '缺少密文文件', code: 'NO_FILE' });
    expect((err.getResponse() as any).code).toBe('NO_FILE');
  });

  test('超限→413 OUTER_TOO_LARGE', () => {
    const err = new PayloadTooLargeException({ error: '密文超限', code: 'OUTER_TOO_LARGE' });
    expect(err.getStatus()).toBe(413);
  });
});
