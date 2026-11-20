/**
 * minioHas 判定口径（2026-11-20 终审 I5）：
 * 存在→true；NoSuchKey→false；网络不可达等其余错误→抛错（dry-run 不得把不可达当缺失）。
 */
jest.mock('../src/upload/minio.client', () => ({
  minioClient: { statObject: jest.fn(), putObject: jest.fn() },
  MINIO_BUCKET: 'test-bucket',
}));

import { minioClient } from '../src/upload/minio.client';
import { minioHas, renderUnrecoverableTable } from './backfill-attachment-minio';

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

describe('renderUnrecoverableTable（M4：汇总清单含项目 id，供业务方对账）', () => {
  it('每行输出 id | 文件名 | objectKey | 项目 id，null 项目显式 "-"', () => {
    const lines = renderUnrecoverableTable([
      { id: 'u1', fileName: '谈判文件.pdf', objectKey: 'pm/a.pdf', projectManagementItemId: 'pmi-1' },
      { id: 'u2', fileName: '公告.docx', objectKey: 'pm/b.docx', projectManagementItemId: null },
    ]);
    expect(lines[0]).toBe('  u1 | 谈判文件.pdf | pm/a.pdf | 项目 pmi-1');
    expect(lines[1]).toBe('  u2 | 公告.docx | pm/b.docx | 项目 -');
  });
});
