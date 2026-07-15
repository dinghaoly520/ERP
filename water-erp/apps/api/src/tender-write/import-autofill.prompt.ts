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
8. 只输出 JSON，不要包含任何其他文字。`;
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
  rawJson: string,
  allowedKeys: Set<string>,
  fieldDefs: FieldDef[],
): ImportAutofillFieldResult[] {
  let parsed: { fields: unknown[] };
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('AI 返回的 JSON 格式无效。');
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
      value: typeof m.value === 'string' ? m.value : '',
      confidence: typeof m.confidence === 'number' ? m.confidence : 0,
      source: status !== 'not_found' ? source : undefined,
    });
  }

  return results;
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
      { key: 'responseDeadline', label: '响应文件提交截止时间' },
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
      { key: 'contractText', label: '合同文本' },
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
    key: 'contract',
    title: '合同',
    fields: [{ key: 'contractText', label: '合同文本' }],
  },
  {
    key: 'response',
    title: '报价函',
    fields: [{ key: 'quotationLetter', label: '报价函' }],
  },
];

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
    key: 'instructions',
    title: '询价须知',
    fields: [
      { key: 'projectIntroduction', label: '项目简介' },
      { key: 'procurementContent', label: '采购内容' },
      { key: 'requiredDocuments', label: '所需文件' },
      { key: 'evaluationMethod', label: '评审方法' },
      { key: 'priceLimit', label: '最高限价' },
      { key: 'submissionDeadline', label: '递交截止时间' },
      { key: 'contactName', label: '联系人' },
      { key: 'contactEmail', label: '联系邮箱' },
      { key: 'contactPhone', label: '联系电话' },
    ],
  },
  {
    key: 'quotation',
    title: '报价函',
    fields: [{ key: 'quotationLetter', label: '报价函' }],
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
