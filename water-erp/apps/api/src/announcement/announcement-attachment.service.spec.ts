/**
 * 公告向导「引用采购文件」双轨回退（2026-11-20 终审 I4）：
 * attachFromObject 源读取从「纯本地 access+readFile」改为 readAttachmentBuffer
 * （本地→MinIO 副本），recreate 后引用流程复活；双失仍 404 SOURCE_NOT_FOUND。
 */
import { validateSync } from 'class-validator';
import { AnnouncementAttachmentService } from './announcement-attachment.service';
import { AttachFromObjectDto } from './dto/attach-from-object.dto';
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

describe('AttachFromObjectDto — I-1 键正则', () => {
  const mk = (objectKey: string) => {
    const dto = new AttachFromObjectDto();
    dto.objectKey = objectKey;
    return validateSync(dto);
  };

  it('合法 PMI 键通过（明文中文/URL 编码两形态）；穿越/绝对路径/空格/空串拒绝', () => {
    expect(mk('project-management/1750000000-x-%E6%96%87.pdf')).toHaveLength(0);
    expect(mk('project-management/1750000000-x-采购文件.pdf')).toHaveLength(0);
    expect(mk('../../../../etc/passwd')).not.toHaveLength(0);
    expect(mk('/etc/passwd')).not.toHaveLength(0);
    expect(mk('a b/c')).not.toHaveLength(0);
    expect(mk('')).not.toHaveLength(0);
  });
});

describe('AnnouncementAttachmentService.attachFromObject — I-1 引用源白名单（2026-11-23 增量审查）', () => {
  const readBufferMock = readAttachmentBuffer as unknown as jest.Mock;

  beforeEach(() => { readBufferMock.mockReset(); });

  it('v3-staging 密文键 → 400 FORBIDDEN_SOURCE_KEY，不触读取（挡复制挂公告公开披露链）', async () => {
    const svc = makeService();
    await expect(svc.attachFromObject('ann-1', { objectKey: 'v3-staging/p1/s1/x.outer' } as never, 'u-1'))
      .rejects.toMatchObject({ response: { code: 'FORBIDDEN_SOURCE_KEY' } });
    expect(readBufferMock).not.toHaveBeenCalled();
  });

  it('签字包/回流包/任意非 PMI 前缀同拒（白名单制默认拒）', async () => {
    const svc = makeService();
    for (const objectKey of ['bid-sign-packet/p1.pdf', 'sealed-backup/x', 'uploads/2026/x.pdf']) {
      await expect(svc.attachFromObject('ann-1', { objectKey } as never, 'u-1'))
        .rejects.toMatchObject({ response: { code: 'FORBIDDEN_SOURCE_KEY' } });
    }
  });

  it('project-management/ 合法键放行至读取轨（既有引用流程不回归）', async () => {
    readBufferMock.mockResolvedValue(Buffer.from('x'));
    const svc = makeService();
    try {
      await svc.attachFromObject('ann-1', DTO, 'u-1');
    } catch {
      /* 后续 minio 断言细节归既有用例——此处只断言读取轨被触达 */
    }
    expect(readBufferMock).toHaveBeenCalledWith(DTO.objectKey);
  });
});
