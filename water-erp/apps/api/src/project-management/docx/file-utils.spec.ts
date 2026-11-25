import { isTenderMainFile, sanitizeFileName } from './file-utils';
import { isSafeAttachmentKey } from '../../common/attachment-key.util';

describe('isTenderMainFile', () => {
  it.each([
    'SWHI-TP-2026111201-便携式全液压岩心钻机-谈判文件-20261112.docx', // 谈判导出命名（2026-11-12 实录漏网）
    'TP-2026101901-闸门维修-采购文件.docx',
    'XX-2026-某项目-招标文件.docx',
  ])('%s → 主文件', (fileName) => {
    expect(isTenderMainFile(fileName)).toBe(true);
  });

  it.each([
    'XX-需求书.pdf',
    'XX-采购合同.docx',
    'XX-中标通知书.pdf',
    'XX-立项申请表.docx',
  ])('%s → 非主文件', (fileName) => {
    expect(isTenderMainFile(fileName)).toBe(false);
  });
});

describe('sanitizeFileName — 落盘文件名', () => {
  it.each([
    ['采购文件.docx', '采购文件.docx'], // 正常文件名原样
    ['报告.PDF', '报告.PDF'],
    ['readme.final.docx', 'readme-final.docx'],
    ['README', 'README.bin'],
  ])('%s → %s', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  // 扩展名只取开头连续的字母数字：扩展名后面拖着的任何东西都不进落盘文件名
  it.each([
    ['采购文件.docx（终版）', '采购文件.docx'],
    ['扫描件.docx ', '扫描件.docx'],
    ['旧件.doc(1)', '旧件.doc'],
    ['奇怪.abcdefghi', '奇怪.bin'],
    ['怪.文 档', '怪.bin'],
  ])('%s → %s', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  // 不变式：按 persistUploadedFile 的拼法落盘的键，一定能过「引用采购文件」的源键闸
  // （闸只认 project-management/ 前缀加一组安全字符；此前它成立只是因为上传先过了扩展名白名单）
  it.each([
    '采购文件.docx',
    '采购文件.docx（终版）',
    '扫描件.docx ',
    '旧件.doc(1)',
    '奇怪.abcdefghi',
    '怪.文 档',
    'report.final.v2.docx',
    'README',
    '报告#3（定稿）.pdf',
  ])('由「%s」落盘的键能过源键闸', (name) => {
    const key = `project-management/${Date.now()}-initiation-${sanitizeFileName(name)}`;
    expect(isSafeAttachmentKey(key)).toBe(true);
  });
});
