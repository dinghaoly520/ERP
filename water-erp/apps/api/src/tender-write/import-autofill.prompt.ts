import type {
  ImportAutofillFieldResult,
  ImportAutofillFieldSource,
} from './import-autofill.types';

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

type FieldDef = {
  key: string;
  label: string;
  sectionKey: string;
  sectionTitle: string;
};

export function buildImportAutofillSystemPrompt(
  documentTypeLabel: string,
  fields: FieldDef[],
): string {
  const fieldList = fields
    .map(
      (f) =>
        `  { "key": "${f.key}", "label": "${f.label}", "sectionKey": "${f.sectionKey}", "sectionTitle": "${f.sectionTitle}" }`,
    )
    .join(',\n');

  return `你是一位采购招标文件分析专家。用户会上传若干资料文件，你需要从中识别出与招标文件编写相关的信息，并按指定字段列表输出。

当前招标文件类型：${documentTypeLabel}

可识别的字段列表：
[
${fieldList}
]

请输出一个 JSON 对象，结构如下：
{
  "fields": [
    {
      "key": "字段key",
      "status": "recognized" | "low_confidence" | "not_found",
      "value": "识别到的内容",
      "confidence": 0.0-1.0,
      "source": {
        "fileName": "来源文件名",
        "location": "来源章节、表格、标题或段落位置",
        "sourceField": "原文件中的具体字段名或近似字段名",
        "quote": "原文摘录",
        "reason": "低置信原因（仅低置信时提供）"
      }
    }
  ]
}

规则：
1. 只能输出上述字段列表中存在的 key，不要新增字段。
2. 如果确信识别到内容，status 为 "recognized"，confidence >= 0.8。
3. 如果找到候选内容但存在不确定（例如文件中有多处金额、字段含义可能有歧义），status 为 "low_confidence"，confidence 0.4-0.79，并在 source.reason 中说明原因。
4. 如果在所有上传文件中均未找到相关内容，status 为 "not_found"，value 为空字符串，confidence 为 0，不需要 source。
5. source 必须尽量具体：写明来源文件名、章节/表格/标题位置、原文件中对应的字段名、简短原文摘录。
6. 原文摘录应短而具体，足以让用户核对，不超过 200 字。
7. 每个字段都必须出现在结果中，即使未找到。
8. 对于联系电话（contactPhone），只输出纯号码（如 028-81753276 或 13812345678），不要添加"联系电话"、"电话"等前缀或任何说明文字。
9. 对于联系邮箱（contactEmail），只输出纯邮箱地址（如 example@company.com），不要添加"联系邮箱"、"邮箱"等前缀或任何说明文字。
10. 对于文件售价（documentPrice），只输出一个纯数值（如 100、500），不要添加"元"、"元/份"、"人民币"等单位或任何说明文字——前端会自动包装"人民币"和"元/份"。若资料中未提及售价，输出 0（本公司电子采购文件免费提供）。
11. 只输出 JSON，不要包含任何其他文字。`;
}

/**
 * 公告导入识别的语义映射指引（2026-11-03）：上传资料多为采购文件/项目资料——公告字段与
 * 采购文件措辞不同构，不给映射则模型大量落 not_found（用户实录：同文件采购文件导入命中
 * 很多、公告导入几乎为空）。要求按语义映射提取，映射但内容明确 → recognized；含推断 →
 * low_confidence 并在 reason 注明「由 XX 映射」；确实无从映射 → not_found。
 */
export function buildAnnouncementMappingGuidance(category: string): string {
  const generic = `
公告字段语义映射规则（上传资料通常是采购文件/项目资料，公告字段不必与原文措辞一致）：
- 不要求原文出现与字段同名的标题/字样；按语义就近映射，映射成立且内容明确即 recognized。
- 映射含推断成分（如时间换算、跨章节拼合）→ low_confidence，reason 写明「由 XX 映射」。
- 金额类只输出纯数值（去"元/万元/人民币"）；日期时间保持原文表述原样输出。`;
  const perCategory: Record<string, string> = {
    procurement_document: `
本类公告（采购文件公告）逐字段映射提示：
- 项目概况和采购内容 ← 采购邀请/项目概况/采购需求章节的项目介绍与采购范围
- 最高限价（小写） ← 最高限价/采购预算/预算金额（纯数值）
- 工期及进度要求 / 其内容 ← 工期/服务期/交付（完成）期限/进度要求
- 报名方式及条件 ← 供应商资格条件/报名方式/文件获取方式与要求
- 公示期限（起始日） ← 公告公示期/异议期起算表述；资料无公示期概念则 not_found
- 开标时间 ← 开标时间/响应文件递交截止时间/报价截止时间
- 联系人/联系电话/联系邮箱 ← 采购人/采购代理机构联系方式（纯号码/纯邮箱）
- 落款日期 ← 资料落款日期或公告拟定发布日；无则 not_found
- 监督人/监督部门/监督地址/监督电话 ← 采购文件「监督/纪检监察/异议受理」章节的监督信息（监督电话只输出纯号码）；资料无监督章节则 not_found`,
    failed_bid: `
本类公告（流标公告）逐字段映射提示：
- 项目简要说明 ← 项目概况/采购内容/采购需求摘要
- 开标时间 ← 开标时间/递交截止时间/评审时间
- 开标结果公示信息 ← 评审/开标结果、流标原因、有效供应商不足等描述；资料无结果信息则 not_found
- 落款日期 ← 资料落款日期；无则 not_found
- 监督人/监督部门/监督地址/监督电话 ← 采购文件「监督/纪检监察/异议受理」章节的监督信息（监督电话只输出纯号码）；资料无监督章节则 not_found`,
    winning_bid: `
本类公告（中标公告）逐字段映射提示：
- 项目简要说明 ← 项目概况/采购内容摘要
- 最高限价（小写） ← 最高限价/采购预算（纯数值）
- 开标时间 ← 开标时间/递交截止时间
- 备注 / 备注内容 ← 评审说明/成交说明（无则 not_found）
- 公示期（异议期）/异议受理 ← 公示期与异议受理表述（无则 not_found）`,
  };
  return generic + (perCategory[category] ?? '');
}

export function buildImportAutofillUserPrompt(
  fileTexts: { name: string; text: string }[],
): string {
  const fileSections = fileTexts
    .map((f) => `--- 文件：${f.name} ---\n${f.text}`)
    .join('\n\n');

  return `以下是需要分析的文件内容：\n\n${fileSections}`;
}

// ---------------------------------------------------------------------------
// AI response parser
// ---------------------------------------------------------------------------

export function parseAiImportResponse(
  rawJson: unknown,
  allowedKeys: Set<string>,
  fieldDefs: FieldDef[],
): ImportAutofillFieldResult[] {
  // chatJson 返回的已是解析后的对象；此处兼容两种情况：对象直接使用，字符串则 JSON.parse。
  let parsed: { fields: unknown[] };
  if (typeof rawJson === 'string') {
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      throw new Error('AI 返回的 JSON 格式无效。');
    }
  } else if (typeof rawJson === 'object' && rawJson !== null) {
    parsed = rawJson as { fields: unknown[] };
  } else {
    throw new Error('AI 返回结构无效。');
  }

  if (!Array.isArray(parsed.fields)) {
    throw new Error('AI 返回结构缺少 fields 数组。');
  }

  const results: ImportAutofillFieldResult[] = [];

  for (const fieldDef of fieldDefs) {
    const match = parsed.fields.find(
      (f: unknown) =>
        typeof f === 'object' &&
        f !== null &&
        'key' in f &&
        (f as Record<string, unknown>).key === fieldDef.key,
    );

    if (!match || !allowedKeys.has(fieldDef.key)) {
      results.push({
        key: fieldDef.key,
        label: fieldDef.label,
        sectionKey: fieldDef.sectionKey,
        sectionTitle: fieldDef.sectionTitle,
        status: 'not_found',
        value: '',
        confidence: 0,
      });
      continue;
    }

    const m = match as Record<string, unknown>;
    const status = validateStatus(m.status);
    const source = extractSource(m.source);

    results.push({
      key: fieldDef.key,
      label: fieldDef.label,
      sectionKey: fieldDef.sectionKey,
      sectionTitle: fieldDef.sectionTitle,
      status,
      value:
        typeof m.value === 'string' ? sanitizeReplacementChar(m.value) : '',
      confidence: typeof m.confidence === 'number' ? m.confidence : 0,
      source: status !== 'not_found' ? source : undefined,
    });
  }

  return results;
}

/**
 * 清洗 U+FFFD（�）替换符：LLM 响应在网络传输中偶发 UTF-8 多字节字符损坏，
 * 出现在识别结果里就是乱码。剔除后不影响其余文本。
 */
function sanitizeReplacementChar(text: string): string {
  if (!text.includes('�')) return text;
  return text
    .replace(/�+/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function validateStatus(
  raw: unknown,
): 'recognized' | 'low_confidence' | 'not_found' {
  if (
    raw === 'recognized' ||
    raw === 'low_confidence' ||
    raw === 'not_found'
  ) {
    return raw;
  }
  return 'not_found';
}

function extractSource(raw: unknown): ImportAutofillFieldSource | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const s = raw as Record<string, unknown>;
  return {
    fileName: typeof s.fileName === 'string' ? s.fileName : '',
    location: typeof s.location === 'string' ? s.location : '',
    sourceField: typeof s.sourceField === 'string' ? s.sourceField : '',
    quote: typeof s.quote === 'string' ? s.quote : '',
    reason: typeof s.reason === 'string' ? s.reason : undefined,
  };
}

// ---------------------------------------------------------------------------
// Field definitions per document type (mirrors frontend templates.ts)
// ---------------------------------------------------------------------------

type TenderSectionDef = {
  key: string;
  title: string;
  fields: { key: string; label: string }[];
};

const COMPETITIVE_NEGOTIATION_SECTIONS: TenderSectionDef[] = [
  {
    key: 'cover',
    title: '封面',
    fields: [
      { key: 'projectName', label: '项目名称' },
      { key: 'coverDate', label: '封面时间' },
    ],
  },
  {
    key: 'invitation',
    title: '采购邀请',
    fields: [
      { key: 'projectOverview', label: '项目概况和采购内容' },
      { key: 'maxPrice', label: '最高限价' },
      { key: 'submissionRequirements', label: '提交成果要求' },
      { key: 'qualificationRequirements', label: '特定资格要求' },
      { key: 'documentAcquireTime', label: '文件获取时间' },
      { key: 'responseDeadline', label: '开标时间' },
      { key: 'contactName', label: '联系人' },
      { key: 'contactPhone', label: '联系电话' },
      { key: 'contactEmail', label: '联系邮箱' },
    ],
  },
  {
    key: 'supplier',
    title: '供应商须知',
    fields: [
      { key: 'contractSubcontracting', label: '合同分包' },
      { key: 'siteSurvey', label: '是否组织现场踏勘' },
    ],
  },
  {
    key: 'requirements',
    title: '采购需求',
    fields: [
      { key: 'businessRequirements', label: '商务要求' },
      { key: 'technicalRequirements', label: '技术要求' },
    ],
  },
  {
    key: 'quotation',
    title: '响应文件格式',
    fields: [{ key: 'quotationLetter', label: '报价表' }],
  },
];

const SINGLE_SOURCE_SECTIONS: TenderSectionDef[] = [
  {
    key: 'cover',
    title: '封面',
    fields: [
      { key: 'projectName', label: '项目名称' },
      { key: 'coverDate', label: '封面时间' },
    ],
  },
  {
    key: 'invitation',
    title: '邀请函',
    fields: [
      { key: 'supplierName', label: '供应商名称' },
      { key: 'projectBudget', label: '项目预算价格' },
      { key: 'projectDuration', label: '项目完成期限' },
      { key: 'documentAcquireTime', label: '文件获取时间' },
      { key: 'documentPrice', label: '文件售价' },
      { key: 'submissionAndNegotiationTime', label: '提交和谈判时间' },
      { key: 'contactName', label: '联系人' },
      { key: 'contactEmail', label: '联系邮箱' },
      { key: 'contactPhone', label: '联系电话' },
    ],
  },
  {
    key: 'terms',
    title: '条款',
    fields: [
      { key: 'serviceContent', label: '服务内容' },
      { key: 'procurementContent', label: '采购内容' },
      { key: 'procurementRequirements', label: '采购要求' },
    ],
  },
  {
    key: 'response',
    title: '报价函',
    fields: [{ key: 'quotationLetter', label: '报价函' }],
  },
];

// 2026-10-29 模板 v2：六章制与竞价同构（去评标方法/评标委员会人数；评审标准为
// 结构化评分行编辑器，不入 AI 导入识别清单）
const INQUIRY_PURCHASE_SECTIONS: TenderSectionDef[] = [
  {
    key: 'cover',
    title: '封面',
    fields: [
      { key: 'projectName', label: '项目名称' },
      { key: 'coverDate', label: '封面时间' },
    ],
  },
  {
    key: 'invitation',
    title: '采购邀请',
    fields: [
      { key: 'projectOverview', label: '项目概况和采购内容' },
      { key: 'procurementContent', label: '采购内容' },
      { key: 'maxPrice', label: '最高限价' },
      { key: 'submissionRequirements', label: '提交成果要求' },
      { key: 'qualificationRequirements', label: '特定资质要求' },
      { key: 'consortiumForm', label: '联合体形式' },
      { key: 'documentAcquireTime', label: '文件获取时间' },
      { key: 'documentPrice', label: '文件售价' },
      { key: 'responseSubmissionTime', label: '响应文件递交时间' },
      { key: 'contactName', label: '联系人' },
      { key: 'contactPhone', label: '联系电话' },
      { key: 'contactEmail', label: '联系邮箱' },
      { key: 'responseDepositType', label: '响应保证金类型' },
      { key: 'responseDepositAmount', label: '响应保证金金额' },
      { key: 'responseDepositForm', label: '响应保证金形式' },
      { key: 'responseDepositBankInfo', label: '响应保证金开户银行信息' },
      { key: 'performanceDepositType', label: '履约保证金类型' },
      { key: 'performanceDepositAmount', label: '履约保证金金额' },
      { key: 'performanceDepositForm', label: '履约保证金形式' },
      { key: 'contractSubcontracting', label: '合同分包' },
      { key: 'siteSurvey', label: '是否组织现场踏勘' },
      { key: 'copyCount', label: '响应文件份数' },
    ],
  },
  {
    key: 'supplier',
    title: '供应商须知',
    fields: [],
  },
  {
    key: 'evaluation',
    title: '评审程序和评定成交的标准',
    fields: [],
  },
  {
    key: 'requirements',
    title: '采购需求',
    fields: [
      { key: 'businessRequirements', label: '商务要求' },
      { key: 'technicalRequirements', label: '技术要求' },
    ],
  },
  {
    key: 'quotation',
    title: '响应文件格式',
    fields: [{ key: 'quotationLetter', label: '报价表' }],
  },
];

const INTERNAL_BIDDING_SECTIONS: TenderSectionDef[] = [
  {
    key: 'cover',
    title: '封面',
    fields: [
      { key: 'projectName', label: '项目名称' },
      { key: 'coverDate', label: '封面时间' },
    ],
  },
  {
    key: 'invitation',
    title: '采购邀请',
    fields: [
      { key: 'projectOverview', label: '项目概况和采购内容' },
      { key: 'procurementContent', label: '采购内容' },
      { key: 'maxPrice', label: '最高限价' },
      { key: 'submissionRequirements', label: '提交成果要求' },
      { key: 'qualificationRequirements', label: '特定资格要求' },
      { key: 'consortiumForm', label: '联合体形式' },
      { key: 'documentAcquireTime', label: '文件获取时间' },
      { key: 'documentPrice', label: '文件售价' },
      { key: 'responseSubmissionTime', label: '响应文件递交时间' },
      { key: 'contactName', label: '联系人' },
      { key: 'contactPhone', label: '联系电话' },
      { key: 'contactEmail', label: '联系邮箱' },
      { key: 'responseDepositType', label: '响应保证金类型' },
      { key: 'responseDepositAmount', label: '响应保证金金额' },
      { key: 'responseDepositForm', label: '响应保证金形式' },
      { key: 'responseDepositBankInfo', label: '响应保证金开户银行信息' },
      { key: 'performanceDepositType', label: '履约保证金类型' },
      { key: 'performanceDepositAmount', label: '履约保证金金额' },
      { key: 'performanceDepositForm', label: '履约保证金形式' },
      { key: 'evaluationMethod', label: '评审方法' },
      { key: 'evaluationCommitteeCount', label: '评审委员会人数' },
      { key: 'contractSubcontracting', label: '合同分包' },
      { key: 'siteSurvey', label: '是否组织现场踏勘' },
      { key: 'copyCount', label: '响应文件份数' },
    ],
  },
  {
    key: 'supplier',
    title: '供应商须知',
    fields: [],
  },
  {
    key: 'evaluation',
    title: '评审',
    fields: [],
  },
  {
    key: 'requirements',
    title: '采购需求',
    fields: [
      { key: 'businessRequirements', label: '商务要求' },
      { key: 'technicalRequirements', label: '技术要求' },
    ],
  },
  {
    key: 'quotation',
    title: '响应文件格式',
    fields: [{ key: 'quotationLetter', label: '报价表' }],
  },
];

const INVITED_BIDDING_SECTIONS = INTERNAL_BIDDING_SECTIONS;

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  COMPETITIVE_NEGOTIATION: '谈判采购',
  SINGLE_SOURCE: '直接采购',
  INQUIRY_PURCHASE: '询比采购',
  INTERNAL_BIDDING: '竞价采购',
  INVITED_BIDDING: '邀请招标',
};

export function getFieldDefsForDocumentType(
  documentType: string,
): { fields: FieldDef[]; label: string } {
  const sections = getSectionsForDocumentType(documentType);
  const label = DOCUMENT_TYPE_LABELS[documentType] ?? documentType;
  const fields: FieldDef[] = [];
  for (const section of sections) {
    for (const f of section.fields) {
      fields.push({
        key: f.key,
        label: f.label,
        sectionKey: section.key,
        sectionTitle: section.title,
      });
    }
  }
  return { fields, label };
}

// ── 公告导入识别（2026-11-03）：字段表镜像前端 announcement-templates 的四套变体 ──
// （key/label 与 web 端 AnnouncementFieldConfig 逐一对应；日期类字段由前端按控件类型归一）

const PROCUREMENT_BIDDING_ANNOUNCEMENT_SECTIONS: TenderSectionDef[] = [
  {
    key: 'content',
    title: '公告内容',
    fields: [
      { key: 'projectName', label: '项目名称' },
      { key: 'projectOverview', label: '项目概况和采购内容' },
      { key: 'maxPriceNumeric', label: '最高限价（小写）' },
      { key: 'scheduleRequirementsType', label: '工期及进度要求' },
      { key: 'scheduleRequirements', label: '工期及进度要求内容' },
      { key: 'registrationMethod', label: '报名方式及条件' },
      { key: 'announcementStart', label: '公示期限（起始日）' },
      { key: 'bidOpeningTime', label: '开标时间' },
      { key: 'contactName', label: '联系人' },
      { key: 'contactPhone', label: '联系电话' },
      { key: 'contactEmail', label: '联系邮箱' },
            { key: 'supervisionContact', label: '监督人' },
      { key: 'supervisionDepartment', label: '监督部门' },
      { key: 'supervisionAddress', label: '监督地址' },
      { key: 'supervisionPhone', label: '监督电话' },
      { key: 'signatureDate', label: '落款日期' },
    ],
  },
];

const PROCUREMENT_SINGLE_SOURCE_ANNOUNCEMENT_SECTIONS: TenderSectionDef[] = [
  {
    key: 'content',
    title: '公告内容',
    fields: [
      { key: 'projectName', label: '项目名称' },
      { key: 'projectOverview', label: '项目概况和采购内容' },
      { key: 'maxPriceNumeric', label: '预算金额（小写）' },
      { key: 'argumentOpinion', label: '论证意见' },
      { key: 'supplierName', label: '拟定供应商名称' },
      { key: 'supplierAddress', label: '拟定供应商地址' },
      { key: 'announcementStart', label: '公示期限（起始日）' },
      { key: 'announcementDays', label: '公示期限（天数）' },
      { key: 'procurementTime', label: '采购时间' },
            { key: 'supervisionContact', label: '监督人' },
      { key: 'supervisionDepartment', label: '监督部门' },
      { key: 'supervisionAddress', label: '监督地址' },
      { key: 'supervisionPhone', label: '监督电话' },
      { key: 'signatureDate', label: '落款日期' },
    ],
  },
];

const FAILED_BID_ANNOUNCEMENT_SECTIONS: TenderSectionDef[] = [
  {
    key: 'content',
    title: '公告内容',
    fields: [
      { key: 'projectName', label: '项目名称' },
      { key: 'projectBriefDescription', label: '项目简要说明' },
      { key: 'bidOpeningTime', label: '开标时间' },
      { key: 'resultInfo', label: '开标结果公示信息' },
            { key: 'supervisionContact', label: '监督人' },
      { key: 'supervisionDepartment', label: '监督部门' },
      { key: 'supervisionAddress', label: '监督地址' },
      { key: 'supervisionPhone', label: '监督电话' },
      { key: 'signatureDate', label: '落款日期' },
    ],
  },
];

const WINNING_BID_ANNOUNCEMENT_SECTIONS: TenderSectionDef[] = [
  {
    key: 'content',
    title: '公告内容',
    fields: [
      { key: 'projectName', label: '项目名称' },
      { key: 'projectBriefDescription', label: '项目简要说明' },
      { key: 'maxPrice', label: '最高限价（小写）' },
      { key: 'bidOpeningTime', label: '开标时间' },
      { key: 'bidder1RemarkType', label: '备注' },
      { key: 'bidder1Remark', label: '备注内容' },
      { key: 'publicityPeriod', label: '公示期（异议期）' },
      { key: 'objection', label: '异议受理' },
            { key: 'supervisionContact', label: '监督人' },
      { key: 'supervisionDepartment', label: '监督部门' },
      { key: 'supervisionAddress', label: '监督地址' },
      { key: 'supervisionPhone', label: '监督电话' },
      { key: 'signatureDate', label: '落款日期' },
    ],
  },
];

const ANNOUNCEMENT_CATEGORY_LABELS: Record<string, string> = {
  procurement_document: '采购文件公告',
  failed_bid: '流标公告',
  winning_bid: '中标公告',
};

/** 公告字段定义：按（公告类别 × 采购方式）取四套变体之一——口径同前端 getAnnouncementFields */
export function getFieldDefsForAnnouncement(
  category: string,
  tenderType: string,
): { fields: FieldDef[]; label: string } {
  let sections: TenderSectionDef[];
  if (category === 'procurement_document') {
    sections = tenderType === 'SINGLE_SOURCE'
      ? PROCUREMENT_SINGLE_SOURCE_ANNOUNCEMENT_SECTIONS
      : PROCUREMENT_BIDDING_ANNOUNCEMENT_SECTIONS;
  } else if (category === 'failed_bid') {
    sections = FAILED_BID_ANNOUNCEMENT_SECTIONS;
  } else {
    sections = WINNING_BID_ANNOUNCEMENT_SECTIONS;
  }
  const label = ANNOUNCEMENT_CATEGORY_LABELS[category] ?? category;
  const fields: FieldDef[] = [];
  for (const section of sections) {
    for (const f of section.fields) {
      fields.push({ key: f.key, label: f.label, sectionKey: section.key, sectionTitle: section.title });
    }
  }
  return { fields, label };
}

function getSectionsForDocumentType(
  documentType: string,
): TenderSectionDef[] {
  switch (documentType) {
    case 'SINGLE_SOURCE':
      return SINGLE_SOURCE_SECTIONS;
    case 'INQUIRY_PURCHASE':
      return INQUIRY_PURCHASE_SECTIONS;
    case 'INTERNAL_BIDDING':
      return INTERNAL_BIDDING_SECTIONS;
    case 'INVITED_BIDDING':
      return INVITED_BIDDING_SECTIONS;
    default:
      return COMPETITIVE_NEGOTIATION_SECTIONS;
  }
}
