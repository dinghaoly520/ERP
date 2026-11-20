/**
 * 公告向导「引用采购文件」双轨回退（2026-11-20 终审 I4）：
 * attachFromObject 源读取从「纯本地 access+readFile」改为 readAttachmentBuffer
 * （本地→MinIO 副本），recreate 后引用流程复活；双失仍 404 SOURCE_NOT_FOUND。
 */
import { AnnouncementAttachmentService } from './announcement-attachment.service';
import { readAttachmentBuffer } from '../common/attachment-object-store';
import { minioClient } from '../upload/minio.client';

jest.mock('../common/attachment-object-store', () => ({
  readAttachmentBuffer: jest.fn(),
  writeAttachmentCopy: jest.fn(),
  removeAttachmentCopy: jest.fn(),
}));
jest.mock('../upload/minio.client', () => ({
  minioClient: { putObject: jest.fn() },
  MINIO_BUCKET: 'test-bucket',
}));

const makeService = () =>
  new AnnouncementAttachmentService({
    announcement: { findUnique: jest.fn().mockResolvedValue({ id: 'ann-1' }) },
    fileAsset: { create: jest.fn().mockResolvedValue({ id: 'fa-1' }) },
    announcementAttachment: { create: jest.fn().mockResolvedValue({ id: 'aa-1', fileAssetId: 'fa-1' }) },
  } as never);

const DTO = { objectKey: 'project-management/600-x-采购文件.docx', fileName: '采购文件.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

describe('AnnouncementAttachmentService attachFromObject 双轨回退', () => {
  const readBufferMock = readAttachmentBuffer as unknown as jest.Mock;

  beforeEach(() => {
    readBufferMock.mockReset();
    (minioClient.putObject as jest.Mock).mockReset();
  });

  it('本地 miss + MinIO 副本命中 → 引用成功（putObject + 落 FileAsset/AnnouncementAttachment）', async () => {
    readBufferMock.mockResolvedValue(Buffer.from('docx-copy'));
    const svc = makeService();

    const out = await svc.attachFromObject('ann-1', DTO, 'u-1');

    expect(minioClient.putObject).toHaveBeenCalledWith(
      'test-bucket',
      expect.stringMatching(/^uploads\/\d{4}-\d{2}-\d{2}\/.+\.docx$/),
      Buffer.from('docx-copy'),
      9,
      expect.objectContaining({ 'Content-Type': DTO.mimeType }),
    );
    expect(out).toMatchObject({ id: 'aa-1' });
  });

  it('两轨皆失 → 404 SOURCE_NOT_FOUND（既有语义保留）', async () => {
    readBufferMock.mockResolvedValue(null);
    const svc = makeService();

    await expect(svc.attachFromObject('ann-1', DTO, 'u-1'))
      .rejects.toMatchObject({ response: { code: 'SOURCE_NOT_FOUND' } });
    expect(minioClient.putObject).not.toHaveBeenCalled();
  });
});
