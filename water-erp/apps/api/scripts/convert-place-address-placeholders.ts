/**
 * 一次性转换二期（2026-10-09）：采购文件类模板的「地点/地址」固定串 → 显式占位符。
 *
 *   开标/递交/谈判/评审地点      → {{开标地点}}
 *   采购人地址/通讯地址/获取地点  → {{联系人地址}}
 *   监督举报块                   → 保持 {{监督地址}}（一期已转，不动）
 *
 * 同时拆分一期遗留的合并：一期把「四川省成都市天府新区红莲街三段383号」整串转成
 * {{监督地址}}，但该串在文件类模板中还兼任 四节开标地点/六节采购人地址/须知通讯地址
 * ——本脚本按段落上下文重新指派，并转换尚未占位符化的 正兴街道/天府新区 系列地址。
 *
 * 两个关键实现点（踩坑记录）：
 * 1. {{监督地址}} 占位符名本身含「监督」——监督上下文判定必须先把 {{…}} 从纯文本剔除，
 *    否则所有持有该占位符的段落都被误判为监督块而跳过。
 * 2. Word 会把地址拆进多个 <w:t> run——正则检测在「拼接文本」上做，替换用跨 run 拼接
 *    定位后回写首个命中段（与 tenant-tokens.replaceTextAcrossRuns 同思路的 regex 版）。
 *
 * 仅处理 5 个采购文件类模板（公告类一期已完整）。幂等可重跑。
 * 运行：cd apps/api && npx tsx scripts/convert-place-address-placeholders.ts
 */
import * as path from 'path';
import { promises as fs } from 'fs';
import * as JSZip from 'jszip';

const FILES = [
  '谈判采购文件模板.docx',
  '直接采购模板.docx',
  '询比采购文件模板.docx',
  '竞价采购文件模板.docx',
  '邀请招标文件模板.docx',
];

/**
 * 地址变体（空格容忍；省前缀/双流区/正兴街道/集团全称缺省、楼层数字均容忍）——
 * 在拼接纯文本上匹配。楼层数字必须容忍 9（文件类第二监督块的 B座9楼 全称变体，
 * 一期 token 只覆盖「四川水发集团B座9楼」简称变体而漏转——本脚本的起因之一）。
 */
const PLACE_REGEX =
  /(?:四川省)?成都市(?:双流区)?(?:正兴街道)?红莲街三段\s*383\s*号(?:(?:四川省水利发展集团有限公司|四川水发集团)\s*)?B\s*[座栋](?:\s*\d\s*楼(?:采购中心开标会议室)?)?/g;
const TIANFU_REGEX =
  /(?:四川省)?成都市天府新区红莲街三段\s*383\s*号(?:\s*B\s*[栋座]3楼)?/g;
const SUPERVISION_PLACEHOLDER = /\{\{监督地址\}\}/g;

/** 地点类标签——命中即视作「开标地点」语义 */
const PLACE_LABEL_RE = /(开标地点|递交和谈判地点|谈判地点|评审地点|竞价地点|报价地点)/;
const HEADER_RE = /^[一二三四五六七八九十]+、/;

interface TextSeg {
  openTagStart: number;
  openTagEnd: number;
  closeEnd: number;
  text: string;
}

function collectSegments(xml: string): TextSeg[] {
  const segs: TextSeg[] = [];
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    segs.push({
      openTagStart: m.index,
      openTagEnd: m.index + m[0].indexOf('>') + 1,
      closeEnd: m.index + m[0].length,
      text: m[1],
    });
  }
  return segs;
}

/** 段落 <w:t> 拼接文本（保留段内空格——检测用） */
function joinedText(xml: string): string {
  return collectSegments(xml)
    .map((s) => s.text)
    .join('');
}

/** 段落纯文本（去标签去空白，上下文判定用；{{占位符}} 一并剔除防误判） */
function contextText(xml: string): string {
  return joinedText(xml).replace(/\s+/g, '').replace(/\{\{[^}]*\}\}/g, '');
}

/**
 * 跨 run 正则替换（一段内）：在拼接文本上定位全部命中，回写首个命中段、
 * 抹掉其余命中段的重叠部分——替换文本继承首段格式（tenant-tokens 同思路 regex 版）。
 */
function replaceAcrossRunsRegex(
  xml: string,
  regex: RegExp,
  replacement: string,
): string {
  // 单命中循环：每次只处理首个命中（重扫重算坐标），多命中逐轮清——与
  // tenant-tokens.replaceTextAcrossRuns 同构；占位符不含地址模式，无自含膨胀风险
  for (let guard = 0; guard < 100; guard += 1) {
    const segments = collectSegments(xml);
    const offsets: number[] = [];
    let total = 0;
    for (const seg of segments) {
      offsets.push(total);
      total += seg.text.length;
    }
    const combined = segments.map((s) => s.text).join('');
    const hit = new RegExp(regex.source).exec(combined);
    if (!hit) return xml;
    const start = hit.index;
    const end = start + hit[0].length;

    let first = -1;
    let last = -1;
    for (let i = 0; i < segments.length; i += 1) {
      const s = offsets[i];
      const e = s + segments[i].text.length;
      if (first < 0 && e > start) first = i;
      if (s < end) last = i;
    }
    if (first < 0) return xml;

    // 从后往前改写命中段（首段带替换文本与命中前缀，尾段保留命中后缀，中间段抹除）
    for (let i = last; i >= first; i -= 1) {
      const seg = segments[i];
      const s = offsets[i];
      const t = seg.text;
      let newText = '';
      if (i === first) newText += t.slice(0, start - s) + replacement;
      if (i === last) newText += t.slice(Math.max(end - s, 0));
      const openTag = xml.slice(seg.openTagStart, seg.openTagEnd);
      xml =
        xml.slice(0, seg.openTagStart) + openTag + newText + '</w:t>' + xml.slice(seg.closeEnd);
    }
  }
  return xml;
}

/**
 * 残段清理：一期把「…天府新区…383号」整串转走时留下了后缀（「 B栋3楼」「四川省水利
 * 发展集团有限公司 B 座3楼采购中心开标会议室」等）——占位符已含完整地址语义，
 * 紧随其后的 B 座/B 栋系尾缀是垃圾文本，剥离（跨 run 定位后回写）。
 */
const RESIDUE_RE =
  /(\{\{(?:开标地点|联系人地址|监督地址)\}\})\s*(?:(?:四川省水利发展集团有限公司|四川水发集团)\s*)?B\s*[座栋](?:\s*3\s*楼)?(?:采购中心开标会议室)?/;

function stripResidue(xml: string): string {
  for (let guard = 0; guard < 50; guard += 1) {
    const segments = collectSegments(xml);
    const offsets: number[] = [];
    let total = 0;
    for (const seg of segments) {
      offsets.push(total);
      total += seg.text.length;
    }
    const combined = segments.map((s) => s.text).join('');
    const hit = RESIDUE_RE.exec(combined);
    if (!hit) return xml;
    const start = hit.index;
    const end = start + hit[0].length;
    let first = -1;
    let last = -1;
    for (let i = 0; i < segments.length; i += 1) {
      const s = offsets[i];
      const e = s + segments[i].text.length;
      if (first < 0 && e > start) first = i;
      if (s < end) last = i;
    }
    if (first < 0) return xml;
    for (let i = last; i >= first; i -= 1) {
      const seg = segments[i];
      const s = offsets[i];
      const t = seg.text;
      let newText = '';
      if (i === first) newText += t.slice(0, start - s) + hit[1]; // 只留占位符
      if (i === last) newText += t.slice(Math.max(end - s, 0));
      const openTag = xml.slice(seg.openTagStart, seg.openTagEnd);
      xml =
        xml.slice(0, seg.openTagStart) + openTag + newText + '</w:t>' + xml.slice(seg.closeEnd);
    }
  }
  return xml;
}

function convertDocument(xml: string): { xml: string; log: string[] } {
  const parts: string[] = [];
  const log: string[] = [];
  const paraRe = /<w:p[\s\S]*?<\/w:p>/g;
  let cursor = 0;
  let m: RegExpExecArray | null;
  let headerText = '';
  let lastPlaceLabelAt = -1;
  let paraIndex = 0;
  let openedCount = 0;
  let contactCount = 0;
  let supervisionCount = 0;
  // 监督块区间：监督部门/监督举报/纪检监察 行起 +4 段（块内标签行不携带「监督」字样
  // 的只有「地 址：」一行，且 {{占位符}} 已从上下文剔除——必须靠邻段区间识别）
  let supervisionZoneUntil = -1;

  while ((m = paraRe.exec(xml)) !== null) {
    parts.push(xml.slice(cursor, m.index));
    cursor = m.index + m[0].length;
    const para = m[0];
    const ctx = contextText(para);
    const joined = joinedText(para);

    if (HEADER_RE.test(ctx)) {
      headerText = ctx;
      supervisionZoneUntil = -1; // 新节开始，监督区间失效
    }
    if (PLACE_LABEL_RE.test(ctx)) lastPlaceLabelAt = paraIndex;
    if (/(监督|纪检)/.test(ctx)) {
      supervisionZoneUntil = paraIndex + 4;
    }

    const hasRaw = PLACE_REGEX.test(joined) || TIANFU_REGEX.test(joined);
    PLACE_REGEX.lastIndex = 0;
    TIANFU_REGEX.lastIndex = 0;
    const hasPh = SUPERVISION_PLACEHOLDER.test(joined)
      || /\{\{(联系人地址|开标地点)\}\}/.test(joined);
    // 监督区间内的监督人/监督电话 raw 串（一期漏转的第二监督块）
    const inSupervisionZone = paraIndex <= supervisionZoneUntil || /(监督|纪检)/.test(ctx);
    const hasSupervisionRaw = inSupervisionZone && /王先生|81753276/.test(joined);

    if (hasRaw || hasPh || hasSupervisionRaw) {
      let target: '开标地点' | '联系人地址' | '监督地址';
      if (paraIndex <= supervisionZoneUntil || ctx.includes('监督')) {
        target = '监督地址'; // 监督举报块（含自愈：上一轮误转的占位符指回监督地址）
      } else if (headerText.includes('获取')) {
        target = '联系人地址'; // 文件获取地点 = 采购人地址语义
      } else if (
        PLACE_LABEL_RE.test(ctx) ||
        headerText.includes('开标') ||
        (lastPlaceLabelAt >= 0 && paraIndex - lastPlaceLabelAt <= 3)
      ) {
        target = '开标地点';
      } else {
        target = '联系人地址';
      }

      {
        const token = `{{${target}}}`;
        let next = replaceAcrossRunsRegex(
          replaceAcrossRunsRegex(
            replaceAcrossRunsRegex(
              replaceAcrossRunsRegex(para, /\{\{联系人地址\}\}/g, token),
              SUPERVISION_PLACEHOLDER,
              token,
            ),
            PLACE_REGEX,
            token,
          ),
          TIANFU_REGEX,
          token,
        );
        if (target === '监督地址') {
          // 监督区间内的联系人/电话 raw 串一并占位符化（一期漏转块）
          next = replaceAcrossRunsRegex(next, /王先生、徐先生/g, '{{监督人}}');
          next = replaceAcrossRunsRegex(next, /王先生/g, '{{监督人}}');
          next = replaceAcrossRunsRegex(next, /028-81753276/g, '{{监督电话}}');
        }
        if (next !== para) {
          if (target === '开标地点') openedCount += 1;
          else if (target === '联系人地址') contactCount += 1;
          else supervisionCount += 1;
          parts.push(next);
          paraIndex += 1;
          continue;
        }
        log.push(`  ! 判定为${target}但未命中替换（跨段？）：${ctx.slice(0, 40)}`);
      }
      parts.push(para);
      paraIndex += 1;
      continue;
    }

    parts.push(para);
    paraIndex += 1;
  }
  parts.push(xml.slice(cursor));
  log.push(
    `  ✓ 开标地点段 ×${openedCount}，联系人地址段 ×${contactCount}，监督地址段 ×${supervisionCount}`,
  );
  return { xml: parts.join(''), log };
}

function verify(xml: string): string[] {
  const out: string[] = [];
  const paraRe = /<w:p[\s\S]*?<\/w:p>/g;
  let dirty = 0;
  let m: RegExpExecArray | null;
  let opened = 0;
  let contact = 0;
  let supervision = 0;
  let zoneUntil = -1;
  let paraIndex = 0;
  while ((m = paraRe.exec(xml)) !== null) {
    const joined = joinedText(m[0]);
    const ctx = contextText(m[0]);
    if (HEADER_RE.test(ctx)) zoneUntil = -1;
    if (/(监督|纪检)/.test(ctx)) zoneUntil = paraIndex + 4;
    if ((joined.match(/\{\{开标地点\}\}/g) || []).length) opened += 1;
    if ((joined.match(/\{\{联系人地址\}\}/g) || []).length) contact += 1;
    if ((joined.match(/\{\{监督地址\}\}/g) || []).length) supervision += 1;
    const inZone = paraIndex <= zoneUntil;
    if (!inZone) {
      const re1 = new RegExp(PLACE_REGEX.source);
      const re2 = new RegExp(TIANFU_REGEX.source);
      if (re1.test(joined) || re2.test(joined)) dirty += 1;
    } else {
      // 监督区间内：raw 地址/监督人/电话 也不允许残留
      const re1 = new RegExp(PLACE_REGEX.source);
      const re2 = new RegExp(TIANFU_REGEX.source);
      if (re1.test(joined) || re2.test(joined) || /王先生|81753276/.test(joined)) dirty += 1;
    }
    paraIndex += 1;
  }
  if (dirty > 0) out.push(`✗ 残留未转换地址段 ×${dirty}（非监督上下文）`);
  const residue = (xml.replace(/<[^>]*>/g, '').match(
    /\{\{(?:开标地点|联系人地址|监督地址)\}\}\s*(?:四川省水利发展集团有限公司\s*|四川水发集团\s*)?B\s*[座栋]/g,
  ) || []).length;
  if (residue > 0) out.push(`✗ 占位符后残段 ×${residue}`);
  out.push(`占位符：开标地点×${opened} 联系人地址×${contact} 监督地址×${supervision}`);
  return out;
}

async function main() {
  const dir = path.resolve(__dirname, '..', '模板文件');
  for (const f of FILES) {
    console.log(`== ${f}`);
    const filePath = path.join(dir, f);
    const zip = await JSZip.loadAsync(await fs.readFile(filePath));
    const documentFile = zip.file('word/document.xml');
    if (!documentFile) {
      console.log('  ✗ 缺少 word/document.xml，跳过');
      continue;
    }
    const xml = await documentFile.async('string');
    const { xml: converted, log } = convertDocument(xml);
    const next = stripResidue(converted);
    log.forEach((l) => console.log(l));
    if (next !== xml) {
      zip.file('word/document.xml', next);
      await fs.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }));
    }
    const reread = await JSZip.loadAsync(await fs.readFile(filePath));
    const finalXml = await reread.file('word/document.xml')!.async('string');
    verify(finalXml).forEach((l) => console.log(`  ${l}`));
  }
  console.log('\n完成。');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
