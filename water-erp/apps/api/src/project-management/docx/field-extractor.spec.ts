import { extractProjectOverviewFromText } from './field-extractor';

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
});
