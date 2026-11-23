import { readFileSync } from 'fs';
import * as path from 'path';
import * as JSZip from 'jszip';
import {
  buildInvitedBiddingAnnouncementPlan,
  renderTemplateXml,
  COMPETITIVE_NEGOTIATION_ANNOUNCEMENT_TEMPLATE_FILE,
} from './tender-write.template';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
async function loadTemplateXml(file: string): Promise<string> {
  const buf = readFileSync(path.resolve(PROJECT_ROOT, file));
  const zip = await JSZip.loadAsync(buf);
  return zip.file('word/document.xml')!.async('string');
}

/** 工期及进度要求节标签前置（2026-11-23 修复：四个公告模板的 {{工期及进度要求}} 均为裸占位段、
 *  无「3、工期及进度要求：」标签——发布预览/门户正文该节标题整体缺失（便携式钻机谈判公告实录）。
 *  标签行经 isHierarchicalText 的 \n→<w:br/> 独立成行；编号按模板节序：默认 3、（谈判/询比/
 *  竞价/邀请——1 采购内容、2 最高限价在前），公开招标 4、（3 资格审查方式在前）。 */
describe('buildInvitedBiddingAnnouncementPlan — 工期及进度要求节标签前置', () => {
  const findSchedule = (plan: ReturnType<typeof buildInvitedBiddingAnnouncementPlan>) =>
    plan.find((r) => r.targetText === '工期及进度要求')!;

  const base = {
    projectName: '钻机采购',
    maxPriceChinese: '捌拾柒万叁仟元',
    maxPriceNumeric: '873000',
    scheduleRequirementsType: 'have',
    scheduleRequirements: '1. 合同签订之日起60日历天内完成供货。\n2. 到货后7日内完成安装。',
  } as any;

  it('默认（谈判/询比/竞价/邀请）：值前置「3、工期及进度要求：」标签行', () => {
    const r = findSchedule(buildInvitedBiddingAnnouncementPlan(base));
    expect(r.replacementText.startsWith('3、工期及进度要求：\n')).toBe(true);
    expect(r.replacementText).toContain('1. 合同签订之日起');
    expect(r.isHierarchicalText).toBe(true);
  });

  it('公开招标（scheduleLabelNo=4）：前置「4、工期及进度要求：」', () => {
    const r = findSchedule(buildInvitedBiddingAnnouncementPlan(base, { scheduleLabelNo: '4' }));
    expect(r.replacementText.startsWith('4、工期及进度要求：\n')).toBe(true);
  });

  it('值已带同款前缀（自动填充形态）→ 幂等不重复', () => {
    const r = findSchedule(buildInvitedBiddingAnnouncementPlan({
      ...base,
      scheduleRequirements: '3、工期及进度要求：1. 六十天内供货。',
    } as any));
    expect(r.replacementText).toBe('3、工期及进度要求：1. 六十天内供货。');
  });

  it('选「无」：值空 + shouldDeleteLine=true（标签不掺入，整段照删）', () => {
    const r = findSchedule(buildInvitedBiddingAnnouncementPlan({
      ...base,
      scheduleRequirementsType: 'none',
      scheduleRequirements: '',
    } as any));
    expect(r.replacementText).toBe('');
    expect(r.shouldDeleteLine).toBe(true);
  });

  it('有值缺省（type 未设但值在）→ 照常前置标签（导入/存量草稿兼容）', () => {
    const r = findSchedule(buildInvitedBiddingAnnouncementPlan({
      ...base,
      scheduleRequirementsType: undefined,
    } as any));
    expect(r.replacementText.startsWith('3、工期及进度要求：\n')).toBe(true);
  });
});

describe('公告正文下一级序号归一「N. / N、」→「N）」（2026-11-23 用户裁定）', () => {
  it('渲染后行首子级序号为「1）2）」形态（谈判公告模板端到端）', async () => {
    const xml = await loadTemplateXml(COMPETITIVE_NEGOTIATION_ANNOUNCEMENT_TEMPLATE_FILE);
    const rendered = renderTemplateXml(xml, buildInvitedBiddingAnnouncementPlan({
      projectName: '钻机采购',
      scheduleRequirementsType: 'have',
      scheduleRequirements: '1. 合同签订之日起60日历天内完成供货。\n2. 到货后7日内完成安装。',
    } as any));
    const text = rendered.replace(/<[^>]+>/g, '');
    expect(text).toContain('3、工期及进度要求：');
    expect(text).toContain('1）合同签订之日起');
    expect(text).toContain('2）到货后');
    expect(text).not.toContain('1. 合同签订');
  });

  it('「N、」为节标签样式不归一；小数（N. 后跟数字）不误伤', async () => {
    const xml = await loadTemplateXml(COMPETITIVE_NEGOTIATION_ANNOUNCEMENT_TEMPLATE_FILE);
    const rendered = renderTemplateXml(xml, buildInvitedBiddingAnnouncementPlan({
      projectName: '钻机采购',
      scheduleRequirementsType: 'have',
      scheduleRequirements: '1、六十天内供货，单重60.5吨。\n2、七天安装。\n3. 备用条款。',
    } as any));
    const text = rendered.replace(/<[^>]+>/g, '');
    // N、 = 节标签样式（同 1、采购内容包括：/3、工期及进度要求：），保持原样
    expect(text).toContain('1、六十天内供货，单重60.5吨');
    expect(text).toContain('2、七天安装');
    expect(text).toContain('60.5吨');
    // 句点式仍归一
    expect(text).toContain('3）备用条款');
  });
});
