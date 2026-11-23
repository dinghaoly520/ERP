/**
 * I-1（2026-11-23 增量审查）：readAttachmentBuffer 键白名单+containment 单测。
 * 攻击面：objectKey 含 ../ 段/绝对路径 → resolve 逃出 uploads/ 读任意文件（本地轨）。
 */
jest.mock('../upload/minio.client', () => ({
  minioClient: { getObject: jest.fn(), putObject: jest.fn(), removeObject: jest.fn() },
  MINIO_BUCKET: 'test-bucket',
}));

import { BadRequestException } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { readAttachmentBuffer } from './attachment-object-store';
import { minioClient } from '../upload/minio.client';

function fakeStream(chunks: Buffer[]): EventEmitter {
  const s = new EventEmitter();
  (s as any).on = s.on.bind(s);
  setTimeout(() => { chunks.forEach(c => s.emit('data', c)); s.emit('end'); }, 0);
  return s;
}

describe('readAttachmentBuffer — I-1 键校验', () => {
  beforeEach(() => { (minioClient.getObject as jest.Mock).mockReset(); });

  it('objectKey 含 .. 段（路径穿越）→ 400 INVALID_OBJECT_KEY，不触任何存储', async () => {
    await expect(readAttachmentBuffer('../../../../etc/passwd'))
      .rejects.toMatchObject({ response: { code: 'INVALID_OBJECT_KEY' } });
    expect(minioClient.getObject).not.toHaveBeenCalled();
  });

  it('绝对路径 objectKey → 400（resolve 恒出 uploads 根）', async () => {
    await expect(readAttachmentBuffer('/etc/passwd')).rejects.toBeInstanceOf(BadRequestException);
    expect(minioClient.getObject).not.toHaveBeenCalled();
  });

  it('中段 .. 同样拒绝（a/../../b）', async () => {
    await expect(readAttachmentBuffer('project-management/../../secret')).rejects.toMatchObject({
      response: { code: 'INVALID_OBJECT_KEY' },
    });
  });

  it('合法键：本地 miss → MinIO 回退轨读回（行为不回归）', async () => {
    (minioClient.getObject as jest.Mock).mockResolvedValue(fakeStream([Buffer.from('abc')]));
    const buf = await readAttachmentBuffer('project-management/1750000000-x-%E6%96%87%E4%BB%B6.pdf');
    expect(buf?.toString()).toBe('abc');
  });
});
