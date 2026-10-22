import * as fs from 'fs';
import * as path from 'path';
import {
  alignSignatureParagraphs,
  extractAnnouncementContentHtml,
  normalizeAnnouncementHtml,
  joinSoftWrappedPlainText,
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

  it('日期段带前导空格/nbsp（询比/竞价/流标模板 docx 前导空格模拟右对齐）仍对齐', () => {
    const html = '<p>           四川水发勘测设计研究有限公司</p><p>           2026年10月19日</p>';
    expect(alignSignatureParagraphs(html)).toBe(
      '<p style="text-align:right">           四川水发勘测设计研究有限公司</p><p style="text-align:right">2026年10月19日</p>',
    );
    const nbspHtml = '<p>公司</p><p>  2026年10月19日 </p>';
    expect(alignSignatureParagraphs(nbspHtml)).toBe(
      '<p style="text-align:right">公司</p><p style="text-align:right">2026年10月19日</p>',
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

describe('软换行安全网 normalizeAnnouncementHtml（2026-10-22 重立，仅渲染层）', () => {
  it('<br/> 句中断词合并：CJK 直连、拉丁补空格、数字直连', () => {
    expect(
      normalizeAnnouncementHtml('<p>本项目为勘察设<br />计咨询服务</p>'),
    ).toBe('<p>本项目为勘察设计咨询服务</p>');
    expect(
      normalizeAnnouncementHtml('<p>采用 Deep<br />Seek 模型</p>'),
    ).toBe('<p>采用 Deep Seek 模型</p>');
    expect(
      normalizeAnnouncementHtml('<p>总价 1,234<br />567.89 元</p>'),
    ).toBe('<p>总价 1,234567.89 元</p>');
  });

  it('段内 <br/> 恒为软换行：句末标点后仍合并（分段语义只由 <p> 边界承载）', () => {
    expect(
      normalizeAnnouncementHtml('<p>特此公告。<br />联系人：张三</p>'),
    ).toBe('<p>特此公告。联系人：张三</p>');
  });

  it('每行成段链式合并：无句读行串回一段', () => {
    const html =
      '<p>本项目已由相关部门批准建设，</p><p>资金来源为自筹，</p><p>项目已具备招标条件。</p>';
    expect(normalizeAnnouncementHtml(html)).toBe(
      '<p>本项目已由相关部门批准建设，资金来源为自筹，项目已具备招标条件。</p>',
    );
  });

  it('句读结尾的段落保留边界；列表/序号起始段保留', () => {
    const html =
      '<p>现将有关事项公告如下：</p><p>一、项目概况</p><p>本项目为水利工程设计。</p><p>（一）建设地点：成都市。</p>';
    const out = normalizeAnnouncementHtml(html);
    expect(out).toContain('<p>现将有关事项公告如下：</p>');
    expect(out).toContain('<p>一、项目概况</p>');
    expect(out).toContain('<p>本项目为水利工程设计。</p>');
    expect(out).toContain('<p>（一）建设地点：成都市。</p>');
  });

  it('落款保护：采购人段与纯日期段不并入正文（右对齐识别仍可用）', () => {
    const html =
      '<p>欢迎符合条件的供应商参加。</p><p>特此公告</p><p>四川水发勘测设计研究有限公司</p><p>2026年10月19日</p>';
    const out = alignSignatureParagraphs(normalizeAnnouncementHtml(html));
    expect(out).toContain('<p>特此公告</p>');
    expect(out).toContain(
      '<p style="text-align:right">四川水发勘测设计研究有限公司</p>',
    );
    expect(out).toContain('<p style="text-align:right">2026年10月19日</p>');
  });

  it('短标题行（序号开头且无句读）不与后段合并', () => {
    const html = '<p>二、供应商资格要求</p><p>供应商须具备水利水电资质。</p>';
    expect(normalizeAnnouncementHtml(html)).toBe(html);
  });

  it('表格结构不跨界合并：单元格间隔含 </td><td> 非空白', () => {
    const html =
      '<table><tr><td><p>勘察设</p></td><td><p>计咨询</p></td></tr></table>';
    expect(normalizeAnnouncementHtml(html)).toBe(html);
  });

  it('幂等：已归一文本复跑无变化', () => {
    const html = '<p>本项目为勘察设计咨询服务。</p><p>一、项目概况</p>';
    expect(normalizeAnnouncementHtml(normalizeAnnouncementHtml(html))).toBe(
      normalizeAnnouncementHtml(html),
    );
  });
});

describe('纯文本软换行合并 joinSoftWrappedPlainText（纯文本→HTML 切段前）', () => {
  it('句中软换行链式合并，句读/列表/空行边界保留', () => {
    const text = [
      '本项目已由相关部门批准建设，',
      '资金来源为自筹，',
      '项目已具备招标条件，现进行公开招标。',
      '',
      '一、项目概况',
      '本项目为水利工程设计。',
    ].join('\n');
    expect(joinSoftWrappedPlainText(text)).toBe(
      [
        '本项目已由相关部门批准建设，资金来源为自筹，项目已具备招标条件，现进行公开招标。',
        '',
        '一、项目概况',
        '本项目为水利工程设计。',
      ].join('\n'),
    );
  });

  it('落款日期行与收尾行独立成段（后接模板分段不误伤）', () => {
    const text = '欢迎符合条件供应商参加投标\n特此公告\n四川水发勘测设计研究有限公司\n2026年10月19日';
    expect(joinSoftWrappedPlainText(text)).toBe(text);
  });

  it('拉丁词跨行补空格、数字直连', () => {
    expect(joinSoftWrappedPlainText('采用 Deep\nSeek 模型')).toBe('采用 Deep Seek 模型');
    expect(joinSoftWrappedPlainText('总价 1,234\n567.89 元')).toBe('总价 1,234567.89 元');
  });
});
