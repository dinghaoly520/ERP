import { extractProjectOverviewFromText, capOverviewLength } from './field-extractor';

/**
 * 概况长度闸（2026-10-16）：项目基本信息「项目概况」定位为简介与概括性描述——
 * 采购内容可写但不整章搬运（原实现最多收 40 行，长文档概况字段被灌入整章细目）。
 * 口径：累计约 200 字即停收（当前行收完再停，保证行完整）；AI 侧同口径 80-200 字概括。
 */
describe('extractProjectOverviewFromText — 概况长度闸（2026-10-16 简洁口径）', () => {
  it('超长概况章节 → 截断到约 200 字，不整章搬运', () => {
    const line = '本项目采购水文监测设备，包含传感器、数据采集终端、通信模块及配套软件平台。';
    const filler = Array.from({ length: 30 }, (_, i) => `${line}第${i}批次规格参数详见附表${i}。`).join('\n');
    const text = ['一、项目概况', filler, '二、供应商资格要求'].join('\n');

    const out = extractProjectOverviewFromText(text, undefined);

    expect(out).toBeTruthy();
    expect(out!.length).toBeLessThanOrEqual(300); // 200 字闸 + 末行完整收尾余量
    expect(out!).toContain('水文监测设备');
  });

  it('短概况 → 原样保留，闸不生效', () => {
    const text = '一、项目概况\n本项目采购办公设备一批，含打印机与复印机。\n二、供应商资格要求';

    const out = extractProjectOverviewFromText(text, undefined);

    expect(out).toContain('办公设备一批');
    expect(out!.length).toBeLessThanOrEqual(50);
  });

  it('直接采购：采购内容段同样受闸约束', () => {
    const line = '采购内容：本次采购安全防护用品，包含安全帽、反光背心、防护手套等劳保用品。';
    const filler = Array.from({ length: 25 }, (_, i) => `${line}型号${i}参数明细见清单${i}。`).join('\n');
    const text = ['采购内容', filler, '三、商务要求'].join('\n');

    const out = extractProjectOverviewFromText(text, '直接采购');

    expect(out).toBeTruthy();
    expect(out!.length).toBeLessThanOrEqual(300);
  });

  it('单行长概况（整段写在标题行）→ 同样被闸住（firstLine 逃逸防御）', () => {
    const longLine = '项目概况：' + '本项目采购水利信息化设备并配套建设监测平台。'.repeat(40);
    const text = [longLine, '二、供应商资格要求'].join('\n');

    const out = extractProjectOverviewFromText(text, undefined);

    expect(out).toBeTruthy();
    expect(out!.length).toBeLessThanOrEqual(260);
  });
});

describe('capOverviewLength — 出口硬闸（句边界截断）', () => {
  it('≤220 字直通不动', () => {
    const s = '本'.repeat(210);
    expect(capOverviewLength(s)).toBe(s);
  });

  it('超长且句末标点在中后部 → 截到窗口内最后一个句末标点（含标点）', () => {
    const s = '概况首句。' + '核心采购内容说明文字。'.repeat(20); // 句号每 11 字一个，窗口 210 内最后一个在 ~203 字
    const out = capOverviewLength(s)!;
    expect(out.length).toBeLessThanOrEqual(215);
    expect(out.endsWith('。')).toBe(true);
    expect(out).toContain('核心采购内容');
  });

  it('超长但句末标点仅在前部（截前句会丢绝大部分内容）→ 硬切 200 字 + 省略号', () => {
    const s = '第一句概况。' + '第二句说明。' + '后续无标点的参数细目长串'.repeat(30);
    const out = capOverviewLength(s)!;
    expect(out.length).toBeLessThanOrEqual(202);
    expect(out.endsWith('……')).toBe(true);
  });

  it('超长且窗口内无句末标点 → 硬切 200 字 + 省略号', () => {
    const s = '无标点长串'.repeat(80);
    const out = capOverviewLength(s)!;
    expect(out.length).toBeLessThanOrEqual(202);
    expect(out.endsWith('……')).toBe(true);
  });

  it('null/空串原样返回', () => {
    expect(capOverviewLength(null)).toBeNull();
    expect(capOverviewLength('')).toBe('');
  });
});
