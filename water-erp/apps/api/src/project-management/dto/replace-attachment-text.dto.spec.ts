import { validateSync } from 'class-validator';
import { ReplaceAttachmentTextDto } from './replace-attachment-text.dto';

/**
 * 「用文本替换附件」端点的入参校验（2026-11-25 审查）。
 * 此前它是无校验的内联类型：fileName 想传什么都行，而它会落进 Attachment.fileName
 * （界面展示，归档时还用作目录里的文件名）。
 */
describe('ReplaceAttachmentTextDto', () => {
  const errorsOf = (body: Record<string, unknown>) =>
    validateSync(Object.assign(new ReplaceAttachmentTextDto(), body));

  it('合法入参通过；text 允许为空串（清空正文是既有用法）', () => {
    expect(errorsOf({ attachmentId: 'a1', text: '', fileName: '采购文件.docx' })).toHaveLength(0);
  });

  it.each<[Record<string, unknown>, string]>([
    [{ attachmentId: 'a1', text: 'x' }, '缺 fileName'],
    [{ attachmentId: 'a1', text: 'x', fileName: '' }, 'fileName 为空串'],
    [{ attachmentId: 'a1', text: 'x', fileName: '../../etc/passwd' }, 'fileName 含路径分隔符'],
    [{ attachmentId: 'a1', text: 'x', fileName: 'a\\b.docx' }, 'fileName 含反斜杠'],
    [{ attachmentId: 'a1', text: 'x', fileName: 'a\n.docx' }, 'fileName 含换行'],
    [{ attachmentId: 'a1', text: 'x', fileName: 'x'.repeat(256) }, 'fileName 超长'],
    [{ text: 'x', fileName: 'a.docx' }, '缺 attachmentId'],
    [{ attachmentId: '', text: 'x', fileName: 'a.docx' }, 'attachmentId 为空串'],
  ])('%p 被拒：%s', (body) => {
    expect(errorsOf(body).length).toBeGreaterThan(0);
  });

  it('路由按这个 DTO 绑定请求体——内联类型不会被校验管道校验', () => {
    const { ProjectManagementController } = require('../project-management.controller');
    const types: unknown[] = Reflect.getMetadata(
      'design:paramtypes',
      ProjectManagementController.prototype,
      'replaceAttachmentText',
    );
    expect(types).toContain(ReplaceAttachmentTextDto);
  });
});
