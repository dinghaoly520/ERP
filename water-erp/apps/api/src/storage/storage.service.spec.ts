jest.mock('../upload/minio.client', () => ({
  MINIO_BUCKET: 'water-erp-test',
  minioClient: {
    bucketExists: jest.fn().mockResolvedValue(true),
    putObject: jest.fn().mockResolvedValue({}),
    // 真实的 download 会监听流事件：桩必须是会吐数据并结束的可读流，否则用例挂到超时
    getObject: jest.fn().mockImplementation(() => {
      const { Readable } = require('stream');
      return Promise.resolve(Readable.from([Buffer.from('%PDF-1.4')]));
    }),
    removeObject: jest.fn().mockResolvedValue({}),
    presignedGetObject: jest.fn().mockResolvedValue('https://x'),
  },
}));

import { StorageService } from './storage.service';
import { minioClient } from '../upload/minio.client';

const putObject = minioClient.putObject as jest.Mock;
const getObject = minioClient.getObject as jest.Mock;
const removeObject = minioClient.removeObject as jest.Mock;
const presignedGetObject = minioClient.presignedGetObject as jest.Mock;

describe('StorageService — 键底线（审计第 3 处）', () => {
  let service: StorageService;
  beforeEach(() => {
    jest.clearAllMocks();
    service = new StorageService();
  });

  it.each(['../sealed-backup/k', '/etc/passwd', 'review/../x', 'a\\b', 'a/b/', '', 'x\u0000y'])(
    '键 %j 不合法：四个方法都抛 400 INVALID_OBJECT_KEY，且不碰对象存储',
    async (badKey) => {
      const code = { response: { code: 'INVALID_OBJECT_KEY' } };
      await expect(service.upload(badKey, Buffer.from('x'), 'text/plain')).rejects.toMatchObject(code);
      await expect(service.download(badKey)).rejects.toMatchObject(code);
      await expect(service.delete(badKey)).rejects.toMatchObject(code);
      await expect(service.getPresignedUrl(badKey)).rejects.toMatchObject(code);
      expect(putObject).not.toHaveBeenCalled();
      expect(getObject).not.toHaveBeenCalled();
      expect(removeObject).not.toHaveBeenCalled();
      expect(presignedGetObject).not.toHaveBeenCalled();
    },
  );

  it('合法键原样交给对象存储', async () => {
    const buf = Buffer.from('%PDF-1.4');
    await service.upload('review/2026-11-25/abc.pdf', buf, 'application/pdf');
    expect(putObject).toHaveBeenCalledWith('water-erp-test', 'review/2026-11-25/abc.pdf', buf, buf.length, { 'Content-Type': 'application/pdf' });
    const downloaded = await service.download('review/2026-11-25/abc.pdf');
    expect(downloaded.toString()).toBe('%PDF-1.4');
    expect(getObject).toHaveBeenCalledWith('water-erp-test', 'review/2026-11-25/abc.pdf');
    await service.delete('review/2026-11-25/abc.pdf');
    expect(removeObject).toHaveBeenCalledWith('water-erp-test', 'review/2026-11-25/abc.pdf');
  });
});
