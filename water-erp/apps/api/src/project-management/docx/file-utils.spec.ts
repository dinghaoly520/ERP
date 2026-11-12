import { isTenderMainFile } from './file-utils';

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
