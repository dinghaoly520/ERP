/**
 * 租户占位体系（2026-10-09，二期用户拍板显式占位符化）：
 * - 主轨：模板固定串已由 scripts/convert-templates-to-placeholders.ts 一次性转为
 *   {{采购人名称}}/{{监督部门}}/{{监督地址}}/{{监督人}}/{{监督电话}} 显式占位符，
 *   渲染计划经 buildTenantPlaceholderReplacements 追加填充项（公司=当前用户公司，
 *   监督块=公告表单值，留空回退统一默认值）。
 * - 安全网：applyTenantTokens 在 renderTemplateXml 之后兜底——若重导入了带固定串的
 *   旧式模板（用户手工维护、git 历史即有重命名/删除），固定串仍被替换，不漏印。
 *   顺序敏感：监督块整串（含公司名）先替换，公司名兜底放最后。
 */

import type { TemplateReplacement } from './tender-write.template';

/** 平台主公司名——模板内作为「采购人」固定串出现，导出时替换为当前用户公司 */
export const TENANT_OWNER_COMPANY_TOKEN = '四川水发勘测设计研究有限公司';

export interface SupervisionTokens {
  /** 监督部门（公告表单可改；缺省时由公司名兜底拼出「{公司}纪检监察部」） */
  department?: string;
  /** 监督地址 */
  address?: string;
  /** 监督联系人（多人以顿号拼接，来自「监督人」多选） */
  contact?: string;
  /** 监督电话 */
  phone?: string;
}

// 模板内监督块固定串（历史两种地址写法并存：公告类=双流区…B座9楼；采购文件类=天府新区…）
const SUPERVISION_DEPARTMENT_TOKEN = '四川水发勘测设计研究有限公司纪检监察部';
const SUPERVISION_ADDRESS_TOKENS = [
  // 公告类模板（竞价/询比/邀请招标/直接采购/流标）
  '四川省成都市双流区红莲街三段383号四川水发集团B座9楼',
  // 采购文件类模板（竞价/谈判/邀请招标文件）
  '四川省成都市天府新区红莲街三段383号',
  // 中标公告模板（第三种历史写法：无省前缀、B栋、无「三段」）
  '成都市天府新区红莲街383号B栋9楼',
];
const SUPERVISION_CONTACT_TOKENS = ['王先生、徐先生', '王先生'];
const SUPERVISION_PHONE_TOKEN = '028-81753276';

function escapeXmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** <w:t> 文本段（不含标签），供跨 run 定位 */
interface TextSegment {
  openTagStart: number; // '<w:t…' 起点
  openTagEnd: number; // '>' 之后（= 文本起点）
  closeEnd: number; // '</w:t>' 之后
  text: string;
}

function collectTextSegments(xml: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    segments.push({
      openTagStart: m.index,
      openTagEnd: m.index + m[0].indexOf('>') + 1,
      closeEnd: m.index + m[0].length,
      text: m[1],
    });
  }
  return segments;
}

/**
 * 跨 <w:t> run 的文本替换。Word 常把整句拆进多个 run（实测：邀请招标文件模板/直接采购
 * 模板各有 1 处公司名拆 run，「王先生、徐先生」在部分公告模板拆在顿号处），单串 replace
 * 会漏。做法：把全文 <w:t> 文本拼成一条逻辑串定位目标，替换文本写入首个命中段、其余
 * 命中段抹掉重叠部分；各段标签与未命中文本原样保留，替换文本继承首段字体格式。
 * 循环替换直至无命中（同串多处出现全替换）。
 */
export function replaceTextAcrossRuns(
  xml: string,
  target: string,
  replacement: string,
): string {
  if (!target) return xml;
  const escapedReplacement = escapeXmlText(replacement);

  // 防自含膨胀（稳健性加固）：替换串包含目标串时（如「王先生、徐先生」含「王先生」），
  // 朴素循环会把替换产物里的目标再次替换、逐轮增长出损坏文本——先统一换成文中
  // 不存在的哨兵字符，再一次性还原（哨兵不含目标，两阶段都天然收敛）
  if (escapedReplacement.includes(target)) {
    let sentinel = '\uE000'; // 私用区字符，正常文档不出现
    while (xml.includes(sentinel) || escapedReplacement.includes(sentinel)) {
      sentinel += '\uE000';
    }
    const staged = replaceAllOccurrencesOnceAtATime(xml, target, sentinel);
    return replaceAllOccurrencesOnceAtATime(staged, sentinel, escapedReplacement);
  }

  return replaceAllOccurrencesOnceAtATime(xml, target, escapedReplacement);
}

/** 逐次替换全部命中（单目标 ≤11 次；200 次上限仅为防意外死循环） */
function replaceAllOccurrencesOnceAtATime(
  xml: string,
  target: string,
  escapedReplacement: string,
): string {
  for (let guard = 0; guard < 200; guard += 1) {
    const segments = collectTextSegments(xml);
    const offsets: number[] = [];
    let total = 0;
    for (const seg of segments) {
      offsets.push(total);
      total += seg.text.length;
    }
    const combined = segments.map((s) => s.text).join('');
    const hit = combined.indexOf(target);
    if (hit < 0) return xml;

    const hitEnd = hit + target.length;
    let firstSeg = -1;
    let lastSeg = -1;
    for (let i = 0; i < segments.length; i += 1) {
      const start = offsets[i];
      const end = start + segments[i].text.length;
      if (firstSeg < 0 && end > hit) firstSeg = i;
      if (start < hitEnd) lastSeg = i;
    }
    if (firstSeg < 0 || lastSeg < firstSeg) return xml;

    const edits: Array<{ segIndex: number; newText: string }> = [];
    for (let i = firstSeg; i <= lastSeg; i += 1) {
      const start = offsets[i];
      const segText = segments[i].text;
      let newText = '';
      if (i === firstSeg) {
        newText += segText.slice(0, hit - start) + escapedReplacement;
      }
      if (i === lastSeg) {
        newText += segText.slice(Math.max(hitEnd - start, 0));
      }
      edits.push({ segIndex: i, newText });
    }

    // 从后往前改写，保住未命中区间的原坐标
    for (let e = edits.length - 1; e >= 0; e -= 1) {
      const { segIndex, newText } = edits[e];
      const seg = segments[segIndex];
      const openTag = xml.slice(seg.openTagStart, seg.openTagEnd);
      xml =
        xml.slice(0, seg.openTagStart) +
        `${openTag}${newText}</w:t>` +
        xml.slice(seg.closeEnd);
    }
  }
  return xml;
}

/**
 * 显式占位符计划项（2026-10-09 二期，用户拍板模板显式占位符化）：模板固定串已转为
 * {{采购人名称}}/{{监督部门}}/{{监督地址}}/{{监督人}}/{{监督电话}} 占位符——渲染计划
 * 追加这五项填充：
 * - 公司名：当前用户公司；未归属回退平台主公司（模板原值已不在模板内，必须兜底）
 * - 监督块：表单值优先，留空回退统一默认值（与预览端口径一致）
 * 注意：直接采购备案表模板自有 {{采购人名称}}（buildDirectFilingPlan 已填），传
 * includeCompany=false 跳过公司项避免先到先得覆盖。
 */
export function buildTenantPlaceholderReplacements(
  ownerCompanyName: string | null | undefined,
  supervision?: SupervisionTokens,
  includeCompany = true,
): TemplateReplacement[] {
  const company = ownerCompanyName?.trim() || TENANT_OWNER_COMPANY_TOKEN;
  // 监督块留空即空（2026-10-10 用户裁定）：未维护不编造——不再拼「公司名+纪检监察部」、
  // 不再回退模板原值（王先生等）；「采购人名称」仍取登录公司（真实归属，非编造）
  return [
    ...(includeCompany
      ? [{ targetText: '采购人名称', replacementText: company, highlight: false }]
      : []),
    { targetText: '监督部门', replacementText: supervision?.department?.trim() ?? '', highlight: false },
    { targetText: '监督地址', replacementText: supervision?.address?.trim() ?? '', highlight: false },
    { targetText: '监督人', replacementText: supervision?.contact?.trim() ?? '', highlight: false },
    { targetText: '监督电话', replacementText: supervision?.phone?.trim() ?? '', highlight: false },
  ];
}

/**
 * 导出兜底替换入口（安全网：模板占位符化后正常路径不再命中；若重导入了带固定串的
 * 旧式模板仍能兜住）：
 * 1. 监督块四类固定串 → 表单值（提供的字段才替换；空值保留模板原样）
 * 2. 裸公司名 → 当前用户公司（无归属公司或恰为主公司则不动，等同旧行为）
 */
export function applyTenantTokens(
  xml: string,
  ownerCompanyName: string | null | undefined,
  supervision?: SupervisionTokens,
): string {
  let out = xml;
  const department = supervision?.department?.trim();
  const address = supervision?.address?.trim();
  const contact = supervision?.contact?.trim();
  const phone = supervision?.phone?.trim();

  if (department) {
    out = replaceTextAcrossRuns(out, SUPERVISION_DEPARTMENT_TOKEN, department);
  }
  if (address) {
    for (const token of SUPERVISION_ADDRESS_TOKENS) {
      out = replaceTextAcrossRuns(out, token, address);
    }
  }
  if (contact) {
    for (const token of SUPERVISION_CONTACT_TOKENS) {
      out = replaceTextAcrossRuns(out, token, contact);
    }
  }
  if (phone) {
    out = replaceTextAcrossRuns(out, SUPERVISION_PHONE_TOKEN, phone);
  }

  const owner = ownerCompanyName?.trim();
  if (owner && owner !== TENANT_OWNER_COMPANY_TOKEN) {
    out = replaceTextAcrossRuns(out, TENANT_OWNER_COMPANY_TOKEN, owner);
  }
  return out;
}
