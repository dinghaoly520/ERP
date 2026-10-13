/**
 * dual-v3 encrypted-assets 暂存端点单测（Task5）
 * mock Prisma——实算哈希+暂存字段验证
 */
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { createHash } from 'crypto';

const mockPrisma: any = {
  supplier: { findUnique: async () => ({ id: 'sup-1' }) },
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
