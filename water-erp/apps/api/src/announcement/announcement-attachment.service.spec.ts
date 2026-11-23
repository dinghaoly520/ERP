/**
 * I-1（2026-11-23 增量审查）：from-object 引用源白名单 + DTO 键正则单测。
 * 攻击链回填：v3-staging/ 或他项目密文键经 from-object 复制挂公告 → :3002 公开披露——白名单闸拦截。
 */
jest.mock('../common/attachment-object-store', () => ({
  readAttachmentBuffer: jest.fn(),
}));

import { validateSync } from 'class-validator';
import { AnnouncementAttachmentService } from './announcement-attachment.service';
import { AttachFromObjectDto } from './dto/attach-from-object.dto';
import { readAttachmentBuffer } from '../common/attachment-object-store';

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

describe('AnnouncementAttachmentService.attachFromObject — I-1 引用源白名单', () => {
  const svc = new AnnouncementAttachmentService({ announcement: { findUnique: async () => ({ id: 'a1' }) } } as any);

  beforeEach(() => { (readAttachmentBuffer as jest.Mock).mockReset(); });

  it('v3-staging 密文键 → 400 FORBIDDEN_SOURCE_KEY，不触读取', async () => {
    await expect(svc.attachFromObject('a1', { objectKey: 'v3-staging/p1/s1/x.outer' } as any, 'u1'))
      .rejects.toMatchObject({ response: { code: 'FORBIDDEN_SOURCE_KEY' } });
    expect(readAttachmentBuffer).not.toHaveBeenCalled();
  });

  it('签字包/回流包/任意非 PMI 前缀同拒（白名单制默认拒）', async () => {
    for (const key of ['bid-sign-packet/p1.pdf', 'sealed-backup/x', 'uploads/2026/x.pdf']) {
      await expect(svc.attachFromObject('a1', { objectKey: key } as any, 'u1'))
        .rejects.toMatchObject({ response: { code: 'FORBIDDEN_SOURCE_KEY' } });
    }
  });

  it('project-management/ 合法键放行至读取轨', async () => {
    (readAttachmentBuffer as jest.Mock).mockResolvedValue(Buffer.from('x'));
    try {
      await svc.attachFromObject('a1', { objectKey: 'project-management/ok.pdf' } as any, 'u1');
    } catch {
      /* 后续 minio/prisma 未 mock 的崩错不关心——本用例只断言读取轨被触达 */
    }
    expect(readAttachmentBuffer).toHaveBeenCalledWith('project-management/ok.pdf');
  });
});
