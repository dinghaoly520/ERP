import type {
  CompetitiveNegotiationDraft,
  SingleSourceDraft,
  InquiryPurchaseDraft,
  InternalBiddingDraft,
  InvitedBiddingDraft,
  TenderDocumentTypeMeta,
  TenderDraftsState,
  TenderSectionConfig,
  TableData,
} from "@/lib/types/tender-write";

/** 当前年月，格式 YYYY-MM（与封面时间月份选择器一致）。 */
function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export const TENDER_DOCUMENT_TYPES: TenderDocumentTypeMeta[] = [
  {
    type: "COMPETITIVE_NEGOTIATION",
    label: "谈判采购",
    availability: "ready",
    description: "技术复杂或不能确定详细规格的项目，通过多轮谈判择优确定成交供应商。",
  },
  {
    type: "INTERNAL_BIDDING",
    label: "竞价采购",
    availability: "ready",
    description: "采购金额较小、需求明确的项目，内部公开竞价择优选择供应商。",
  },
  {
    type: "INVITED_BIDDING",
    label: "邀请招标",
    availability: "ready",
    description: "采购金额较大、需求明确的项目，邀请特定供应商参与竞价择优选择。",
  },
  {
    type: "INQUIRY_PURCHASE",
    label: "询比采购",
    availability: "ready",
    description: "规格标准统一、货源充足的项目，通过询价比价选择报价最优的供应商。",
  },
  {
    type: "SINGLE_SOURCE",
    label: "直接采购",
    availability: "ready",
    description: "唯一供应商的直接采购场景，按单源采购模板组织邀请函、条款、合同和报价函。",
  },
];

/**
 * 监督信息字段（2026-10-09）：采购文件「监督举报」块占位符化的表单项（与公告侧同款
 * 语义：表单值优先、留空回退统一默认值；监督人经「监督人」按钮从本公司联系人多选）。
 * 仅用于有监督举报块的采购方式（谈判/竞价/邀请招标）；直接采购/询比模板无监督块不加。
 */
const SUPERVISION_TENDER_FIELDS: TenderSectionConfig["fields"] = [
  // 监督人置顶（2026-10-10 用户裁定）：先选人再补部门/地址/电话
  { key: "supervisionContact", label: "监督人", placeholder: "请填写监督人" },
  { key: "supervisionDepartment", label: "监督部门", placeholder: "请填写监督部门" },
  { key: "supervisionAddress", label: "监督地址", placeholder: "请填写监督地址" },
  { key: "supervisionPhone", label: "监督电话", placeholder: "请填写监督电话", type: "tel" },
];

/**
 * 概况/内容类字段 AI 提示词（2026-10-19 用户裁定统一从简）：行文重点=项目背景、采购缘由、
 * 采购内容，其中采购内容只罗列要点，全文不宜长篇大论。谈判/竞价/邀请招标的「项目概况和
 * 采购内容」、询比的「项目介绍」「采购内容」、直接采购的「采购内容」共用，覆盖全部采购方式。
 */
const PROJECT_OVERVIEW_AI_PROMPT =
  "根据项目名称生成项目概况和采购内容，行文只围绕三点：项目背景（因何立项、现状与需求）、采购缘由（为何此时采购）、采购内容（采购标的清单）。篇幅从简：全文不超过200字，一至两个自然段，无需编号；采购内容一句带过，只罗列标的名称、规格/型号、数量，用顿号和逗号连接，不逐项展开描述。禁止长篇大论和「提升管理水平」类空泛套话。不要使用#、*等符号，不要出现空行，不要在开头重复字段名称，必须以自然段落形式输出，绝对不能使用表格（Tab分隔符）形式。";

const PROJECT_INTRODUCTION_AI_PROMPT =
  "根据项目名称生成简短的项目介绍，重点写项目背景与采购缘由：因何立项、现状与需求、为何此时组织采购，末尾可用一句话概述采购内容。篇幅从简：200字以内，一至两个自然段，无需编号。禁止长篇大论和空泛套话。不要使用#、*等符号，不要出现空行，不要在开头重复字段名称，必须以自然段落形式输出，绝对不能使用表格（Tab分隔符）形式。";

const PROCUREMENT_CONTENT_AI_PROMPT =
  "根据项目信息生成简明的采购内容：只罗列采购标的的名称、规格/型号、数量等必要要素，品目之间用顿号和逗号自然连接成句，不写背景、意义、要求等其他内容。篇幅从简：200字以内、一两句话即可，不逐项展开描述，不堆砌修饰词。不要使用#、*等符号，不要出现空行，不要在开头重复字段名称，必须以自然段落形式输出，绝对不能使用表格（Tab分隔符）形式。";

export const COMPETITIVE_NEGOTIATION_SECTIONS: TenderSectionConfig[] = [
  {
    key: "cover",
    title: "封面",
    description: "填写封面的项目名称和封面时间。",
    fields: [
      { key: "projectName", label: "项目名称", placeholder: "请输入项目名称" },
      { key: "coverDate", label: "封面时间", placeholder: "例如 2026-05", type: "month" },
    ],
  },
  {
    key: "invitation",
    title: "采购邀请",
    description: "填写项目信息、时间要求和联系方式。",
    fields: [
      {
        key: "projectOverview",
        label: "项目概况和采购内容",
        placeholder: "请输入项目概况和采购内容",
        multiline: true,
        aiPrompt: PROJECT_OVERVIEW_AI_PROMPT,
      },
      {
        key: "maxPrice",
        label: "最高限价",
        placeholder: "例如 350000",
        aiPrompt: "根据项目概况和采购内容，建议合理的最高限价，只输出纯数字金额。",
      },
      {
        key: "submissionRequirements",
        label: "提交成果要求",
        placeholder: "请输入提交成果要求",
        multiline: true,
        aiPrompt: "根据项目类型生成提交成果要求，描述成果形式、数量、质量要求等。不要包含'5.提交成果要求：'这样的标题或前缀，只输出提交成果要求正文。",
        composite: {
          typeKey: "submissionRequirementsType",
          typeLabel: "是否有提交成果要求",
          typeOptions: [
            { value: "none", label: "无" },
            { value: "have", label: "有" },
          ],
        },
      },
      {
        key: "qualificationRequirements",
        label: "特定资格要求",
        placeholder: "请输入特定资格要求",
        multiline: true,
        aiPrompt: "根据项目类型生成特定资格要求，包含资质证书、业绩要求、人员配置等。要求：根据内容复杂度选择合适的表达方式。简单内容直接用段落描述，无需编号；复杂或多项内容可用层次编号（主层次用1.、2.、3.，子层次用①②③）。不要过度使用编号，避免机械感。不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。必须以自然段落形式输出，绝对不能使用表格（Tab分隔符）形式。对采购标的逐项描述时使用连贯的叙述语句，各品目用逗号和顿号自然连接。",
      },
      {
        key: "documentAcquireTime",
        label: "文件获取时间",
        placeholder: "起止时间选择（形成时间段）",
        type: "datetime-range",
        aiPrompt: "生成文件获取时间。规则：生成一个日期时间范围，起始为今天起往后推3-5个工作日（跳过周六日）的上午09:00，结束为起始日期往后推3-5个工作日的下午15:00。格式为'YYYY年MM月DD日HH:MM至YYYY年MM月DD日HH:MM'（如2026年03月23日09:00至2026年03月26日15:00），只输出该时间范围，不要其他说明。",
      },
      {
        key: "responseDeadline",
        label: "开标时间",
        // 原「响应文件提交截止时间」统一改「开标时间」（截止即开标），
        // 且不再支持填写文字——仅 datetime-local 选择时间
        type: "datetime",
        placeholder: "选择日期时间",
        aiPrompt: "生成开标时间。规则：从'文件获取时间'的结束日期往后推至少3个工作日（跳过周六日），取该工作日的下午14:00。格式为'YYYY年MM月DD日HH:MM'（如2026年7月1日14:00），只输出该日期时间，不要其他说明。",
      },
      { key: "bidOpeningPlace", label: "开标地点", placeholder: "请填写开标地点" },
      { key: "contactName", label: "联系人", placeholder: "请填写联系人" },
      { key: "contactAddress", label: "联系人地址", placeholder: "请填写联系人地址" },
      { key: "contactPhone", label: "联系电话", placeholder: "请填写联系电话", type: "tel", aiPrompt: "生成联系电话。只输出纯数字号码（如028-81753276或13812345678），不要添加'联系电话：'、'电话：'等任何前缀或说明文字。" },
      { key: "contactEmail", label: "联系邮箱", placeholder: "请填写联系邮箱", type: "email", aiPrompt: "生成联系邮箱。只输出纯邮箱地址（如example@company.com），不要添加'联系邮箱：'、'邮箱：'等任何前缀或说明文字。" },
      ...SUPERVISION_TENDER_FIELDS,
    ],
  },
  {
    key: "supplier",
    title: "供应商须知",
    description: "填写合同分包和现场踏勘。",
    fields: [
      {
        key: "contractSubcontracting",
        label: "合同分包",
        placeholder: "请输入合同分包具体要求",
        multiline: true,
        aiPrompt: "生成合同分包具体要求，说明分包的限制条件。",
        composite: {
          typeKey: "contractSubcontractingType",
          typeLabel: "是否允许分包",
          typeOptions: [
            { value: "none", label: "不允许" },
            { value: "allow", label: "允许" },
          ],
        },
      },
      {
        key: "siteSurvey",
        label: "是否组织现场踏勘",
        placeholder: "",
        toggle: {
          yesLabel: "是",
          noLabel: "否",
          yesValue: `（1）采购人不统一组织现场踏勘，提供坐标及公共交通图，供应商可自行踏勘；
（2）供应商自行承担踏勘现场发生的费用。
（3）除采购人的原因外，供应商自行负责在踏勘现场中所发生的人员伤亡和财产损失。
（4）采购人提供的工程场地和相关的周边环境情况，仅供供应商在编制响应文件时参考，采购人不对供应商据此作出的判断和决策负责。`,
          noValue: "/",
        },
      },
    ],
  },
  {
    key: "requirements",
    title: "采购需求",
    description: "填写商务要求和技术要求。",
    fields: [
      {
        key: "businessRequirements",
        label: "商务要求",
        placeholder: "请输入商务要求",
        multiline: true,
        aiPrompt: "根据项目类型生成商务要求，包含交付期限、付款方式、验收标准、售后服务等。要求：根据内容复杂度选择合适的表达方式。简单内容直接用段落描述，无需编号；复杂或多项内容可用层次编号（主层次用1.、2.、3.，子层次用①②③）。不要过度使用编号，避免机械感。不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。必须以自然段落形式输出，绝对不能使用表格（Tab分隔符）形式。对采购标的逐项描述时使用连贯的叙述语句，各品目用逗号和顿号自然连接。【关键要求】所有涉及天数、百分比、期限、比例、金额、数量等可量化指标的条款，必须根据项目类型、规模、行业惯例直接填入合理具体的数值，禁止出现下划线占位符（如____、空格留白、横线、括号待填等），也禁止出现「待定」「另行约定」等模糊表述。例如：交付期限根据项目规模填「合同签订后30日内」或「60日历天」；违约金按行业惯例填「每日按合同总价的1‰」；付款方式填「预付款30%、到货验收后付至90%、质保金10%」；质保期根据设备类型填「12个月」或「24个月」；响应时间填「2小时内响应、24小时内到场」。数值须具体且符合该类项目的实际惯例，不要全部使用相同默认值，应根据项目特征差异化设置。",
      },
      {
        key: "technicalRequirements",
        label: "技术要求",
        placeholder: "请输入技术要求",
        multiline: true,
        aiPrompt: "根据项目类型生成技术要求，包含技术标准、性能参数、质量要求等。要求：根据内容复杂度选择合适的表达方式。简单内容直接用段落描述，无需编号；复杂或多项内容可用层次编号（主层次用1.、2.、3.，子层次用①②③）。不要过度使用编号，避免机械感。不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。必须以自然段落形式输出，绝对不能使用表格（Tab分隔符）形式。对采购标的逐项描述时使用连贯的叙述语句，各品目用逗号和顿号自然连接。【关键要求】所有涉及技术参数、规格、数值、公差、等级等可量化指标的条款，必须根据项目类型、设备/服务特征、行业规范直接填入合理具体的数值，禁止出现下划线占位符（如____、空格留白、横线、括号待填等），也禁止出现「待定」「详见厂家资料」「按相关标准」等模糊或推诿表述。例如：设备参数填「额定功率75kW」「钻进深度≥800m」「精度等级±0.5%」；材料规格填「DN200」「壁厚6mm」「抗压强度C30」；性能指标填「处理水量≥100m³/h」「效率≥95%」「防护等级IP65」。数值须具体且符合该类项目的技术规范，可根据项目名称中体现的规模和型号进行合理推断，不要全部使用相同默认值。",
      },
    ],
  },
  {
    key: "quotation",
    title: "响应文件格式",
    description: "填写报价表内容。",
    fields: [
      {
        key: "quotationLetter",
        label: "报价表",
        placeholder: "",
        quotationType: {
          options: [
            { value: "text", label: "填入文字" },
            { value: "table", label: "设计表格" },
          ],
        },
        aiPrompt: "本部分是针对各项采购物品的报价清单，以供应商口吻呈现（即供应商填报的报价单）。删除一切说明性条款、抬头（如 致：××）和落款尾缀（如 投标人盖章、法定代表人或授权代表签字、日期），只保留具体采购事项及其报价：依据项目采购内容逐项列出物品的名称、规格型号、单位、数量，并设报价栏（单价、合价）以 ____ 留空供供应商填写，不得编造金额。条目清晰即可，不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。必须以制表符（Tab 键）分隔各项各列，列序为 名称、规格型号、单位、数量、单价、合价（单价和合价留空），不写表头行。",
      },
    ],
  },
];

export function createEmptyCompetitiveNegotiationDraft(): CompetitiveNegotiationDraft {
  return {
    projectName: "",
    coverDate: currentYearMonth(),
    projectOverview: "",
    procurementContent: "",
    maxPrice: "",
    submissionRequirements: "",
    submissionRequirementsType: "",
    qualificationRequirements: "",
    documentAcquireTime: "",
    responseDeadline: "",
    responseDeadlineType: "",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    bidOpeningPlace: "",
    contactAddress: "",
    supervisionDepartment: "",
    supervisionAddress: "",
    supervisionContact: "",
    supervisionPhone: "",
    contractSubcontracting: "",
    contractSubcontractingType: "",
    siteSurvey: "",
    siteSurveyType: "",
    businessRequirements: "",
    technicalRequirements: "",
    quotationLetter: "",
    quotationLetterType: "table", // 报价表优先表格模式
  };
}

export const SINGLE_SOURCE_SECTIONS: TenderSectionConfig[] = [
  {
    key: "cover",
    title: "封面",
    description: "填写封面的项目名称和封面时间。",
    fields: [
      { key: "projectName", label: "项目名称", placeholder: "请输入项目名称" },
      { key: "coverDate", label: "封面时间", placeholder: "例如 2026-05", type: "month" },
    ],
  },
  {
    key: "invitation",
    title: "邀请函",
    description: "填写供应商、预算、期限、获取文件和联系方式。",
    fields: [
      { key: "supplierName", label: "供应商名称", placeholder: "请输入供应商名称" },
      { key: "projectBudget", label: "项目预算价格", placeholder: "例如 680000 元" },
      {
        key: "projectDuration",
        label: "项目完成期限",
        // 不再支持选择时间——纯文字填写，AI 一键生成随其他字段直接产出
        placeholder: "例如 自合同签订之日起 60 日内完成",
        aiPrompt: "生成项目完成期限。规则：直接输出完成期限的内容本身（如“自合同签订之日起 60 日内完成”），严禁在开头重复“项目完成期限：”作为前缀，也不要输出任何其他说明文字。",
      },
      { key: "documentAcquireTime", label: "采购文件获取时间", placeholder: "请输入采购文件获取时间", aiPrompt: "生成采购文件获取时间。规则：生成一个日期时间范围，起始为今天起往后推3-5个工作日（跳过周六日）的上午09:00，结束为起始日期往后推3-5个工作日的下午15:00。格式为'YYYY年MM月DD日HH:MM至YYYY年MM月DD日HH:MM'（如2026年03月23日09:00至2026年03月26日15:00），只输出该时间范围，不要其他说明。" },
      { key: "documentPrice", label: "采购文件售价", placeholder: "例如 0 元", aiPrompt: "生成采购文件售价。本公司电子采购文件免费提供，只输出数字 0，不要添加元、元/份等单位或任何说明。" },
      {
        key: "submissionAndNegotiationTime",
        label: "开标时间",
        // 原「递交和谈判时间」统一改「开标时间」，仅支持时间选择
        type: "datetime",
        placeholder: "选择日期时间",
        aiPrompt: "生成开标时间。规则：从今天起往后推3-5个工作日（跳过周六日）。格式为'YYYY年MM月DD日HH:MM'（如2026年05月28日09:00），只输出一个具体时间，不要其他说明。",
      },
      { key: "bidOpeningPlace", label: "开标地点", placeholder: "请填写开标地点" },
      { key: "contactName", label: "联系人", placeholder: "请填写联系人" },
      { key: "contactAddress", label: "联系人地址", placeholder: "请填写联系人地址" },
      { key: "contactEmail", label: "联系邮箱", placeholder: "请填写联系邮箱", type: "email", aiPrompt: "生成联系邮箱。只输出纯邮箱地址（如example@company.com），不要添加'联系邮箱：'、'邮箱：'等任何前缀或说明文字。" },
      { key: "contactPhone", label: "联系电话", placeholder: "请填写联系电话", type: "tel", aiPrompt: "生成联系电话。只输出纯数字号码（如028-81753276或13812345678），不要添加'联系电话：'、'电话：'等任何前缀或说明文字。" },
    ],
  },
  {
    key: "terms",
    title: "响应文件构成第五项",
    description: "选择是否添加服务内容。",
    fields: [
      {
        key: "serviceContent",
        label: "服务内容",
        placeholder: "",
        toggle: {
          yesLabel: "添加",
          noLabel: "不添加",
          yesValue: "⑤服务内容",
          noValue: "",
        },
        typeKey: "serviceContentType",
      },
    ],
  },
  {
    key: "procurement",
    title: "采购内容及要求",
    description: "填写采购内容与采购要求。",
    fields: [
      {
        key: "procurementContent",
        label: "采购内容",
        placeholder: "请输入采购内容",
        multiline: true,
        aiPrompt: PROCUREMENT_CONTENT_AI_PROMPT,
      },
      {
        key: "procurementRequirements",
        label: "采购要求",
        placeholder: "请输入采购要求",
        multiline: true,
        aiPrompt: "根据采购内容生成采购要求，包含质量标准、交付要求、验收条件等。要求：根据内容复杂度选择合适的表达方式。简单内容直接用段落描述，无需编号；复杂或多项内容可用层次编号（主层次用1.、2.、3.，子层次用①②③）。不要过度使用编号，避免机械感。不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。必须以自然段落形式输出，绝对不能使用表格（Tab分隔符）形式。对采购标的逐项描述时使用连贯的叙述语句，各品目用逗号和顿号自然连接。",
      },
    ],
  },
  {
    key: "response",
    title: "响应文件格式",
    description: "填写报价函内容。",
    fields: [
      {
        key: "quotationLetter",
        label: "报价函",
        placeholder: "",
        quotationType: {
          options: [
            { value: "text", label: "填入文字" },
            { value: "table", label: "设计表格" },
          ],
        },
        aiPrompt: "本部分是报价函中针对各项采购物品的报价清单，以供应商口吻呈现（即供应商填报的报价单）。删除一切说明性条款、抬头（如 致：××）和落款尾缀（如 投标人盖章、法定代表人或授权代表签字、日期），只保留具体采购事项及其报价：依据项目采购内容逐项列出物品的名称、规格型号、单位、数量，并设报价栏（单价、合价）以 ____ 留空供供应商填写，不得编造金额。条目清晰即可，不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。必须以制表符（Tab 键）分隔各项各列，列序为 名称、规格型号、单位、数量、单价、合价（单价和合价留空），不写表头行。",
      },
    ],
  },
];

export function createEmptySingleSourceDraft(): SingleSourceDraft {
  return {
    projectName: "",
    coverDate: currentYearMonth(),
    supplierName: "",
    projectBudget: "",
    projectDuration: "",
    documentAcquireTime: "",
    documentPrice: "0",
    submissionAndNegotiationTime: "",
    submissionAndNegotiationTimeType: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    bidOpeningPlace: "",
    contactAddress: "",
    serviceContent: "",
    serviceContentType: "",
    procurementContent: "",
    procurementRequirements: "",
    quotationLetter: "",
    quotationLetterType: "table", // 报价表优先表格模式
  };
}

/**
 * 询比采购章节（2026-10-29 模板 v2）：与竞价六章制同构（封面/采购邀请/供应商须知/
 * 评审程序和评定成交的标准/采购需求/响应文件格式）。差异：评审方法固定综合评分法
 * （无选择器），第④节为「综合评分法评审标准」结构化评分行编辑器；供应商须知无
 * 「评标委员会人数」（模板固定询比小组 3 人以上单数，无占位符）。
 */
export const INQUIRY_PURCHASE_SECTIONS: TenderSectionConfig[] = [
  {
    key: "cover",
    title: "封面",
    description: "填写封面的项目名称和封面时间。",
    fields: [
      { key: "projectName", label: "项目名称", placeholder: "请输入项目名称" },
      { key: "coverDate", label: "封面时间", placeholder: "例如 2026-05", type: "month" },
    ],
  },
  {
    key: "invitation",
    title: "采购邀请",
    description: "填写项目信息、时间要求和联系方式。",
    fields: [
      {
        key: "projectOverview",
        label: "项目概况和采购内容",
        placeholder: "请输入项目概况和采购内容",
        multiline: true,
        aiPrompt: PROJECT_OVERVIEW_AI_PROMPT,
      },
      {
        key: "maxPrice",
        label: "最高限价",
        placeholder: "例如 350000",
        aiPrompt: "根据项目概况和采购内容，建议合理的最高限价，只输出纯数字金额。",
      },
      {
        key: "submissionRequirements",
        label: "提交成果要求",
        placeholder: "请输入提交成果要求",
        multiline: true,
        aiPrompt: "根据项目类型生成提交成果要求，描述成果形式、数量、质量要求等。不要包含'5.提交成果要求：'这样的标题或前缀，只输出提交成果要求正文。",
        composite: {
          typeKey: "submissionRequirementsType",
          typeLabel: "是否有提交成果要求",
          typeOptions: [
            { value: "none", label: "无" },
            { value: "have", label: "有" },
          ],
        },
      },
      {
        key: "qualificationRequirements",
        label: "特定资质要求",
        placeholder: "请输入特定资质要求",
        multiline: true,
        aiPrompt: "根据项目类型生成特定资质要求，包含资质证书、业绩要求、人员配置等。",
      },
      {
        key: "consortiumForm",
        label: "联合体形式",
        placeholder: "请输入联合体形式具体要求",
        multiline: true,
        aiPrompt: "生成联合体形式具体要求，说明联合体的组成要求和各方责任。",
        composite: {
          typeKey: "consortiumFormType",
          typeLabel: "是否接受联合体",
          typeOptions: [
            { value: "accept", label: "接受" },
            { value: "reject", label: "不接受" },
          ],
        },
      },
      {
        key: "documentAcquireTime",
        label: "文件获取时间",
        placeholder: "起止时间选择（形成时间段）",
        type: "datetime-range",
        aiPrompt: "生成文件获取时间。规则：生成一个日期时间范围，起始为今天起往后推3-5个工作日（跳过周六日）的上午09:00，结束为起始日期往后推3-5个工作日的下午15:00。格式为'YYYY年MM月DD日HH:MM至YYYY年MM月DD日HH:MM'（如2026年03月23日09:00至2026年03月26日15:00），只输出该时间范围，不要其他说明。",
      },
      { key: "documentPrice", label: "采购文件售价", placeholder: "例如 0 元", aiPrompt: "生成采购文件售价。本公司电子采购文件免费提供，只输出数字 0，不要添加元、元/份等单位或任何说明。" },
      {
        key: "responseSubmissionTime",
        label: "开标时间",
        type: "datetime",
        placeholder: "选择日期时间",
        aiPrompt: "生成开标时间。规则：从'文件获取时间'的结束日期往后推至少3个工作日（跳过周六日），取该工作日的下午14:00。格式为'YYYY年MM月DD日HH:MM'（如2026年7月1日14:00），只输出该日期时间，不要其他说明。",
      },
      { key: "bidOpeningPlace", label: "开标地点", placeholder: "请填写开标地点" },
      { key: "contactName", label: "联系人", placeholder: "请填写联系人" },
      { key: "contactAddress", label: "联系人地址", placeholder: "请填写联系人地址" },
      { key: "contactPhone", label: "联系电话", placeholder: "请填写联系电话", type: "tel", aiPrompt: "生成联系电话。只输出纯数字号码（如028-81753276或13812345678），不要添加'联系电话：'、'电话：'等任何前缀或说明文字。" },
      { key: "contactEmail", label: "联系邮箱", placeholder: "请填写联系邮箱", type: "email", aiPrompt: "生成联系邮箱。只输出纯邮箱地址（如example@company.com），不要添加'联系邮箱：'、'邮箱：'等任何前缀或说明文字。" },
      ...SUPERVISION_TENDER_FIELDS,
    ],
  },
  {
    key: "supplier",
    title: "供应商须知",
    description: "填写保证金、分包和踏勘信息。",
    fields: [
      {
        key: "responseDepositType",
        label: "响应保证金",
        placeholder: "",
        toggle: {
          yesLabel: "收取",
          noLabel: "不收取",
          yesValue: "collect",
          noValue: "none",
        },
      },
      {
        key: "responseDepositAmount",
        label: "响应保证金金额",
        placeholder: "请输入金额（小写数字）",
        aiPrompt: "生成响应保证金金额。只输出一个纯阿拉伯数字（单位为元，如 50000），不要包含元、万元、人民币等任何单位，不要大写金额，不要标点、空格或任何说明文字。金额为具体数值，原则上不超过项目预算金额的2%。",
        composite: {
          typeKey: "responseDepositType",
          typeLabel: "",
          typeOptions: [
            { value: "collect", label: "收取" },
            { value: "none", label: "不收取" },
          ],
        },
      },
      {
        key: "responseDepositForm",
        label: "响应保证金形式",
        placeholder: "",
        select: {
          options: [
            { value: "cash", label: "现金（电汇、银行转账、汇票、支票）" },
            { value: "bank_guarantee", label: "银行保函" },
            { value: "guarantee_institution", label: "担保机构保函" },
            { value: "insurance", label: "保险公司保证保险" },
            { value: "other", label: "其他" },
          ],
        },
      },
      {
        key: "responseDepositBankInfo",
        label: "收取响应保证金的账号信息",
        placeholder: "请输入账号名称、开户银行及账号",
        multiline: true,
      },
      {
        key: "responseDepositOtherForm",
        label: "其他保证金形式说明",
        placeholder: "请输入其他形式说明",
      },
      {
        key: "responseDepositOtherRequirement",
        label: "响应保证金其他要求",
        placeholder: "请输入其他要求（无则保留 /）",
        multiline: true,
      },
      {
        key: "responseDepositNonRefundType",
        label: "响应保证金不予退还的情形",
        placeholder: "",
        toggle: {
          yesLabel: "有",
          noLabel: "无",
          yesValue: "have",
          noValue: "none",
        },
      },
      {
        key: "responseDepositNonRefundContent",
        label: "响应保证金不予退还具体情形",
        placeholder: "请输入不予退还的具体情形",
        multiline: true,
      },
      {
        key: "performanceDepositType",
        label: "履约保证金",
        placeholder: "",
        toggle: {
          yesLabel: "收取",
          noLabel: "不收取",
          yesValue: "collect",
          noValue: "none",
        },
      },
      {
        key: "performanceDepositAmount",
        label: "履约保证金金额",
        placeholder: "请输入金额（小写数字）",
        aiPrompt: "生成履约保证金金额。只输出一个纯阿拉伯数字（单位为元，如 50000），不要包含元、万元、人民币等任何单位，不要大写金额，不要标点、空格或任何说明文字。金额为具体数值，原则上不超过合同金额的10%折算所得金额。",
      },
      {
        key: "performanceDepositForm",
        label: "履约保证金形式",
        placeholder: "",
        select: {
          options: [
            { value: "cash", label: "现金（电汇、银行转账、汇票、支票）" },
            { value: "bank_guarantee", label: "银行保函" },
            { value: "guarantee_institution", label: "担保机构保函" },
            { value: "insurance", label: "保险公司保证保险" },
            { value: "other", label: "其他" },
          ],
        },
      },
      {
        key: "performanceDepositOtherForm",
        label: "其他履约保证金形式说明",
        placeholder: "请输入其他形式说明",
      },
      {
        key: "contractSubcontracting",
        label: "合同分包",
        placeholder: "请输入合同分包具体要求",
        multiline: true,
        aiPrompt: "生成合同分包具体要求，说明分包的限制条件。",
        composite: {
          typeKey: "contractSubcontractingType",
          typeLabel: "是否允许分包",
          typeOptions: [
            { value: "none", label: "不允许" },
            { value: "allow", label: "允许" },
          ],
        },
      },
      {
        key: "siteSurvey",
        label: "是否组织现场踏勘",
        placeholder: "",
        toggle: {
          yesLabel: "是",
          noLabel: "否",
          yesValue: `（1）采购人不统一组织现场踏勘，提供坐标及公共交通图，供应商可自行踏勘；
（2）供应商自行承担踏勘现场发生的费用。
（3）除采购人的原因外，供应商自行负责在踏勘现场中所发生的人员伤亡和财产损失。
（4）采购人提供的工程场地和相关的周边环境情况，仅供供应商在编制响应文件时参考，采购人不对外自行踏勘作出的判断和决策负责。`,
          noValue: "/",
        },
      },
      {
        key: "copyCount",
        label: "副本份数",
        placeholder: "根据最高限价自动确定",
        aiPrompt: "根据最高限价确定响应文件副本份数：1000000元以下为4份，1000000元及以上为6份。只输出纯数字。",
      },
    ],
  },
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
  {
    key: "requirements",
    title: "采购需求",
    description: "填写商务要求和技术要求。",
    fields: [
      {
        key: "businessRequirements",
        label: "商务要求",
        placeholder: "请输入商务要求",
        multiline: true,
        aiPrompt: "根据项目类型生成商务要求，包含交付期限、付款方式、验收标准、售后服务等。要求：根据内容复杂度选择合适的表达方式。简单内容直接用段落描述，无需编号；复杂或多项内容可用层次编号（主层次用1.、2.、3.，子层次用①②③）。不要过度使用编号，避免机械感。不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。必须以自然段落形式输出，绝对不能使用表格（Tab分隔符）形式。对采购标的逐项描述时使用连贯的叙述语句，各品目用逗号和顿号自然连接。【关键要求】所有涉及天数、百分比、期限、比例、金额、数量等可量化指标的条款，必须根据项目类型、规模、行业惯例直接填入合理具体的数值，禁止出现下划线占位符（如____、空格留白、横线、括号待填等），也禁止出现「待定」「另行约定」等模糊表述。例如：交付期限根据项目规模填「合同签订后30日内」或「60日历天」；违约金按行业惯例填「每日按合同总价的1‰」；付款方式填「预付款30%、到货验收后付至90%、质保金10%」；质保期根据设备类型填「12个月」或「24个月」；响应时间填「2小时内响应、24小时内到场」。数值须具体且符合该类项目的实际惯例，不要全部使用相同默认值，应根据项目特征差异化设置。",
      },
      {
        key: "technicalRequirements",
        label: "技术要求",
        placeholder: "请输入技术要求",
        multiline: true,
        aiPrompt: "根据项目类型生成技术要求，包含技术标准、性能参数、质量要求等。要求：根据内容复杂度选择合适的表达方式。简单内容直接用段落描述，无需编号；复杂或多项内容可用层次编号（主层次用1.、2.、3.，子层次用①②③）。不要过度使用编号，避免机械感。不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。必须以自然段落形式输出，绝对不能使用表格（Tab分隔符）形式。对采购标的逐项描述时使用连贯的叙述语句，各品目用逗号和顿号自然连接。【关键要求】所有涉及技术参数、规格、数值、公差、等级等可量化指标的条款，必须根据项目类型、设备/服务特征、行业规范直接填入合理具体的数值，禁止出现下划线占位符（如____、空格留白、横线、括号待填等），也禁止出现「待定」「详见厂家资料」「按相关标准」等模糊或推诿表述。例如：设备参数填「额定功率75kW」「钻进深度≥800m」「精度等级±0.5%」；材料规格填「DN200」「壁厚6mm」「抗压强度C30」；性能指标填「处理水量≥100m³/h」「效率≥95%」「防护等级IP65」。数值须具体且符合该类项目的技术规范，可根据项目名称中体现的规模和型号进行合理推断，不要全部使用相同默认值。",
      },
    ],
  },
  {
    key: "quotation",
    title: "响应文件格式",
    description: "填写报价表内容。",
    fields: [
      {
        key: "quotationLetter",
        label: "报价表",
        placeholder: "",
        quotationType: {
          options: [
            { value: "text", label: "填入文字" },
            { value: "table", label: "设计表格" },
          ],
        },
        aiPrompt: "本部分是针对各项采购物品的报价清单，以供应商口吻呈现（即供应商填报的报价单）。删除一切说明性条款、抬头（如 致：××）和落款尾缀（如 投标人盖章、法定代表人或授权代表签字、日期），只保留具体采购事项及其报价：依据项目采购内容逐项列出物品的名称、规格型号、单位、数量，并设报价栏（单价、合价）以 ____ 留空供供应商填写，不得编造金额。条目清晰即可，不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。必须以制表符（Tab 键）分隔各项各列，列序为 名称、规格型号、单位、数量、单价、合价（单价和合价留空），不写表头行。",
      },
    ],
  },
];

export function createEmptyInquiryPurchaseDraft(): InquiryPurchaseDraft {
  return {
    projectName: "",
    coverDate: currentYearMonth(),
    projectOverview: "",
    procurementContent: "",
    maxPrice: "",
    submissionRequirements: "",
    submissionRequirementsType: "",
    qualificationRequirements: "",
    consortiumForm: "",
    consortiumFormType: "",
    documentAcquireTime: "",
    documentPrice: "0",
    responseSubmissionTime: "",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    bidOpeningPlace: "",
    contactAddress: "",
    supervisionDepartment: "",
    supervisionAddress: "",
    supervisionContact: "",
    supervisionPhone: "",
    responseDepositType: "",
    responseDepositAmount: "",
    responseDepositForm: "",
    responseDepositBankInfo: "",
    responseDepositOtherForm: "",
    responseDepositOtherRequirement: "/",
    responseDepositNonRefundType: "",
    responseDepositNonRefundContent: "",
    performanceDepositType: "",
    performanceDepositAmount: "",
    performanceDepositForm: "",
    performanceDepositOtherForm: "",
    contractSubcontracting: "",
    contractSubcontractingType: "",
    siteSurvey: "",
    siteSurveyType: "",
    copyCount: "",
    businessRequirements: "",
    technicalRequirements: "",
    quotationLetter: "",
    quotationLetterType: "table", // 报价表优先表格模式
  };
}

export function createEmptyTenderDrafts(): TenderDraftsState {
  return {
    COMPETITIVE_NEGOTIATION: createEmptyCompetitiveNegotiationDraft(),
    INTERNAL_BIDDING: createEmptyInternalBiddingDraft(),
    INQUIRY_PURCHASE: createEmptyInquiryPurchaseDraft(),
    SINGLE_SOURCE: createEmptySingleSourceDraft(),
    INVITED_BIDDING: createEmptyInvitedBiddingDraft(),
  };
}

export const INTERNAL_BIDDING_SECTIONS: TenderSectionConfig[] = [
  {
    key: "cover",
    title: "封面",
    description: "填写封面的项目名称和封面时间。",
    fields: [
      { key: "projectName", label: "项目名称", placeholder: "请输入项目名称" },
      { key: "coverDate", label: "封面时间", placeholder: "例如 2026-05", type: "month" },
    ],
  },
  {
    key: "invitation",
    title: "采购邀请",
    description: "填写项目信息、时间要求和联系方式。",
    fields: [
      {
        key: "projectOverview",
        label: "项目概况和采购内容",
        placeholder: "请输入项目概况和采购内容",
        multiline: true,
        aiPrompt: PROJECT_OVERVIEW_AI_PROMPT,
      },
      {
        key: "maxPrice",
        label: "最高限价",
        placeholder: "例如 350000",
        aiPrompt: "根据项目概况和采购内容，建议合理的最高限价，只输出纯数字金额。",
      },
      {
        key: "submissionRequirements",
        label: "提交成果要求",
        placeholder: "请输入提交成果要求",
        multiline: true,
        aiPrompt: "根据项目类型生成提交成果要求，描述成果形式、数量、质量要求等。不要包含'5.提交成果要求：'这样的标题或前缀，只输出提交成果要求正文。",
        composite: {
          typeKey: "submissionRequirementsType",
          typeLabel: "是否有提交成果要求",
          typeOptions: [
            { value: "none", label: "无" },
            { value: "have", label: "有" },
          ],
        },
      },
      {
        key: "qualificationRequirements",
        label: "特定资质要求",
        placeholder: "请输入特定资质要求",
        multiline: true,
        aiPrompt: "根据项目类型生成特定资质要求，包含资质证书、业绩要求、人员配置等。",
      },
      {
        key: "consortiumForm",
        label: "联合体形式",
        placeholder: "请输入联合体形式具体要求",
        multiline: true,
        aiPrompt: "生成联合体形式具体要求，说明联合体的组成要求和各方责任。",
        composite: {
          typeKey: "consortiumFormType",
          typeLabel: "是否接受联合体",
          typeOptions: [
            { value: "accept", label: "接受" },
            { value: "reject", label: "不接受" },
          ],
        },
      },
      {
        key: "documentAcquireTime",
        label: "文件获取时间",
        placeholder: "起止时间选择（形成时间段）",
        type: "datetime-range",
        aiPrompt: "生成文件获取时间。规则：生成一个日期时间范围，起始为今天起往后推3-5个工作日（跳过周六日）的上午09:00，结束为起始日期往后推3-5个工作日的下午15:00。格式为'YYYY年MM月DD日HH:MM至YYYY年MM月DD日HH:MM'（如2026年03月23日09:00至2026年03月26日15:00），只输出该时间范围，不要其他说明。",
      },
      { key: "documentPrice", label: "采购文件售价", placeholder: "例如 0 元", aiPrompt: "生成采购文件售价。本公司电子采购文件免费提供，只输出数字 0，不要添加元、元/份等单位或任何说明。" },
      {
        key: "responseSubmissionTime",
        label: "开标时间",
        // 原「响应文件提交时间」统一改「开标时间」，仅支持时间选择
        type: "datetime",
        placeholder: "选择日期时间",
        aiPrompt: "生成开标时间。规则：从'文件获取时间'的结束日期往后推至少3个工作日（跳过周六日），取该工作日的下午14:00。格式为'YYYY年MM月DD日HH:MM'（如2026年7月1日14:00），只输出该日期时间，不要其他说明。",
      },
      { key: "bidOpeningPlace", label: "开标地点", placeholder: "请填写开标地点" },
      { key: "contactName", label: "联系人", placeholder: "请填写联系人" },
      { key: "contactAddress", label: "联系人地址", placeholder: "请填写联系人地址" },
      { key: "contactPhone", label: "联系电话", placeholder: "请填写联系电话", type: "tel", aiPrompt: "生成联系电话。只输出纯数字号码（如028-81753276或13812345678），不要添加'联系电话：'、'电话：'等任何前缀或说明文字。" },
      { key: "contactEmail", label: "联系邮箱", placeholder: "请填写联系邮箱", type: "email", aiPrompt: "生成联系邮箱。只输出纯邮箱地址（如example@company.com），不要添加'联系邮箱：'、'邮箱：'等任何前缀或说明文字。" },
      ...SUPERVISION_TENDER_FIELDS,
    ],
  },
  {
    key: "supplier",
    title: "供应商须知",
    description: "填写保证金、分包和踏勘信息。",
    fields: [
      {
        key: "responseDepositType",
        label: "响应保证金",
        placeholder: "",
        toggle: {
          yesLabel: "收取",
          noLabel: "不收取",
          yesValue: "collect",
          noValue: "none",
        },
      },
      {
        key: "responseDepositAmount",
        label: "响应保证金金额",
        placeholder: "请输入金额（小写数字）",
        aiPrompt: "生成响应保证金金额。只输出一个纯阿拉伯数字（单位为元，如 50000），不要包含元、万元、人民币等任何单位，不要大写金额，不要标点、空格或任何说明文字。金额为具体数值，原则上不超过项目预算金额的2%。",
        composite: {
          typeKey: "responseDepositType",
          typeLabel: "",
          typeOptions: [
            { value: "collect", label: "收取" },
            { value: "none", label: "不收取" },
          ],
        },
      },
      {
        key: "responseDepositForm",
        label: "响应保证金形式",
        placeholder: "",
        select: {
          options: [
            { value: "cash", label: "现金（电汇、银行转账、汇票、支票）" },
            { value: "bank_guarantee", label: "银行保函" },
            { value: "guarantee_institution", label: "担保机构保函" },
            { value: "insurance", label: "保险公司保证保险" },
            { value: "other", label: "其他" },
          ],
        },
      },
      {
        key: "responseDepositBankInfo",
        label: "收取响应保证金的账号信息",
        placeholder: "请输入账号名称、开户银行及账号",
        multiline: true,
      },
      {
        key: "responseDepositOtherForm",
        label: "其他保证金形式说明",
        placeholder: "请输入其他形式说明",
      },
      {
        // 2026-10-29 用户裁定：去「无/有」选择器（原 composite 整行永不显示=死字段），
        // 纯输入框、默认值 "/"（初始草稿置 "/"，无其他要求保留、有则改写）
        key: "responseDepositOtherRequirement",
        label: "响应保证金其他要求",
        placeholder: "请输入其他要求（无则保留 /）",
        multiline: true,
      },
      {
        key: "responseDepositNonRefundType",
        label: "响应保证金不予退还的情形",
        placeholder: "",
        toggle: {
          yesLabel: "有",
          noLabel: "无",
          yesValue: "have",
          noValue: "none",
        },
      },
      {
        key: "responseDepositNonRefundContent",
        label: "响应保证金不予退还具体情形",
        placeholder: "请输入不予退还的具体情形",
        multiline: true,
      },
      {
        key: "performanceDepositType",
        label: "履约保证金",
        placeholder: "",
        toggle: {
          yesLabel: "收取",
          noLabel: "不收取",
          yesValue: "collect",
          noValue: "none",
        },
      },
      {
        key: "performanceDepositAmount",
        label: "履约保证金金额",
        placeholder: "请输入金额（小写数字）",
        aiPrompt: "生成履约保证金金额。只输出一个纯阿拉伯数字（单位为元，如 50000），不要包含元、万元、人民币等任何单位，不要大写金额，不要标点、空格或任何说明文字。金额为具体数值，原则上不超过合同金额的10%折算所得金额。",
      },
      {
        key: "performanceDepositForm",
        label: "履约保证金形式",
        placeholder: "",
        select: {
          options: [
            { value: "cash", label: "现金（电汇、银行转账、汇票、支票）" },
            { value: "bank_guarantee", label: "银行保函" },
            { value: "guarantee_institution", label: "担保机构保函" },
            { value: "insurance", label: "保险公司保证保险" },
            { value: "other", label: "其他" },
          ],
        },
      },
      {
        key: "performanceDepositOtherForm",
        label: "其他履约保证金形式说明",
        placeholder: "请输入其他形式说明",
      },
      {
        key: "contractSubcontracting",
        label: "合同分包",
        placeholder: "请输入合同分包具体要求",
        multiline: true,
        aiPrompt: "生成合同分包具体要求，说明分包的限制条件。",
        composite: {
          typeKey: "contractSubcontractingType",
          typeLabel: "是否允许分包",
          typeOptions: [
            { value: "none", label: "不允许" },
            { value: "allow", label: "允许" },
          ],
        },
      },
      {
        key: "siteSurvey",
        label: "是否组织现场踏勘",
        placeholder: "",
        toggle: {
          yesLabel: "是",
          noLabel: "否",
          yesValue: `（1）采购人不统一组织现场踏勘，提供坐标及公共交通图，供应商可自行踏勘；
（2）供应商自行承担踏勘现场发生的费用。
（3）除采购人的原因外，供应商自行负责在踏勘现场中所发生的人员伤亡和财产损失。
（4）采购人提供的工程场地和相关的周边环境情况，仅供供应商在编制响应文件时参考，采购人不对供应商据此作出的判断和决策负责。`,
          noValue: "/",
        },
      },
      {
        key: "copyCount",
        label: "副本份数",
        placeholder: "根据最高限价自动确定",
        aiPrompt: "根据最高限价确定响应文件副本份数：1000000元以下为4份，1000000元及以上为6份。只输出纯数字。",
      },
      {
        key: "evaluationCommitteeCount",
        label: "评标委员会人数",
        placeholder: "根据最高限价自动确定",
        aiPrompt: "根据最高限价确定评标委员会人数：1000000元以下为5人，1000000元及以上为7人。只输出纯数字。",
      },
    ],
  },
  {
    key: "evaluation",
    title: "评标程序和评定成交的标准",
    description: "选择本项目采用的评标方法。",
    fields: [
      {
        key: "evaluationMethod",
        label: "评标方法",
        placeholder: "",
        select: {
          options: [
            { value: "综合评分法", label: "综合评分法" },
            { value: "最低评标价法", label: "最低评标价法" },
          ],
        },
      },
    ],
  },
  {
    key: "requirements",
    title: "采购需求",
    description: "填写商务要求和技术要求。",
    fields: [
      {
        key: "businessRequirements",
        label: "商务要求",
        placeholder: "请输入商务要求",
        multiline: true,
        aiPrompt: "根据项目类型生成商务要求，包含交付期限、付款方式、验收标准、售后服务等。要求：根据内容复杂度选择合适的表达方式。简单内容直接用段落描述，无需编号；复杂或多项内容可用层次编号（主层次用1.、2.、3.，子层次用①②③）。不要过度使用编号，避免机械感。不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。必须以自然段落形式输出，绝对不能使用表格（Tab分隔符）形式。对采购标的逐项描述时使用连贯的叙述语句，各品目用逗号和顿号自然连接。【关键要求】所有涉及天数、百分比、期限、比例、金额、数量等可量化指标的条款，必须根据项目类型、规模、行业惯例直接填入合理具体的数值，禁止出现下划线占位符（如____、空格留白、横线、括号待填等），也禁止出现「待定」「另行约定」等模糊表述。例如：交付期限根据项目规模填「合同签订后30日内」或「60日历天」；违约金按行业惯例填「每日按合同总价的1‰」；付款方式填「预付款30%、到货验收后付至90%、质保金10%」；质保期根据设备类型填「12个月」或「24个月」；响应时间填「2小时内响应、24小时内到场」。数值须具体且符合该类项目的实际惯例，不要全部使用相同默认值，应根据项目特征差异化设置。",
      },
      {
        key: "technicalRequirements",
        label: "技术要求",
        placeholder: "请输入技术要求",
        multiline: true,
        aiPrompt: "根据项目类型生成技术要求，包含技术标准、性能参数、质量要求等。要求：根据内容复杂度选择合适的表达方式。简单内容直接用段落描述，无需编号；复杂或多项内容可用层次编号（主层次用1.、2.、3.，子层次用①②③）。不要过度使用编号，避免机械感。不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。必须以自然段落形式输出，绝对不能使用表格（Tab分隔符）形式。对采购标的逐项描述时使用连贯的叙述语句，各品目用逗号和顿号自然连接。【关键要求】所有涉及技术参数、规格、数值、公差、等级等可量化指标的条款，必须根据项目类型、设备/服务特征、行业规范直接填入合理具体的数值，禁止出现下划线占位符（如____、空格留白、横线、括号待填等），也禁止出现「待定」「详见厂家资料」「按相关标准」等模糊或推诿表述。例如：设备参数填「额定功率75kW」「钻进深度≥800m」「精度等级±0.5%」；材料规格填「DN200」「壁厚6mm」「抗压强度C30」；性能指标填「处理水量≥100m³/h」「效率≥95%」「防护等级IP65」。数值须具体且符合该类项目的技术规范，可根据项目名称中体现的规模和型号进行合理推断，不要全部使用相同默认值。",
      },
    ],
  },
  {
    key: "quotation",
    title: "响应文件格式",
    description: "填写报价表内容。",
    fields: [
      {
        key: "quotationLetter",
        label: "报价表",
        placeholder: "",
        quotationType: {
          options: [
            { value: "text", label: "填入文字" },
            { value: "table", label: "设计表格" },
          ],
        },
        aiPrompt: "本部分是针对各项采购物品的报价清单，以供应商口吻呈现（即供应商填报的报价单）。删除一切说明性条款、抬头（如 致：××）和落款尾缀（如 投标人盖章、法定代表人或授权代表签字、日期），只保留具体采购事项及其报价：依据项目采购内容逐项列出物品的名称、规格型号、单位、数量，并设报价栏（单价、合价）以 ____ 留空供供应商填写，不得编造金额。条目清晰即可，不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。必须以制表符（Tab 键）分隔各项各列，列序为 名称、规格型号、单位、数量、单价、合价（单价和合价留空），不写表头行。",
      },
    ],
  },
];

export function createEmptyInternalBiddingDraft(): InternalBiddingDraft {
  return {
    projectName: "",
    coverDate: currentYearMonth(),
    projectOverview: "",
    procurementContent: "",
    maxPrice: "",
    submissionRequirements: "",
    submissionRequirementsType: "",
    qualificationRequirements: "",
    consortiumForm: "",
    consortiumFormType: "",
    documentAcquireTime: "",
    documentPrice: "0",
    responseSubmissionTime: "",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    bidOpeningPlace: "",
    contactAddress: "",
    supervisionDepartment: "",
    supervisionAddress: "",
    supervisionContact: "",
    supervisionPhone: "",
    responseDepositType: "",
    responseDepositAmount: "",
    responseDepositForm: "",
    responseDepositBankInfo: "",
    responseDepositOtherForm: "",
    responseDepositOtherRequirement: "/",
    responseDepositOtherRequirementType: "",
    responseDepositNonRefundType: "",
    responseDepositNonRefundContent: "",
    performanceDepositType: "",
    performanceDepositAmount: "",
    performanceDepositForm: "",
    performanceDepositOtherForm: "",
    evaluationMethod: "",
    evaluationCommitteeCount: "",
    contractSubcontracting: "",
    contractSubcontractingType: "",
    siteSurvey: "",
    siteSurveyType: "",
    copyCount: "",
    businessRequirements: "",
    technicalRequirements: "",
    quotationLetter: "",
    quotationLetterType: "table", // 报价表优先表格模式
  };
}

export const INVITED_BIDDING_SECTIONS = INTERNAL_BIDDING_SECTIONS;

export function createEmptyInvitedBiddingDraft(): InvitedBiddingDraft {
  return createEmptyInternalBiddingDraft();
}
