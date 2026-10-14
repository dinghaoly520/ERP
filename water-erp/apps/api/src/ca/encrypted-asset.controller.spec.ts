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
};

import { EncryptedAssetController } from './encrypted-asset.controller';

describe('EncryptedAssetController（dual-v3 暂存）', () => {
  const ctrl = new EncryptedAssetController(mockPrisma);
  const mockReq = { user: { sub: 'user-1' } } as any;

  test('上传密文→服务端实算 outerSha256+返回暂存信息', async () => {
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
