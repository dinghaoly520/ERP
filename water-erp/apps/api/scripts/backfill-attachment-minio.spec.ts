/**
 * minioHas 判定口径（2026-11-20 终审 I5）：
 * 存在→true；NoSuchKey→false；网络不可达等其余错误→抛错（dry-run 不得把不可达当缺失）。
 */
jest.mock('../src/upload/minio.client', () => ({
  minioClient: { statObject: jest.fn(), putObject: jest.fn() },
  MINIO_BUCKET: 'test-bucket',
}));

import { minioClient } from '../src/upload/minio.client';
import { minioHas } from './backfill-attachment-minio';

const statMock = minioClient.statObject as jest.Mock;

describe('backfill-attachment-minio minioHas', () => {
  beforeEach(() => statMock.mockReset());

  it('对象存在 → true', async () => {
    statMock.mockResolvedValue({ size: 1 });
    await expect(minioHas('project-management/a.pdf')).resolves.toBe(true);
  });

  it('NoSuchKey / NotFound（statObject 的 HeadObject 形态，dev 实测）→ false（真缺失）', async () => {
    statMock.mockRejectedValue(Object.assign(new Error('The specified key does not exist.'), { code: 'NoSuchKey' }));
    await expect(minioHas('project-management/gone.pdf')).resolves.toBe(false);
    statMock.mockRejectedValue(Object.assign(new Error('Not Found'), { code: 'NotFound' }));
    await expect(minioHas('project-management/gone.pdf')).resolves.toBe(false);
  });

  it('网络不可达（非 NoSuchKey）→ 抛错中止，不把不可达当缺失', async () => {
    statMock.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1:9000'));
    await expect(minioHas('project-management/a.pdf')).rejects.toThrow(/不可达/);
  });
});
