# 询比采购文件模板 v2（综合评分法 + 评分标准填写）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 询比采购文件编写对齐新版模板——UI 重构为竞价同款 6 节、评审方法固定综合评分法、新增评分标准结构化填写（含 AI 生成）并注入 docx「六、综合评分法评审标准」表；同时修正模板 4 处竞价残留固定文案。

**Architecture:** 前端 ：3005 `/tender-write`（含项目管理内嵌 `tender-write-modal`）复用既有 section-config 驱动架构；后端 `apps/api/src/tender-write` 沿用「占位符替换计划 + renderTemplateXml」体系，评分表走新 `scoringRows` 分支（克隆模板空行注入，保模板列宽/边框/字体）。模板 docx 修正用 Python 跨 run 文本手术（占位符集合不变）。

**Tech Stack:** Next.js 16 + React 19（web）；NestJS 11 + JSZip（api）；python3（docx 手术脚本，跑在 /tmp 不入库）。

**Spec:** `docs/superpowers/specs/2026-10-29-inquiry-purchase-template-v2-design.md`

## Global Constraints

- 工作区可能有并行会话（`apps/web/src/lib/notice/schedule.ts` 有他人未提交改动）：**禁用 `git add -A`/`git add .`**，只 add 本计划列出的文件；每任务一提交。
- 界面文案禁英文/黑话；模板表格五列列名固定：序号/评分因素/分值/评分标准/说明。
- 评标方法**固定综合评分法**——UI 无选择器；「评审」（询比）与「评标」（竞价）措辞按各自模板，勿混。
- 导出闸门只在 INQUIRY_PURCHASE 生效；后端空 rows 时表格原样（宽容）。
- API 测试命令：`pnpm --filter api test -- tender-write`；web 校验：`pnpm --filter web exec tsc --noEmit` + `pnpm --filter web lint`。
- docx 模板占位符集合（修正前后必须一致，52 个见 Task 1 验证）。

---

### Task 1: 模板 docx 固定文案修正（4 处竞价残留）

**Files:**
- Modify: `apps/api/模板文件/询比采购文件模板.docx`（用户已替换的新版，工作区未提交）
- Create: `/tmp/fix_xunbi_tpl.py`（一次性脚本，不入库）

**Interfaces:**
- Produces: 修正后的 docx；占位符集合与修正前逐一致；全文无「竞价/最低价/二次报价/业绩数量」字样。

- [x] **Step 1: 写跨 run 文本替换脚本**

```python
"""fix_xunbi_tpl.py — 询比模板固定文案修正（跨 run 安全）。
用法: python3 -I /tmp/fix_xunbi_tpl.py <docx路径>
替换表（old → new），每处只动覆盖目标串的最小 run 区间，未覆盖 run 原样保留。"""
import sys, shutil, zipfile, re
import xml.etree.ElementTree as ET

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
REPLACEMENTS = [
    # 1. 采购邀请首段：竞价方式 → 询比方式
    ('采用竞价方式进行采购', '采用询比方式进行采购'),
    # 2. 前附表 16.1 确定成交人：最低价法残留 → 综合评分法口径（与 8.2 对齐）
    ('成交候选人并列的，按照以下方式确定成交供应商： 最低价中标；如果两家供应商报价相同且为最低价，则业绩数量丰富者中标；若业绩数量亦相同的，则由价格和业绩相同的供应商启动二次报价，但其第二次报价不得高于第一次报价。',
     '成交候选人并列的，按照以下方式确定成交供应商：按评审得分由高到低顺序确定；得分相同的，按报价由低到高顺序确定；得分且报价相同的，由询比小组推荐成交候选人。'),
    # 3. 18.1.1：竞价采购方式 → 询比采购方式
    ('不再符合规定的竞价采购方式适用情形的', '不再符合规定的询比采购方式适用情形的'),
    # 4. 第五章 响应保证金保函格式
    ('（项目名称）竞价采购', '（项目名称）询比采购'),
    ('不按照内部竞标（竞价）采购文件要求', '不按照询比采购文件要求'),
    ('或者发生内部竞标（竞价）采购文件明确规定', '或者发生询比采购文件明确规定'),
]
```

脚本主体：ET 解析 `word/document.xml`；对每个 `w:p`（含表格单元格内段落）把 runs 的 `w:t` 文本拼成全串并记录每个字符→(run,t) 映射；查找 REPLACEMENTS 目标串；命中则把替换结果写入首个覆盖 run 的 `w:t`，其余覆盖 run 的重叠字符删除、非重叠前后缀保留各自 run；替换后若某 `w:t` 变空串保留空节点（保 XML 结构）。所有目标替换完成后序列化回 zip（其余 entry 原样字节复制，`zipfile.ZIP_DEFLATED`）。

注意：docx 中文本按 run 拆分（个别段逐字一 run），脚本必须按「拼接全文定位，最小 run 区间回写」，禁止直接 `xml.replace(原文串)`（拼接串在 raw XML 中不存在）。

- [x] **Step 2: 记录修正前占位符基线**

```bash
cd /tmp && grep -o "{{[^}]*}}" xunbi_tpl_content.txt | sort | md5
```
（xunbi_tpl_content.txt 为修正前提取文本；52 个占位符。）

- [x] **Step 3: 执行脚本 + 验证**

```bash
python3 -I /tmp/fix_xunbi_tpl.py "apps/api/模板文件/询比采购文件模板.docx"
# 重新解包提取，三重验证：
#  1) grep -c "竞价\|最低价\|二次报价\|业绩数量" → 0
#  2) 占位符集合与 Step2 基线一致（md5 相同）
#  3) python3 -c "import zipfile; zipfile.ZipFile('<docx>').testzip()" → None（zip 完整）
```

- [x] **Step 4: 用 Node 侧 JSZip 再开一次（与 api 运行时同源验证）**

```bash
cd apps/api && node -e "const J=require('jszip'),fs=require('fs');J.loadAsync(fs.readFileSync('模板文件/询比采购文件模板.docx')).then(z=>z.file('word/document.xml').async('string')).then(x=>{console.log('len',x.length);console.log('竞价残留',x.includes('竞价'))})"
```
Expected: `竞价残留 false`

- [x] **Step 5: Commit**

```bash
git add "apps/api/模板文件/询比采购文件模板.docx"
git commit -m "fix(templates): 询比采购文件模板 v2 入库+竞价残留文案修正（16.1 对齐综合评分法）"
```

---

### Task 2: API——类型重写 + 替换计划重写 + 评分表注入（TDD）

**Files:**
- Modify: `apps/api/src/tender-write/tender-write.types.ts`（InquiryPurchaseAnswers 重写 + ScoringItem）
- Modify: `apps/api/src/tender-write/tender-write.template.ts`（plan 重写、TemplateReplacement.scoringRows、renderTemplateXml 分支、fillScoringStandardTable）
- Test: `apps/api/src/tender-write/inquiry-scoring-template.spec.ts`（新建）

**Interfaces:**
- Produces（后续任务依赖的精确签名）:
  - `export type ScoringItem = { id: string; factor: string; score: string; criteria: string; note: string };`（types）
  - `InquiryPurchaseAnswers`：字段集 = `InternalBiddingAnswers` 去掉 `evaluationMethod`/`evaluationCommitteeCount`，加 `scoringItems?: ScoringItem[]`（其余含 quotationLetterTable）
  - `TemplateReplacement` 增 `scoringRows?: Array<{ factor: string; score: string; criteria: string; note: string }>;`
  - `renderTemplateXml` 分支：`replacement.scoringRows?.length` → `fillScoringStandardTable(xml, rows)`

- [x] **Step 1: 写失败测试**

```ts
// apps/api/src/tender-write/inquiry-scoring-template.spec.ts
import { readFileSync } from 'fs';
import * as path from 'path';
import * as JSZip from 'jszip';
import {
  buildInquiryPurchaseReplacementPlan,
  buildTenantPlaceholderReplacements,
  renderTemplateXml,
  INQUIRY_PURCHASE_TEMPLATE_FILE,
} from './tender-write.template';
import type { InquiryPurchaseAnswers, ScoringItem } from './tender-write.types';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

async function loadTemplateXml(): Promise<string> {
  const buf = readFileSync(path.resolve(PROJECT_ROOT, INQUIRY_PURCHASE_TEMPLATE_FILE));
  const zip = await JSZip.loadAsync(buf);
  return zip.file('word/document.xml').async('string') as Promise<string>;
}

/** 剥标签取全文后提取 {{...}}（占位符经 mergeSplitPlaceholders 后均单 run，剥标签足够） */
function extractPlaceholders(xml: string): string[] {
  const text = xml.replace(/<[^>]+>/g, '');
  return [...text.matchAll(/\{\{[^}]{1,60}\}\}/g)].map((m) => m[0]);
}

/** 定位「六、综合评分法评审标准」标题后的评分表 XML 段 */
function scoringTableRegion(xml: string): string | null {
  const pRe = /<w:p\b[\s\S]*?<\/w:p>/g;
  let m: RegExpExecArray | null;
  let headingEnd = -1;
  while ((m = pRe.exec(xml)) !== null) {
    const plain = [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((x) => x[1]).join('');
    if (/六、\s*综合评分法评审标准/.test(plain)) { headingEnd = m.index + m[0].length; break; }
  }
  if (headingEnd < 0) return null;
  const tblStart = xml.indexOf('<w:tbl', headingEnd);
  const tblEnd = xml.indexOf('</w:tbl>', tblStart);
  if (tblStart < 0 || tblEnd < 0) return null;
  return xml.substring(tblStart, tblEnd);
}

function fixture(overrides: Partial<InquiryPurchaseAnswers> = {}): InquiryPurchaseAnswers {
  return {
    projectName: '测试询比项目', coverDate: '2026-10',
    projectOverview: '概况内容', procurementContent: '采购内容', maxPrice: '350000',
    submissionRequirements: '成果要求', submissionRequirementsType: 'have',
    qualificationRequirements: '特定资质要求内容',
    consortiumForm: '联合体要求', consortiumFormType: 'reject',
    documentAcquireTime: '2026年11月2日09:00至2026年11月5日15:00', documentPrice: '0',
    responseSubmissionTime: '2026年11月10日14:00', bidOpeningPlace: '开标室',
    contactAddress: '成都市', contactName: '张三', contactPhone: '13800000000', contactEmail: 'a@b.c',
    supervisionDepartment: '纪检监察部', supervisionAddress: '监督地址', supervisionContact: '李四', supervisionPhone: '028-12345678',
    responseDepositType: 'none', responseDepositAmount: '', responseDepositForm: '', responseDepositBankInfo: '',
    responseDepositOtherForm: '', responseDepositOtherRequirement: '/', responseDepositNonRefundType: 'none', responseDepositNonRefundContent: '',
    performanceDepositType: 'collect', performanceDepositAmount: '50000', performanceDepositForm: 'bank_guarantee', performanceDepositOtherForm: '',
    contractSubcontracting: '', contractSubcontractingType: 'none', siteSurvey: '/', copyCount: '4',
    businessRequirements: '商务要求', technicalRequirements: '技术要求',
    quotationLetterType: 'table', quotationLetter: '', scoringItems: [],
    ...overrides,
  } as InquiryPurchaseAnswers;
}

const tenantPlan = buildTenantPlaceholderReplacements('四川水发建设有限公司', {
  department: '纪检监察部', address: '监督地址', contact: '李四', phone: '028-12345678',
});

const items: ScoringItem[] = [
  { id: 'a', factor: '价格部分', score: '30', criteria: '报价得分=（评审基准价/评审报价）×30\n四舍五入保留两位小数', note: '/' },
  { id: 'b', factor: '技术部分', score: '40', criteria: '技术参数完全响应得满分\n一般偏离一项扣2分', note: '/' },
  { id: 'c', factor: '商务部分', score: '30', criteria: '业绩每一项得5分', note: '以合同复印件为准' },
];

describe('询比采购文件模板 v2', () => {
  it('占位符全覆盖：替换计划+租户替换后零残留', async () => {
    const xml = await loadTemplateXml();
    const rendered = renderTemplateXml(xml, [
      ...buildInquiryPurchaseReplacementPlan(fixture()),
      ...tenantPlan,
    ]);
    expect(extractPlaceholders(rendered)).toEqual([]);
  });

  it('注入评分行：3 行数据+合计 100，空模板行被替换', async () => {
    const xml = await loadTemplateXml();
    const rendered = renderTemplateXml(xml, [
      ...buildInquiryPurchaseReplacementPlan(fixture({ scoringItems: items })),
      ...tenantPlan,
    ]);
    const region = scoringTableRegion(rendered);
    expect(region).toBeTruthy();
    const trCount = (region.match(/<w:tr[ >]/g) ?? []).length;
    expect(trCount).toBe(5); // 表头 + 3 数据行 + 合计
    const text = region.replace(/<[^>]+>/g, '');
    for (const expectd of ['1', '价格部分', '30', '技术部分', '40', '商务部分', '评审基准价', '合计', '100']) {
      expect(text).toContain(expectd);
    }
  });

  it('空评分行不注入：表格结构原样（宽容兜底）', async () => {
    const xml = await loadTemplateXml();
    const rendered = renderTemplateXml(xml, [
      ...buildInquiryPurchaseReplacementPlan(fixture({ scoringItems: [] })),
      ...tenantPlan,
    ]);
    const region = scoringTableRegion(rendered);
    const trCount = (region.match(/<w:tr[ >]/g) ?? []).length;
    expect(trCount).toBe(5); // 模板原样：表头+3空行+合计
    expect(region.replace(/<[^>]+>/g, '')).not.toContain('价格部分');
  });
});
```

- [x] **Step 2: 跑测试确认失败**

```bash
pnpm --filter api test -- inquiry-scoring-template
```
Expected: FAIL（旧 plan 缺新占位符替换 + 无 scoringRows；第一个用例占位符残留、后两个 undefined）

- [x] **Step 3: 重写 types（tender-write.types.ts）**

```ts
export type ScoringItem = {
  id: string;
  factor: string;   // 评分因素
  score: string;    // 分值
  criteria: string; // 评分标准
  note: string;     // 说明
};

export type InquiryPurchaseAnswers = {
  projectName: string;
  coverDate: string;
  projectOverview: string;
  procurementContent: string;
  maxPrice: string;
  submissionRequirements: string;
  submissionRequirementsType: string;
  qualificationRequirements: string;
  consortiumForm: string;
  consortiumFormType: string;
  documentAcquireTime: string;
  documentPrice: string;
  responseSubmissionTime: string;
  bidOpeningPlace?: string;
  contactAddress?: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  supervisionDepartment?: string;
  supervisionAddress?: string;
  supervisionContact?: string;
  supervisionPhone?: string;
  responseDepositType: string;
  responseDepositAmount: string;
  responseDepositForm: string;
  responseDepositBankInfo: string;
  responseDepositOtherForm: string;
  responseDepositOtherRequirement: string;
  responseDepositNonRefundType: string;
  responseDepositNonRefundContent: string;
  performanceDepositType: string;
  performanceDepositAmount: string;
  performanceDepositForm: string;
  performanceDepositOtherForm: string;
  contractSubcontracting: string;
  contractSubcontractingType: string;
  siteSurvey: string;
  siteSurveyType: string;
  copyCount: string;
  businessRequirements: string;
  technicalRequirements: string;
  quotationLetterType: 'text' | 'table';
  quotationLetter: string;
  quotationLetterTable?: TableData;
  scoringItems?: ScoringItem[];
};
```
（监督四字段在 web Draft 必填、API 侧 tenantPlan 消费，类型可选用 `?` 与 InternalBiddingAnswers 对齐方式照抄——以 InternalBiddingAnswers 实际声明为准：无 `?` 则同款无 `?`。）

- [x] **Step 4: 重写 buildInquiryPurchaseReplacementPlan（tender-write.template.ts 856-949 整函数替换）**

结构 = `buildInternalBiddingReplacementPlan`（951-1275）整体照搬，做如下删改：
- 删：`evalMethod1/evalMethod2`（1068-1070）、`{ targetText: '评标方法1'... }` `{ targetText: '评标方法2'... }`（1235-1236）、`{ targetText: '评标委员会人数'... }`（1237-1240）、`{ targetText: '综合评分法评标标准'... shouldDeleteComprehensiveScoringTable }`（1264-1270）
- 增（放在 businessRequirementsReplacement 前）：

```ts
  // 综合评分法评审标准（固定评审方法）：评分行注入 docx「六、综合评分法评审标准」表
  const scoringRows = (answers.scoringItems ?? [])
    .filter((it) => it.factor.trim() || it.criteria.trim())
    .map((it) => ({
      factor: it.factor.trim(),
      score: it.score.trim(),
      criteria: it.criteria.trim(),
      note: it.note.trim(),
    }));
  const scoringReplacement: TemplateReplacement = scoringRows.length
    ? { targetText: '综合评分法评审标准', replacementText: '', highlight: false, scoringRows }
    : { targetText: '综合评分法评审标准', replacementText: '', highlight: false };
```
并在返回数组中加入 `scoringReplacement,`。
- 其余逐字段照搬（含 deposit1-15/perf1-9/合同分包/联合体/踏勘/副本份数/报价表/quotation 全套逻辑与 `applyTimeFallbacks`），answers 字段名同 InternalBiddingAnswers。

- [x] **Step 5: TemplateReplacement + renderTemplateXml 分支 + fillScoringStandardTable**

`TemplateReplacement`（509 行附近）加：
```ts
  scoringRows?: Array<{ factor: string; score: string; criteria: string; note: string }>; // 评分标准表注入（询比固定综合评分法）
```

`renderTemplateXml`（1619 reduce 起始处）加分支（放 `shouldDeleteComprehensiveScoringTable` 之前）：
```ts
    if (replacement.scoringRows && replacement.scoringRows.length > 0) {
      return fillScoringStandardTable(result, replacement.scoringRows);
    }
```

新增函数（放 `deleteComprehensiveScoringTable` 旁；段落扫描手法与其一致）：

```ts
const SCORING_ROW_RPR =
  '<w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:color w:val="000000" w:themeColor="text1"/></w:rPr>';

function scoringRunXml(text: string): string {
  if (!text) return '';
  const segments = text.split('\n').map((s) => s.trimEnd());
  const body = segments.map((seg) => `<w:t xml:space="preserve">${escapeXml(seg)}</w:t>`).join('<w:br/>');
  return `<w:r>${SCORING_ROW_RPR}${body}</w:r>`;
}

/**
 * 向行 XML 的第 i 个段落 </w:p> 前插入文本 run。
 * cells[i] 为 null 表示跳过该段落（合计行首格已有「合计」run 时用）；空串=不插 run。
 */
function injectRunsIntoRow(rowXml: string, cells: Array<string | null>): string {
  let out = rowXml;
  let searchFrom = 0;
  for (const cell of cells) {
    const pEnd = out.indexOf('</w:p>', searchFrom);
    if (pEnd === -1) break;
    if (cell === null) {
      searchFrom = pEnd + 6;
      continue;
    }
    const run = scoringRunXml(cell);
    out = out.substring(0, pEnd) + run + out.substring(pEnd);
    searchFrom = pEnd + run.length + 6;
  }
  return out;
}

/**
 * 填充「六、综合评分法评审标准」表：克隆模板空行生成数据行（保列宽 841/1460/912/3973/1228、
 * 边框、字体），合计行分值格写合计。空 rows 由调用方拦截（不注入）。
 */
function fillScoringStandardTable(
  xml: string,
  rows: Array<{ factor: string; score: string; criteria: string; note: string }>,
): string {
  // 1. 跨 run 定位标题段（「六、」与正文常分属不同 run，raw grep 不可靠）
  const pStarts: number[] = [];
  const psRe = /<w:p\b/g;
  let pm: RegExpExecArray | null;
  while ((pm = psRe.exec(xml)) !== null) pStarts.push(pm.index);
  let headingEnd = -1;
  for (let i = 0; i < pStarts.length; i++) {
    const pEnd = xml.indexOf('</w:p>', pStarts[i]);
    if (pEnd === -1) break;
    const plain = [...xml.substring(pStarts[i], pEnd + 6).matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
      .map((x) => x[1]).join('');
    if (/六、\s*综合评分法评[审标]标准/.test(plain)) { headingEnd = pEnd + 6; break; }
  }
  if (headingEnd < 0) return xml;

  // 2. 标题后、第四章前的评分表
  const tableStart = xml.indexOf('<w:tbl', headingEnd);
  const ch4 = xml.indexOf('第四章', headingEnd);
  if (tableStart === -1 || (ch4 !== -1 && ch4 < tableStart)) return xml;
  const tableEnd = xml.indexOf('</w:tbl>', tableStart);
  if (tableEnd === -1) return xml;
  const tbl = xml.substring(tableStart, tableEnd + 8);

  // 3. 行拆分：首行=表头；含「合计」行=末行；中间空文本、无 gridSpan 的 5 格行=空行样板
  const rowRe = /<w:tr[ >][\s\S]*?<\/w:tr>/g;
  const rowMatches = [...tbl.matchAll(rowRe)];
  if (rowMatches.length < 3) return xml;
  const rowXmls = rowMatches.map((m) => m[0]);
  const plainOf = (r: string) => [...r.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((x) => x[1]).join('');
  const totalIdx = rowXmls.findIndex((r) => plainOf(r).includes('合计'));
  if (totalIdx !== rowXmls.length - 1) return xml; // 合计行必须是末行
  let templateIdx = -1;
  for (let i = 1; i < rowXmls.length - 1; i++) {
    if (!plainOf(rowXmls[i]).trim() && (rowXmls[i].match(/<w:tc>/g) ?? []).length === 5) {
      templateIdx = i; break;
    }
  }
  if (templateIdx === -1) return xml;

  // 4. 生成数据行 + 合计
  const dataRows = rows.map((r, i) =>
    injectRunsIntoRow(rowXmls[templateIdx], [String(i + 1), r.factor, r.score, r.criteria, r.note]),
  );
  const sum = rows.reduce((acc, r) => {
    const n = parseFloat(r.score);
    return Number.isNaN(n) ? acc : acc + n;
  }, 0);
  const hasSum = rows.some((r) => !Number.isNaN(parseFloat(r.score)));
  const sumText = hasSum ? (Number.isInteger(sum) ? String(sum) : String(Math.round(sum * 100) / 100)) : '';
  const totalRow = sumText ? injectRunsIntoRow(rowXmls[totalIdx], [null, sumText, null]) : rowXmls[totalIdx];

  // 5. 重组：tblPr/tblGrid + 表头 + 数据行 + 合计（丢掉全部模板空行）
  const prefix = tbl.substring(0, rowMatches[0].index);
  const suffix = tbl.substring(rowMatches[rowMatches.length - 1].index + rowMatches[rowMatches.length - 1][0].length);
  const newTbl = prefix + rowXmls[0] + dataRows.join('') + totalRow + suffix;
  return xml.substring(0, tableStart) + newTbl + xml.substring(tableEnd + 8);
}
```

- [x] **Step 6: 跑测试至全绿**

```bash
pnpm --filter api test -- inquiry-scoring-template
pnpm --filter api test -- tender-write
```
Expected: 新 spec 3 用例 PASS；既有 tender-write 套件不红（若 service.spec 引用旧 InquiryPurchaseAnswers 字段则同步修正 fixture）。

- [x] **Step 7: lint + commit**

```bash
pnpm --filter api lint
git add apps/api/src/tender-write/tender-write.types.ts apps/api/src/tender-write/tender-write.template.ts apps/api/src/tender-write/inquiry-scoring-template.spec.ts
git commit -m "feat(api): 询比替换计划对齐新模板+综合评分法评审标准表注入（scoringRows）"
```

---

### Task 3: Web——类型与 sections 重构 + 联动小改

**Files:**
- Modify: `apps/web/src/lib/types/tender-write.ts`
- Modify: `apps/web/src/lib/tender-write/templates.ts`（INQUIRY_PURCHASE_SECTIONS、createEmptyInquiryPurchaseDraft）
- Modify: `apps/web/src/lib/tender-write/prefill-from-project.ts`
- Modify: `apps/web/src/lib/tender-write/progress.ts`
- Modify: `apps/web/src/components/projects/tender-write-modal.tsx`（TENDER_OPENING_KEY 一行）

**Interfaces:**
- Consumes: 无（纯前端态）
- Produces（Task 4/5 依赖）:
  - `ScoringItem` 类型（web 侧同构：`{ id, factor, score, criteria, note }`）
  - `InquiryPurchaseFieldKey`（新键集）、`InquiryPurchaseDraft = Record<InquiryPurchaseFieldKey, string> & { quotationLetterTable?: TableData; scoringItems?: ScoringItem[] }`
  - `TenderFieldKey` 增加 `'scoringItems'`；`TenderFieldConfig` 增加 `scoring?: boolean`
  - `INQUIRY_PURCHASE_SECTIONS`（6 节，第④节含 scoring 字段配置 + aiPrompt）
  - `createEmptyInquiryPurchaseDraft()`

- [x] **Step 1: types/tender-write.ts**

```ts
export type InquiryPurchaseSectionKey =
  | "cover" | "invitation" | "supplier" | "evaluation" | "requirements" | "quotation";

export type ScoringItem = {
  id: string;
  factor: string;
  score: string;
  criteria: string;
  note: string;
};

export type InquiryPurchaseFieldKey =
  | "projectName" | "coverDate" | "projectOverview" | "procurementContent" | "maxPrice"
  | "submissionRequirements" | "submissionRequirementsType" | "qualificationRequirements"
  | "consortiumForm" | "consortiumFormType" | "documentAcquireTime" | "documentPrice"
  | "responseSubmissionTime" | "bidOpeningPlace" | "contactAddress" | "contactName"
  | "contactPhone" | "contactEmail"
  | "supervisionDepartment" | "supervisionAddress" | "supervisionContact" | "supervisionPhone"
  | "responseDepositType" | "responseDepositAmount" | "responseDepositForm" | "responseDepositBankInfo"
  | "responseDepositOtherForm" | "responseDepositOtherRequirement" | "responseDepositNonRefundType"
  | "responseDepositNonRefundContent"
  | "performanceDepositType" | "performanceDepositAmount" | "performanceDepositForm" | "performanceDepositOtherForm"
  | "contractSubcontracting" | "contractSubcontractingType" | "siteSurvey" | "siteSurveyType"
  | "copyCount" | "businessRequirements" | "technicalRequirements"
  | "quotationLetter" | "quotationLetterType";

// TenderFieldKey 联合末尾追加：
export type TenderFieldKey =
  | CompetitiveNegotiationFieldKey | SingleSourceFieldKey | InquiryPurchaseFieldKey
  | InternalBiddingFieldKey | InvitedBiddingFieldKey | "scoringItems";

export type InquiryPurchaseDraft = Record<InquiryPurchaseFieldKey, string> & {
  quotationLetterTable?: TableData;
  scoringItems?: ScoringItem[];
};

// TenderFieldConfig 增：
  scoring?: boolean; // 综合评分法评审标准（询比专用结构化评分行编辑器）
```

- [x] **Step 2: templates.ts——INQUIRY_PURCHASE_SECTIONS 全量替换（391-480 行）+ createEmptyInquiryPurchaseDraft（482-500 行）**

6 节克隆 `INTERNAL_BIDDING_SECTIONS`（512-818 行），差异：
- `cover` 同款。
- `invitation` 同款（含 `...SUPERVISION_TENDER_FIELDS`、提交成果要求/特定资质要求/联合体/文件获取时间/售价/开标时间/开标地点/联系人×4）。
- `supplier` 同款（响应/履约保证金全套、合同分包、踏勘、副本份数），**删「评标委员会人数」字段**（新模板固定 3 人以上单数）。
- `evaluation` 替换为：

```ts
  {
    key: "evaluation",
    title: "评审程序和评定成交的标准",
    description: "评审方法固定为综合评分法，填写评审标准表。",
    fields: [
      {
        key: "scoringItems",
        label: "综合评分法评审标准",
        placeholder: "",
        scoring: true,
        aiPrompt:
          "生成询比采购综合评分法评审标准表。要求：产出4-6行评分因素，覆盖价格、技术、商务或业绩维度，各行分值合计必须等于100。每行用制表符（Tab键）分隔四列，列序为：评分因素、分值、评分标准、说明。评分标准必须写明具体打分规则与计算公式（如：报价得分=（评审基准价/评审报价）×30，四舍五入保留两位小数；技术参数完全响应得满分，一般偏离一项扣2分），分值为阿拉伯数字，说明写评审依据或证明材料要求，无内容写「/」。不要表头行，不要序号列，不要使用#、*等符号，不要空行，只输出数据行。",
      },
    ],
  },
```
- `requirements`（采购需求）与 `quotation`（响应文件格式，label 报价表）同款。

`createEmptyInquiryPurchaseDraft` 新键集默认值（对齐 `createEmptyInternalBiddingDraft` 820-869，去掉 evaluationMethod/evaluationCommitteeCount，documentPrice 默认 "0"，responseDepositOtherRequirement 默认 "/"，quotationLetterType "table"）。

- [x] **Step 3: prefill-from-project.ts**

- `case 'INQUIRY_PURCHASE'`（66-73 行）改为（对齐 INTERNAL_BIDDING 分支）：

```ts
    case 'INQUIRY_PURCHASE': {
      const draft = createEmptyInquiryPurchaseDraft();
      return {
        ...draft,
        projectName: project.title || draft.projectName,
        maxPrice: budgetStr,
        qualificationRequirements: project.supplierRequirements || '',
        contactName: project.requesterName || draft.contactName,
      };
    }
```
- 同文件下方 `case 'INQUIRY_PURCHASE'` withPrompts 字段清单（约 87-99 行）替换为 INTERNAL_BIDDING 清单去掉 `evaluationMethod`/`evaluationCommitteeCount` 后的同款（projectOverview/submissionRequirements/consortiumForm/documentAcquireTime/documentPrice/responseSubmissionTime/contact×2/quotationLetter）。

- [x] **Step 4: progress.ts——scoring 分支**

在保证金两分支之后、select 分支之前加：

```ts
      // 综合评分法评审标准：任一行评分因素或评分标准非空即视为已填写
      if (field.scoring) {
        const items = (draft as { scoringItems?: ScoringItem[] }).scoringItems;
        return !!items?.some((it) => it.factor.trim() || it.criteria.trim());
      }
```
（顶部 import 增加 `ScoringItem`。）

- [x] **Step 5: tender-write-modal.tsx 一行**

`TENDER_OPENING_KEY.INQUIRY_PURCHASE: 'bidOpeningTime'` → `'responseSubmissionTime'`。

- [x] **Step 6: tsc + lint + commit**

```bash
pnpm --filter web exec tsc --noEmit   # 预期：旧 InquiryPurchasePreview 引用旧键报错——Task 5 修；此步允许仅 preview 相关红
pnpm --filter web lint
git add apps/web/src/lib/types/tender-write.ts apps/web/src/lib/tender-write/templates.ts apps/web/src/lib/tender-write/prefill-from-project.ts apps/web/src/lib/tender-write/progress.ts apps/web/src/components/projects/tender-write-modal.tsx
git commit -m "feat(web): 询比编写重构为六章制类型与配置（评审方法固定综合评分法+评分标准字段）"
```
注：若 preview 红导致 tsc 不过，把 preview 一并最小改（字段名替换）或在同提交内完成 Task 5 Step1 的组件骨架——以 tsc 绿为准入。

---

### Task 4: 评分标准编辑器 + 接线 + AI 生成

**Files:**
- Create: `apps/web/src/components/tender-write/scoring-items-editor.tsx`
- Modify: `apps/web/src/components/tender-write/tender-section-editor.tsx`
- Modify: `apps/web/src/components/tender-write/tender-write-workspace.tsx`
- Modify: `apps/web/src/components/tender-write/tender-questionnaire.tsx`
- Modify: `apps/web/src/app/(main)/tender-write/page.tsx`
- Modify: `apps/web/src/components/projects/tender-write-modal.tsx`

**Interfaces:**
- Consumes: Task 3 的 `ScoringItem`/`scoring` 配置；`generateFieldContent`（`@/lib/api/tender-sample`）
- Produces:
  - `createEmptyScoringItem(): ScoringItem`
  - `hasValidScoringRows(items?: ScoringItem[] | null): boolean`（导出闸门与进度同口径）
  - `scoringTotal(items?: ScoringItem[] | null): number | null`
  - `parseScoringTextToItems(text: string): ScoringItem[] | null`
  - `<ScoringItemsEditor value onChange onAiGenerate isGenerating aiError />`
  - workspace/questionnaire/section-editor 透传 `onScoringItemsChange?: (items: ScoringItem[] | undefined) => void`

- [x] **Step 1: scoring-items-editor.tsx（新组件，视觉沿用报价表编辑器体系：rounded-[14px]/oklch 边框）**

```tsx
"use client";

import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2 } from "lucide-react";
import type { ScoringItem } from "@/lib/types/tender-write";

export function createEmptyScoringItem(): ScoringItem {
  return { id: Math.random().toString(36).slice(2, 10), factor: "", score: "", criteria: "", note: "" };
}

/** 有效行判定（导出闸门/进度同口径）：评分因素或评分标准非空 */
export function hasValidScoringRows(items?: ScoringItem[] | null): boolean {
  return !!items?.some((it) => it.factor.trim() || it.criteria.trim());
}

/** 分值合计（可解析数字，两位小数；无可解析值返回 null） */
export function scoringTotal(items?: ScoringItem[] | null): number | null {
  if (!items?.length) return null;
  let sum = 0;
  let any = false;
  for (const it of items) {
    const n = parseFloat(it.score);
    if (!Number.isNaN(n)) { sum += n; any = true; }
  }
  return any ? Math.round(sum * 100) / 100 : null;
}

/** AI 生成文本 → 评分行：Tab 优先，逗号/多空格兜底；列序=评分因素/分值/评分标准/说明 */
export function parseScoringTextToItems(text: string): ScoringItem[] | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const items: ScoringItem[] = [];
  for (const line of lines) {
    const parts = line.includes("\t")
      ? line.split("\t")
      : line.includes("，") || line.includes(",")
        ? line.split(/[，,]/)
        : line.split(/\s{2,}/);
    if (!parts[0]?.trim()) continue;
    items.push({
      id: Math.random().toString(36).slice(2, 10),
      factor: (parts[0] ?? "").trim(),
      score: (parts[1] ?? "").replace(/[^0-9.]/g, ""),
      criteria: (parts[2] ?? "").trim(),
      note: (parts[3] ?? "/").trim() || "/",
    });
  }
  return items.length ? items : null;
}

const inputCls =
  "w-full rounded-[10px] border border-[oklch(0.6_0.04_258_/_0.25)] bg-[oklch(1_0_0_/_0.6)] px-2.5 py-1.5 text-sm text-[color:var(--foreground)] outline-none transition-all focus:border-[rgba(107,149,240,0.34)] focus:shadow-[0_0_0_4px_rgba(113,152,242,0.08)]";

export function ScoringItemsEditor({
  value,
  onChange,
  onAiGenerate,
  isGenerating,
  aiError,
}: {
  value: ScoringItem[];
  onChange: (items: ScoringItem[]) => void;
  onAiGenerate?: () => void;
  isGenerating?: boolean;
  aiError?: string | null;
}) {
  const total = scoringTotal(value);
  const totalValid = total !== null && Math.abs(total - 100) < 0.005;

  const update = (id: string, patch: Partial<ScoringItem>) =>
    onChange(value.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between rounded-[14px] border border-[oklch(0.6_0.04_258_/_0.2)] bg-[oklch(1_0_0_/_0.3)] px-3 py-2">
        <span className="text-sm text-[color:var(--muted-foreground)]">
          评审方法：<span className="font-semibold text-[color:var(--foreground)]">综合评分法（固定）</span>
        </span>
        <div className="flex items-center gap-2">
          {onAiGenerate && (
            <button
              type="button"
              onClick={onAiGenerate}
              disabled={isGenerating}
              className="flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-xs font-medium text-[color:var(--foreground)] transition-all hover:bg-[oklch(1_0_0_/_0.5)] disabled:opacity-50"
            >
              <Sparkles size={13} />
              {isGenerating ? "生成中…" : "AI 生成"}
            </button>
          )}
          <button
            type="button"
            onClick={() => onChange([...value, createEmptyScoringItem()])}
            className="flex items-center gap-1 rounded-[10px] px-2.5 py-1.5 text-xs font-medium text-[color:var(--foreground)] transition-all hover:bg-[oklch(1_0_0_/_0.5)]"
          >
            <Plus size={13} /> 添加评分因素
          </button>
        </div>
      </div>

      {aiError && <p className="px-1 text-xs text-[rgba(199,108,83,1)]">{aiError}</p>}

      <div className="overflow-x-auto rounded-[14px] border border-[oklch(0.6_0.04_258_/_0.25)] bg-[oklch(1_0_0_/_0.5)] p-3">
        <table className="w-full min-w-[760px] border-collapse" style={{ tableLayout: "fixed" }}>
          <thead>
            <tr className="bg-[oklch(0.55_0.05_258_/_0.06)] text-xs font-semibold">
              <th className="w-[54px] border border-[rgba(200,210,230,0.6)] px-2 py-2 text-center">序号</th>
              <th className="w-[130px] border border-[rgba(200,210,230,0.6)] px-2 py-2 text-center">评分因素</th>
              <th className="w-[76px] border border-[rgba(200,210,230,0.6)] px-2 py-2 text-center">分值</th>
              <th className="border border-[rgba(200,210,230,0.6)] px-2 py-2 text-center">评分标准</th>
              <th className="w-[150px] border border-[rgba(200,210,230,0.6)] px-2 py-2 text-center">说明</th>
              <th className="w-[64px] border border-[rgba(200,210,230,0.6)] px-2 py-2 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {value.map((item, i) => (
              <tr key={item.id}>
                <td className="border border-[rgba(200,210,230,0.6)] px-2 py-1.5 text-center text-sm tabular-nums">{i + 1}</td>
                <td className="border border-[rgba(200,210,230,0.6)] p-1"><input className={inputCls} value={item.factor} placeholder="如：价格部分" onChange={(e) => update(item.id, { factor: e.target.value })} /></td>
                <td className="border border-[rgba(200,210,230,0.6)] p-1"><input className={`${inputCls} text-center`} value={item.score} placeholder="如：30" onChange={(e) => update(item.id, { score: e.target.value })} /></td>
                <td className="border border-[rgba(200,210,230,0.6)] p-1"><textarea className={`${inputCls} min-h-[64px] resize-y leading-relaxed`} value={item.criteria} placeholder="打分规则与计算公式" onChange={(e) => update(item.id, { criteria: e.target.value })} /></td>
                <td className="border border-[rgba(200,210,230,0.6)] p-1"><textarea className={`${inputCls} min-h-[64px] resize-y`} value={item.note} placeholder="评审依据/证明材料，无则 /" onChange={(e) => update(item.id, { note: e.target.value })} /></td>
                <td className="border border-[rgba(200,210,230,0.6)] p-1">
                  <div className="flex flex-col items-center gap-0.5">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-[color:var(--muted-foreground)] hover:bg-[oklch(1_0_0_/_0.4)] disabled:opacity-30" title="上移"><ArrowUp size={13} /></button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === value.length - 1} className="rounded p-1 text-[color:var(--muted-foreground)] hover:bg-[oklch(1_0_0_/_0.4)] disabled:opacity-30" title="下移"><ArrowDown size={13} /></button>
                    <button type="button" onClick={() => onChange(value.filter((x) => x.id !== item.id))} className="rounded p-1 text-[color:var(--muted-foreground)] hover:bg-[oklch(1_0_0_/_0.4)]" title="删除行"><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {value.length === 0 && (
              <tr><td colSpan={6} className="border border-[rgba(200,210,230,0.6)] px-2 py-6 text-center text-sm text-[color:var(--muted-foreground)]">暂无评分因素，点击右上「添加评分因素」或「AI 生成」</td></tr>
            )}
            <tr className="bg-[oklch(0.55_0.05_258_/_0.04)] font-semibold">
              <td colSpan={2} className="border border-[rgba(200,210,230,0.6)] px-2 py-2 text-center text-sm">合计</td>
              <td className="border border-[rgba(200,210,230,0.6)] px-2 py-2 text-center text-sm tabular-nums">{total ?? "—"}</td>
              <td colSpan={3} className="border border-[rgba(200,210,230,0.6)] px-2 py-2 text-xs">
                {total !== null && !totalValid ? (
                  <span className="text-[rgba(178,124,42,1)]">提示：分值合计应为 100，当前 {total}</span>
                ) : null}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [x] **Step 2: tender-section-editor.tsx 接线**

- import 增加 `ScoringItemsEditor, parseScoringTextToItems` 与 `ScoringItem` 类型；
- props 增加 `onScoringItemsChange?: (items: ScoringItem[] | undefined) => void;`
- 新增 AI 生成 handler（放在 handleAiGenerate 之后，复用其上下文构造与传输层重试口径）：

```tsx
  const [scoringGenerating, setScoringGenerating] = useState(false);
  const [scoringError, setScoringError] = useState<string | null>(null);
  const handleScoringAiGenerate = async () => {
    if (!onScoringItemsChange) return;
    const scoringField = section?.fields.find((f) => f.scoring);
    setScoringGenerating(true);
    setScoringError(null);
    try {
      const context: Record<string, string> = {};
      for (const [key, v] of Object.entries(draft)) {
        if (typeof v === "string" && v.trim() && key !== "scoringItems") {
          const cfg = section?.fields.find((f) => String(f.key) === key);
          context[cfg?.label ?? key] = v;
        }
      }
      const result = await generateFieldContent({
        fieldKey: "scoringItems",
        fieldLabel: "综合评分法评审标准",
        currentValue: "",
        aiPrompt: scoringField?.aiPrompt,
        context,
      });
      const items = parseScoringTextToItems(result.content ?? "");
      if (!items) throw new Error("AI 返回内容无法解析为评分标准行，请重试或手工填写");
      onScoringItemsChange(items);
    } catch (error) {
      setScoringError(error instanceof Error ? error.message : "AI 生成失败，请稍后重试");
      setTimeout(() => setScoringError(null), 6000);
    } finally {
      setScoringGenerating(false);
    }
  };
```
（传输层 502 重试沿用 handleAiGenerate 内同款 isTransportError 循环——实现时把该循环提取为 `withTransportRetry` 局部 helper 供两处共用，避免复制。）

- 在 `if (field.quotationType)` 分支**之前**插入：

```tsx
            // 综合评分法评审标准（询比）：专用结构化评分行编辑器
            if (field.scoring) {
              const items = (draft as { scoringItems?: ScoringItem[] }).scoringItems ?? [];
              const valid = hasValidScoringRows(items);
              return (
                <div key={field.key} className={getFieldCardClassName(field.key, valid)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[0.82rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                        {field.label}
                      </span>
                    </div>
                    <span
                      className={[
                        "rounded-[5px] px-2.5 py-1 text-[10px] font-semibold transition-all duration-200",
                        valid
                          ? "bg-[rgba(92,181,150,0.1)] text-[rgba(78,150,124,1)]"
                          : "bg-[rgba(230,129,102,0.1)] text-[rgba(199,108,83,1)]",
                      ].join(" ")}
                    >
                      {valid ? "已填写" : "待填写"}
                    </span>
                  </div>
                  <ScoringItemsEditor
                    value={items}
                    onChange={(next) => onScoringItemsChange?.(next)}
                    onAiGenerate={handleScoringAiGenerate}
                    isGenerating={scoringGenerating}
                    aiError={scoringError}
                  />
                  <p className="px-1 text-[11px] leading-relaxed text-[color:var(--muted-foreground)]">
                    评审方法已固定为综合评分法；各行分值合计应为 100，评分标准将写入采购文件第三章「六、综合评分法评审标准」表。
                  </p>
                </div>
              );
            }
```
（import `hasValidScoringRows`。）

- [x] **Step 3: 透传链**

- `tender-questionnaire.tsx`：props 加 `onScoringItemsChange?: (items: ScoringItem[] | undefined) => void;` 传给 TenderSectionEditor。
- `tender-write-workspace.tsx`：同款 prop 转发给 TenderQuestionnaire。
- `page.tsx`：

```tsx
  const updateDraftScoringItems = (items: ScoringItem[] | undefined) => {
    if (selectedType !== "INQUIRY_PURCHASE") return;
    setDrafts((previous) => ({
      ...previous,
      INQUIRY_PURCHASE: {
        ...createEmptyInquiryPurchaseDraft(),
        ...previous.INQUIRY_PURCHASE,
        scoringItems: items,
      },
    }));
  };
```
workspace 传 `onScoringItemsChange={updateDraftScoringItems}`。
- `tender-write-modal.tsx`：同款 updateDraftScoringItems + workspace 透传。

- [x] **Step 4: tsc + lint + commit**

```bash
pnpm --filter web exec tsc --noEmit && pnpm --filter web lint
git add apps/web/src/components/tender-write/scoring-items-editor.tsx apps/web/src/components/tender-write/tender-section-editor.tsx apps/web/src/components/tender-write/tender-write-workspace.tsx apps/web/src/components/tender-write/tender-questionnaire.tsx "apps/web/src/app/(main)/tender-write/page.tsx" apps/web/src/components/projects/tender-write-modal.tsx
git commit -m "feat(web): 综合评分法评审标准专用编辑器（增删移行/合计校验/AI 生成）接入询比第④节"
```

---

### Task 5: 预览组件 InquiryPurchasePreview 重写

**Files:**
- Modify: `apps/web/src/components/tender-write/tender-preview-document.tsx`

**Interfaces:**
- Consumes: Task 3 `InquiryPurchaseDraft`（含 scoringItems）、Task 4 `hasValidScoringRows`/`scoringTotal`
- Produces: 询比预览五章结构（第三章含评分表渲染）

- [x] **Step 1: 整体替换 InquiryPurchasePreview 组件**

以 `InternalBiddingPreview`（1316-1759 行）为底本克隆，做如下替换（其余逐行保留）：
1. 删 `isInvited` prop 与 T 映射，改常量：`const T = { docTitle: '询比采购文件', party: '供应商', file: '响应文件', chapter: '采购邀请', buyer: '采购人' };`，draft 类型 `InquiryPurchaseDraft`。
2. 前附表 16.1 行固定文案（1556-1561 行）改为：
```tsx
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">16.1</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">确定成交人</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                      按评审得分由高到低顺序确定；得分相同的，按报价由低到高顺序确定；得分且报价相同的，由询比小组推荐成交候选人。
                    </td>
```
3. 第三章整段（1635-1662 行）替换为：
```tsx
        {/* 第三章 评审程序和评定成交的标准 */}
        <PreviewSection
          sectionKey="evaluation"
          chapterLabel="第三章"
          title="评审程序和评定成交的标准"
          activeSectionKey={activeSectionKey}
          onSectionClick={onSectionClick}
        >
          <div className="tender-preview-subsection">
            <div className="text-sm leading-7 text-[color:var(--foreground)]">
              <p>8.1 本项目采用的评审办法为：</p>
              <p className="ml-4 mt-2">☑综合评分法，见《综合评分法评审标准》，采购文件中没有规定的评审标准不得作为评审的依据。</p>
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">六、综合评分法评审标准</p>
            </div>
            {hasValidScoringRows((draft as { scoringItems?: ScoringItem[] }).scoringItems) ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse border border-[oklch(0.55_0.05_258_/_0.2)]">
                  <tbody>
                    <tr className="bg-[oklch(0.55_0.05_258_/_0.06)] font-semibold text-sm">
                      <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-2 py-2 text-center w-[8%]">序号</td>
                      <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-2 py-2 text-center w-[18%]">评分因素</td>
                      <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-2 py-2 text-center w-[10%]">分值</td>
                      <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-2 py-2 text-center">评分标准</td>
                      <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-2 py-2 text-center w-[16%]">说明</td>
                    </tr>
                    {((draft as { scoringItems?: ScoringItem[] }).scoringItems ?? [])
                      .map((item, i) => ({ item, i }))
                      .filter(({ item }) => item.factor.trim() || item.criteria.trim())
                      .map(({ item, i }) => (
                        <tr key={item.id} className="text-sm">
                          <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-2 py-2 text-center">{i + 1}</td>
                          <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-2 py-2 text-center">{item.factor}</td>
                          <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-2 py-2 text-center tabular-nums">{item.score}</td>
                          <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-2 py-2 whitespace-pre-wrap">{item.criteria}</td>
                          <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-2 py-2">{item.note}</td>
                        </tr>
                      ))}
                    <tr className="bg-[oklch(0.55_0.05_258_/_0.04)] text-sm font-semibold">
                      <td colSpan={2} className="border border-[oklch(0.55_0.05_258_/_0.2)] px-2 py-2 text-center">合计</td>
                      <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-2 py-2 text-center tabular-nums">{scoringTotal((draft as { scoringItems?: ScoringItem[] }).scoringItems) ?? "—"}</td>
                      <td colSpan={2} className="border border-[oklch(0.55_0.05_258_/_0.2)] px-2 py-2" />
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-3 ml-4">
                <span className="rounded-[10px] bg-[rgba(234,188,110,0.12)] px-2 py-1 text-[rgba(178,124,42,1)]">评分标准待填写（在左侧「评审程序和评定成交的标准」中填写）</span>
              </p>
            )}
          </div>
        </PreviewSection>
```
4. 第四章「采购项目概述」placeholder 改 `{{项目概况和采购内容}}`（询比模板同款占位符）；第五章 title `{T.file}格式` 不变。
5. 文件顶部 import：`InquiryPurchaseDraft`、`ScoringItem`、`hasValidScoringRows`、`scoringTotal`。

- [x] **Step 2: 检查 tender-preview-document.test.ts 是否引用询比旧字段并同步**

```bash
grep -n "Inquiry\|询比\|projectIntroduction\|priceLimit" apps/web/src/components/tender-write/tender-preview-document.test.ts
```
命中则按新字段名修正断言。

- [x] **Step 3: tsc + lint + commit**

```bash
pnpm --filter web exec tsc --noEmit && pnpm --filter web lint
git add apps/web/src/components/tender-write/tender-preview-document.tsx apps/web/src/components/tender-write/tender-preview-document.test.ts
git commit -m "feat(web): 询比预览重写为五章制+综合评分法评审标准表渲染"
```

---

### Task 6: 导出闸门（两处）+ import-autofill 字段清单

**Files:**
- Modify: `apps/web/src/app/(main)/tender-write/page.tsx`（handleExport 顶部）
- Modify: `apps/web/src/components/projects/tender-write-modal.tsx`（导出函数顶部）
- Modify: `apps/api/src/tender-write/import-autofill.prompt.ts`（INQUIRY_PURCHASE_SECTIONS）

- [x] **Step 1: page.tsx handleExport（445 行）开头加闸门**

```tsx
    if (selectedType === "INQUIRY_PURCHASE" && !hasValidScoringRows((currentDraft as { scoringItems?: ScoringItem[] }).scoringItems)) {
      setErrorMessage("综合评分法评审标准未填写：请在「评审程序和评定成交的标准」章节填写评分标准后再导出");
      setTimeout(() => setErrorMessage(null), 4000);
      return;
    }
```
（import `hasValidScoringRows`、`ScoringItem` 类型。）

- [x] **Step 2: tender-write-modal.tsx 导出函数（549 行附近）同款闸门**

```tsx
    if (selectedType === 'INQUIRY_PURCHASE' && !hasValidScoringRows((currentDraft as { scoringItems?: ScoringItem[] }).scoringItems)) {
      setErrorMessage('综合评分法评审标准未填写：请在「评审程序和评定成交的标准」章节填写评分标准后再导出');
      return;
    }
```

- [x] **Step 3: import-autofill.prompt.ts——INQUIRY_PURCHASE_SECTIONS（285-306 行）替换为镜像 INTERNAL_BIDDING_SECTIONS 的 6 节清单**

sections：cover（projectName/coverDate）；invitation（projectOverview/maxPrice/submissionRequirements/qualificationRequirements/consortiumForm/documentAcquireTime/documentPrice/responseSubmissionTime/contactName/contactPhone/contactEmail + 响应/履约保证金相关键，与 INTERNAL 清单同排布）；supplier/evaluation 空；requirements（businessRequirements/technicalRequirements）；quotation（quotationLetter）。**去掉** evaluationMethod/evaluationCommitteeCount。

- [x] **Step 4: 全链校验 + commit**

```bash
pnpm --filter api lint && pnpm --filter api test -- tender-write
pnpm --filter web exec tsc --noEmit && pnpm --filter web lint
git add "apps/web/src/app/(main)/tender-write/page.tsx" apps/web/src/components/projects/tender-write-modal.tsx apps/api/src/tender-write/import-autofill.prompt.ts
git commit -m "feat: 询比导出双端评分标准闸门 + AI 导入字段清单对齐新模板"
```

---

### Task 7: 端到端冒烟与收尾

- [x] **Step 1: API 侧端到端冒烟（不起 dev server，用 tsx 脚本直调 service 层函数）**

```bash
cd apps/api && node -e "
const fs=require('fs');
(async()=>{
  const J=require('jszip');
  const {buildInquiryPurchaseReplacementPlan,renderTemplateXml,buildTenantPlaceholderReplacements}=require('./dist/tender-write/tender-write.template.js');
  const xml=(await J.loadAsync(fs.readFileSync('模板文件/询比采购文件模板.docx'))).file('word/document.xml').async('string');
  await (async()=>{const x=await xml;
    const plan=[...buildInquiryPurchaseReplacementPlan(require('./dist/tender-write/tender-write.types.js') && ({
      projectName:'冒烟项目',coverDate:'2026-10',projectOverview:'x',procurementContent:'x',maxPrice:'1',
      submissionRequirementsType:'none',qualificationRequirements:'x',consortiumFormType:'reject',
      documentAcquireTime:'x',documentPrice:'0',responseSubmissionTime:'x',
      contactName:'x',contactPhone:'x',contactEmail:'x',
      responseDepositType:'none',responseDepositOtherRequirement:'/',responseDepositNonRefundType:'none',
      performanceDepositType:'none',contractSubcontractingType:'none',siteSurvey:'/',copyCount:'4',
      businessRequirements:'x',technicalRequirements:'x',quotationLetterType:'table',
      scoringItems:[{id:'1',factor:'价格',score:'40',criteria:'公式',note:'/'},{id:'2',factor:'技术',score:'60',criteria:'细则',note:'/'}],
    })),...buildTenantPlaceholderReplacements('某公司',{})];
    const out=renderTemplateXml(x,plan);
    fs.writeFileSync('/tmp/xunbi_smoke.docx.xml',out);
    const text=out.replace(/<[^>]+>/g,'');
    console.log('残留占位符',(text.match(/\{\{[^}]+\}\}/g)||[]).length,'| 含合计100:',out.includes('100'),'| 竞价残留:',out.includes('竞价'));
  })();
})()"
```
Expected: `残留占位符 0 | 含合计100: true | 竞价残留: false`
（若 dist 未编译：`pnpm --filter api build` 后再跑；或直接以 jest 用例为准——Task 2 spec 已覆盖同路径，此步为双保险。）

- [x] **Step 2: 人工冒烟清单（可选，起 dev 时注意 macOS 下 dev:kill 无效——手工按 PID 清理）**

:3005 → 招投标文档 → 询比采购：6 节导航、第④节固定方法+评分表增删移/AI 生成/合计提示、预览第三章表格、空表点导出被拦、填 2 行后导出 docx 用 Word/WPS 打开核对第三章表格（列宽/边框/合计）与前附表 16.1 文案。

- [x] **Step 3: spec 状态行更新 + 收尾提交**

```bash
git add docs/superpowers/specs/2026-10-29-inquiry-purchase-template-v2-design.md
git commit -m "docs: 询比模板 v2 spec 状态更新为已实施"
```

---

## Self-Review 结论

- **Spec 覆盖**：设计 6 节（数据模型/前端/后端/测试/模板修正/不做清单）分别落 Task 3-4-5（前端）、Task 2（后端）、Task 2（测试）、Task 1（模板修正）；「不做清单」无任务对应（正确）。
- **占位符核对**：新 docx 52 个占位符 ∈ plan（Task 2 测试锁死零残留）；评标方法1/2/评标委员会人数不在模板（plan 已删对应替换）。
- **类型一致性**：`ScoringItem` 五字段（id/factor/score/criteria/note）前后端同构；`scoringRows`（API 注入行）= ScoringItem 去 id/trim 后形态；`hasValidScoringRows` 判定口径（factor||criteria 非空）在 Task 4 定义、Task 5/6 消费同名。
- **已知边界**：旧询比 localStorage 草稿字段失效（设计已裁定接受）；评分因素跨行合并 v1 不做。
