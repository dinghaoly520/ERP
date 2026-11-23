/**
 * attachment-object-store 单测——PMI 附件双轨制共享工具。
 * 设计：docs/superpowers/specs/2026-11-20-pmi-attachment-dual-track-design.md
 *
 * 覆盖（计划 Task 1 五用例 + Review Focus #1/#2/#4）：
 *   1. 本地命中 → 返回本地 buffer，不触 MinIO（MinIO 宕机时本地读不受影响）
 *   2. 本地 miss + MinIO 命中 → 聚流返 buffer（键用 uploads/... 形态覆盖混轨 objectKey）
 *   3. 本地 miss + NoSuchKey → null 不抛
 *   4. 本地 miss + 非 NoSuchKey 网络错 → null 不抛 + warn
 *   5. writeAttachmentCopy 失败返 false 不抛 / 成功返 true；removeAttachmentCopy 吞错
 */
import { Logger } from '@nestjs/common';
import { Readable } from 'node:stream';

jest.mock('../upload/minio.client', () => ({
  MINIO_BUCKET: 'water-erp-test',
  minioClient: {
    getObject: jest.fn(),
    putObject: jest.fn(),
    removeObject: jest.fn(),
  },
}));

jest.mock('node:fs/promises', () => {
  const actual = jest.requireActual('node:fs/promises');
  return {
    ...actual,
    stat: jest.fn(),
    readFile: jest.fn(),
  };
});

import { stat, readFile } from 'node:fs/promises';
import { minioClient } from '../upload/minio.client';
import {
  readAttachmentBuffer,
  writeAttachmentCopy,
  removeAttachmentCopy,
} from './attachment-object-store';

const mockedStat = stat as jest.Mock;
const mockedReadFile = readFile as jest.Mock;
const mockedGetObject = minioClient.getObject as jest.Mock;
const mockedPutObject = minioClient.putObject as jest.Mock;
const mockedRemoveObject = minioClient.removeObject as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('readAttachmentBuffer', () => {
  it('本地命中 → 返回本地 buffer 且不调 minioClient.getObject', async () => {
    mockedStat.mockResolvedValue({ isFile: () => true });
    mockedReadFile.mockResolvedValue(Buffer.from('local-bytes'));

    const buf = await readAttachmentBuffer('project-management/123-a-测试.pdf');

    expect(buf?.toString()).toBe('local-bytes');
    expect(mockedGetObject).not.toHaveBeenCalled();
  });

  it('本地 miss + MinIO 命中 → 聚流返回 buffer（混轨 uploads/ 键形态）', async () => {
    mockedStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mockedGetObject.mockResolvedValue(Readable.from([Buffer.from('minio-'), Buffer.from('bytes')]));

    const buf = await readAttachmentBuffer('uploads/2026-11-20/x.pdf');

    expect(buf?.toString()).toBe('minio-bytes');
    expect(mockedGetObject).toHaveBeenCalledWith('water-erp-test', 'uploads/2026-11-20/x.pdf');
  });

  it('本地 miss + getObject 抛 NoSuchKey → 返回 null 不抛', async () => {
    mockedStat.mockResolvedValue(null);
    mockedGetObject.mockRejectedValue(Object.assign(new Error('The specified key does not exist'), { code: 'NoSuchKey' }));

    await expect(readAttachmentBuffer('project-management/gone.pdf')).resolves.toBeNull();
  });

  it('本地 miss + getObject 抛网络错（无 code）→ 返回 null 不抛且告警', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    mockedStat.mockResolvedValue(null);
    mockedGetObject.mockRejectedValue(new Error('connect ECONNREFUSED 1.2.3.4:443'));

    await expect(readAttachmentBuffer('project-management/neterr.pdf')).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('writeAttachmentCopy / removeAttachmentCopy', () => {
  it('putObject 成功 → true；失败 → false 不抛；removeObject 失败 → 静默 resolve', async () => {
    mockedPutObject.mockResolvedValue(undefined);
    await expect(
      writeAttachmentCopy('project-management/1-a-x.pdf', Buffer.from('x'), 'application/pdf'),
    ).resolves.toBe(true);
    expect(mockedPutObject).toHaveBeenCalledWith(
      'water-erp-test',
      'project-management/1-a-x.pdf',
      Buffer.from('x'),
      1,
      { 'Content-Type': 'application/pdf' },
    );

    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    mockedPutObject.mockRejectedValue(new Error('MinIO down'));
    await expect(
      writeAttachmentCopy('project-management/1-a-x.pdf', Buffer.from('x'), 'application/pdf'),
    ).resolves.toBe(false);

    mockedRemoveObject.mockRejectedValue(new Error('MinIO down'));
    await expect(removeAttachmentCopy('project-management/1-a-x.pdf')).resolves.toBeUndefined();
    warnSpy.mockRestore();
  });
});

describe('readAttachmentBuffer — I-1 键校验（2026-11-23 增量审查：路径越界公开披露链）', () => {
  it("objectKey 含 .. 段（路径穿越）→ 400 INVALID_OBJECT_KEY，不触任何存储", async () => {
    await expect(readAttachmentBuffer('../../../../etc/passwd'))
      .rejects.toMatchObject({ response: { code: 'INVALID_OBJECT_KEY' } });
    expect(mockedGetObject).not.toHaveBeenCalled();
    expect(mockedReadFile).not.toHaveBeenCalled();
  });

  it('绝对路径 objectKey → 400（resolve 恒出 uploads 根）', async () => {
    await expect(readAttachmentBuffer('/etc/passwd'))
      .rejects.toMatchObject({ response: { code: 'INVALID_OBJECT_KEY' } });
    expect(mockedGetObject).not.toHaveBeenCalled();
  });

  it('中段 .. 同样拒绝（a/../../b）', async () => {
    await expect(readAttachmentBuffer('project-management/../../secret'))
      .rejects.toMatchObject({ response: { code: 'INVALID_OBJECT_KEY' } });
    expect(mockedGetObject).not.toHaveBeenCalled();
  });
});
