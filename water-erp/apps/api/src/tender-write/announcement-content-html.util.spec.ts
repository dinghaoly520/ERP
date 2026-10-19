import * as fs from 'fs';
import * as path from 'path';
import {
  alignSignatureParagraphs,
  extractAnnouncementContentHtml,
} from './announcement-content-html.util';

describe('alignSignatureParagraphs（落款右对齐）', () => {
  it('相邻的采购人段 + 纯日期段右对齐', () => {
    const html =
      '<p>八、监督举报</p><p>四川水发勘测设计研究有限公司</p><p>2026年10月19日</p>';
    expect(alignSignatureParagraphs(html)).toBe(
      '<p>八、监督举报</p><p style="text-align:right">四川水发勘测设计研究有限公司</p><p style="text-align:right">2026年10月19日</p>',
    );
  });

  it('无纯日期段时原样返回', () => {
    const html = '<p>公告正文</p><p>四川水发勘测设计研究有限公司</p>';
    expect(alignSignatureParagraphs(html)).toBe(html);
  });

  it('多个日期时只对齐最后一个及其前一段', () => {
    const html = '<p>2026年1月1日</p><p>中间段落</p><p>2026年10月19日</p>';
    expect(alignSignatureParagraphs(html)).toBe(
      '<p>2026年1月1日</p><p style="text-align:right">中间段落</p><p style="text-align:right">2026年10月19日</p>',
    );
  });

  it('日期前不是 <p> 段（如表格结尾）时只对齐日期段', () => {
    const html = '<table><tr><td>x</td></tr></table><p>2026年10月19日</p>';
    expect(alignSignatureParagraphs(html)).toBe(
      '<table><tr><td>x</td></tr></table><p style="text-align:right">2026年10月19日</p>',
    );
  });

  it('非纯日期（含其他文字）不触发对齐', () => {
    const html = '<p>公示期限：2026年10月19日 至 2026年10月22日</p><p>公司</p>';
    expect(alignSignatureParagraphs(html)).toBe(html);
  });
});

describe('extractAnnouncementContentHtml（公告正文 HTML：表格保结构）', () => {
  // 回归锁（2026-10-19）：发布向导正文此前走 mammoth.extractRawText，表格被拆成
  // 逐单元格竖排 <p>，门户详情表格整块丢失。此处锁定 convertToHtml 路径的表格结构。
  it('中标公告模板 docx 转 HTML 保留 <table> 与单元格文本', async () => {
    const templatePath = path.resolve(
      __dirname,
      '../../模板文件/中标公告模板.docx',
    );
    if (!fs.existsSync(templatePath)) return; // 模板随仓库分发，缺失时跳过而非红
    const buffer = fs.readFileSync(templatePath);
    const html = await extractAnnouncementContentHtml(buffer);

    expect(html).toContain('<table>');
    expect(html).toContain('<td');
    // 模板单元格内有软换行（「中标候选<br />人排序」），断言用连续文本列
    expect(html).toContain('中标候选人名称');
    expect(html).toContain('{{投标单位1}}');
    // 备注列纵向合并（rowspan="3"）须保留——表格语义的一部分
    expect(html).toContain('rowspan="3"');
  });
});
