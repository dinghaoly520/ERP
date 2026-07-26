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
        aiPrompt: "根据项目名称生成项目概况和采购内容，包含采购背景、目标、范围、具体采购内容等关键信息。要求：根据内容复杂度选择合适的表达方式。简单内容直接用段落描述，无需编号；复杂或多项内容可用层次编号（主层次用1.、2.、3.，子层次用①②③）。不要过度使用编号，避免机械感。不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。若采购事项较多、适合以表格呈现，则以制表符（Tab 键）分隔各项各列，列序为 名称、规格型号、单位、数量、单价、合价（单价和合价留空），不写表头行；若事项较少或更适合段落描述，直接在正文中逐项说明即可。由你判断哪种方式更合适。",
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
        aiPrompt: "根据项目类型生成特定资格要求，包含资质证书、业绩要求、人员配置等。要求：根据内容复杂度选择合适的表达方式。简单内容直接用段落描述，无需编号；复杂或多项内容可用层次编号（主层次用1.、2.、3.，子层次用①②③）。不要过度使用编号，避免机械感。不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。若采购事项较多、适合以表格呈现，则以制表符（Tab 键）分隔各项各列，列序为 名称、规格型号、单位、数量、单价、合价（单价和合价留空），不写表头行；若事项较少或更适合段落描述，直接在正文中逐项说明即可。由你判断哪种方式更合适。",
      },
      {
        key: "documentAcquireTime",
        label: "文件获取时间",
        placeholder: "请输入文件获取时间",
        aiPrompt: "生成文件获取时间。规则：生成一个日期时间范围，起始为今天起往后推3-5个工作日（跳过周六日）的上午09:00，结束为起始日期往后推3-5个工作日的下午15:00。格式为'YYYY年MM月DD日HH:MM至YYYY年MM月DD日HH:MM'（如2026年03月23日09:00至2026年03月26日15:00），只输出该时间范围，不要其他说明。",
      },
      {
        key: "responseDeadline",
        label: "响应文件提交截止时间",
        placeholder: "另行通知",
        aiPrompt: "生成响应文件提交截止时间。规则：从'文件获取时间'的结束日期往后推至少3个工作日（跳过周六日），取该工作日的下午14:00。格式为'YYYY年MM月DD日HH:MM'（如2026年7月1日14:00），只输出该日期时间，不要其他说明。",
        composite: {
          typeKey: "responseDeadlineType",
          typeLabel: "时间类型",
          typeOptions: [
            { value: "datetime", label: "选择时间" },
            { value: "text", label: "填写文字" },
          ],
        },
      },
      { key: "contactName", label: "联系人", placeholder: "请输入联系人" },
      { key: "contactPhone", label: "联系电话", placeholder: "请输入联系电话", type: "tel", aiPrompt: "生成联系电话。只输出纯数字号码（如028-81753276或13812345678），不要添加'联系电话：'、'电话：'等任何前缀或说明文字。" },
      { key: "contactEmail", label: "联系邮箱", placeholder: "请输入联系邮箱", type: "email", aiPrompt: "生成联系邮箱。只输出纯邮箱地址（如example@company.com），不要添加'联系邮箱：'、'邮箱：'等任何前缀或说明文字。" },
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
        aiPrompt: "根据项目类型生成商务要求，包含交付期限、付款方式、验收标准、售后服务等。要求：根据内容复杂度选择合适的表达方式。简单内容直接用段落描述，无需编号；复杂或多项内容可用层次编号（主层次用1.、2.、3.，子层次用①②③）。不要过度使用编号，避免机械感。不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。若采购事项较多、适合以表格呈现，则以制表符（Tab 键）分隔各项各列，列序为 名称、规格型号、单位、数量、单价、合价（单价和合价留空），不写表头行；若事项较少或更适合段落描述，直接在正文中逐项说明即可。由你判断哪种方式更合适。",
      },
      {
        key: "technicalRequirements",
        label: "技术要求",
        placeholder: "请输入技术要求",
        multiline: true,
        aiPrompt: "根据项目类型生成技术要求，包含技术标准、性能参数、质量要求等。要求：根据内容复杂度选择合适的表达方式。简单内容直接用段落描述，无需编号；复杂或多项内容可用层次编号（主层次用1.、2.、3.，子层次用①②③）。不要过度使用编号，避免机械感。不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。若采购事项较多、适合以表格呈现，则以制表符（Tab 键）分隔各项各列，列序为 名称、规格型号、单位、数量、单价、合价（单价和合价留空），不写表头行；若事项较少或更适合段落描述，直接在正文中逐项说明即可。由你判断哪种方式更合适。",
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
        aiPrompt: "本部分是针对各项采购物品的报价清单，以供应商口吻呈现（即供应商填报的报价单）。删除一切说明性条款、抬头（如 致：××）和落款尾缀（如 投标人盖章、法定代表人或授权代表签字、日期），只保留具体采购事项及其报价：依据项目采购内容逐项列出物品的名称、规格型号、单位、数量，并设报价栏（单价、合价）以 ____ 留空供供应商填写，不得编造金额。条目清晰即可，不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。若采购事项较多、适合以表格呈现，则以制表符（Tab 键）分隔各项各列，列序为 名称、规格型号、单位、数量、单价、合价（单价和合价留空），不写表头行；若事项较少或更适合段落描述，直接在正文中逐项说明即可。由你判断哪种方式更合适。",
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
    contractSubcontracting: "",
    contractSubcontractingType: "",
    siteSurvey: "",
    siteSurveyType: "",
    businessRequirements: "",
    technicalRequirements: "",
    quotationLetter: "",
    quotationLetterType: "",
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
        placeholder: "无",
        composite: {
          typeKey: "projectDurationType",
          typeLabel: "期限类型",
          typeOptions: [
            { value: "date", label: "选择时间" },
            { value: "text", label: "填写文字" },
          ],
        },
      },
      { key: "documentAcquireTime", label: "采购文件获取时间", placeholder: "请输入采购文件获取时间", aiPrompt: "生成采购文件获取时间。规则：生成一个日期时间范围，起始为今天起往后推3-5个工作日（跳过周六日）的上午09:00，结束为起始日期往后推3-5个工作日的下午15:00。格式为'YYYY年MM月DD日HH:MM至YYYY年MM月DD日HH:MM'（如2026年03月23日09:00至2026年03月26日15:00），只输出该时间范围，不要其他说明。" },
      { key: "documentPrice", label: "采购文件售价", placeholder: "例如 0 元" },
      {
        key: "submissionAndNegotiationTime",
        label: "递交和谈判时间",
        placeholder: "另行通知",
        aiPrompt: "生成递交和谈判时间。规则：从今天起往后推3-5个工作日（跳过周六日）。格式为'YYYY年MM月DD日HH:MM'（如2026年05月28日09:00），只输出一个具体时间，不要其他说明。",
        composite: {
          typeKey: "submissionAndNegotiationTimeType",
          typeLabel: "时间类型",
          typeOptions: [
            { value: "datetime", label: "选择时间" },
            { value: "text", label: "填写文字" },
          ],
        },
      },
      { key: "contactName", label: "联系人", placeholder: "请输入联系人" },
      { key: "contactEmail", label: "联系邮箱", placeholder: "请输入联系邮箱", type: "email", aiPrompt: "生成联系邮箱。只输出纯邮箱地址（如example@company.com），不要添加'联系邮箱：'、'邮箱：'等任何前缀或说明文字。" },
      { key: "contactPhone", label: "联系电话", placeholder: "请输入联系电话", type: "tel", aiPrompt: "生成联系电话。只输出纯数字号码（如028-81753276或13812345678），不要添加'联系电话：'、'电话：'等任何前缀或说明文字。" },
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
        aiPrompt: "根据项目信息生成采购内容，详细描述采购的具体物品、服务或工程内容。要求：根据内容复杂度选择合适的表达方式。简单内容直接用段落描述，无需编号；复杂或多项内容可用层次编号（主层次用1.、2.、3.，子层次用①②③）。不要过度使用编号，避免机械感。不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。若采购事项较多、适合以表格呈现，则以制表符（Tab 键）分隔各项各列，列序为 名称、规格型号、单位、数量、单价、合价（单价和合价留空），不写表头行；若事项较少或更适合段落描述，直接在正文中逐项说明即可。由你判断哪种方式更合适。",
      },
      {
        key: "procurementRequirements",
        label: "采购要求",
        placeholder: "请输入采购要求",
        multiline: true,
        aiPrompt: "根据采购内容生成采购要求，包含质量标准、交付要求、验收条件等。要求：根据内容复杂度选择合适的表达方式。简单内容直接用段落描述，无需编号；复杂或多项内容可用层次编号（主层次用1.、2.、3.，子层次用①②③）。不要过度使用编号，避免机械感。不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。若采购事项较多、适合以表格呈现，则以制表符（Tab 键）分隔各项各列，列序为 名称、规格型号、单位、数量、单价、合价（单价和合价留空），不写表头行；若事项较少或更适合段落描述，直接在正文中逐项说明即可。由你判断哪种方式更合适。",
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
        aiPrompt: "本部分是报价函中针对各项采购物品的报价清单，以供应商口吻呈现（即供应商填报的报价单）。删除一切说明性条款、抬头（如 致：××）和落款尾缀（如 投标人盖章、法定代表人或授权代表签字、日期），只保留具体采购事项及其报价：依据项目采购内容逐项列出物品的名称、规格型号、单位、数量，并设报价栏（单价、合价）以 ____ 留空供供应商填写，不得编造金额。条目清晰即可，不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。若采购事项较多、适合以表格呈现，则以制表符（Tab 键）分隔各项各列，列序为 名称、规格型号、单位、数量、单价、合价（单价和合价留空），不写表头行；若事项较少或更适合段落描述，直接在正文中逐项说明即可。由你判断哪种方式更合适。",
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
    projectDurationType: "",
    documentAcquireTime: "",
    documentPrice: "",
    submissionAndNegotiationTime: "",
    submissionAndNegotiationTimeType: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    serviceContent: "",
    serviceContentType: "",
    procurementContent: "",
    procurementRequirements: "",
    quotationLetter: "",
    quotationLetterType: "",
  };
}

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
    key: "instructions",
    title: "询价须知",
    description: "填写项目介绍、资料要求、评标方法、限价和联系方式。",
    fields: [
      {
        key: "projectIntroduction",
        label: "项目介绍",
        placeholder: "请输入项目介绍",
        multiline: true,
        aiPrompt: "根据项目名称生成项目介绍，包含项目背景、目标、范围等信息。要求：根据内容复杂度选择合适的表达方式。简单内容直接用段落描述，无需编号；复杂或多项内容可用层次编号（主层次用1.、2.、3.，子层次用①②③）。不要过度使用编号，避免机械感。不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。若采购事项较多、适合以表格呈现，则以制表符（Tab 键）分隔各项各列，列序为 名称、规格型号、单位、数量、单价、合价（单价和合价留空），不写表头行；若事项较少或更适合段落描述，直接在正文中逐项说明即可。由你判断哪种方式更合适。",
      },
      {
        key: "procurementContent",
        label: "采购内容",
        placeholder: "请输入采购内容",
        multiline: true,
        aiPrompt: "根据项目信息生成采购内容，详细描述采购的具体物品、服务或工程内容。要求：根据内容复杂度选择合适的表达方式。简单内容直接用段落描述，无需编号；复杂或多项内容可用层次编号（主层次用1.、2.、3.，子层次用①②③）。不要过度使用编号，避免机械感。不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。若采购事项较多、适合以表格呈现，则以制表符（Tab 键）分隔各项各列，列序为 名称、规格型号、单位、数量、单价、合价（单价和合价留空），不写表头行；若事项较少或更适合段落描述，直接在正文中逐项说明即可。由你判断哪种方式更合适。",
      },
      {
        key: "requiredDocuments",
        label: "需提供的资料",
        placeholder: "请输入需提供的资料",
        multiline: true,
        aiPrompt: "根据项目类型生成供应商需要提供的资料清单。要求：根据内容复杂度选择合适的表达方式。简单内容直接用段落描述，无需编号；复杂或多项内容可用层次编号（主层次用1.、2.、3.，子层次用①②③）。不要过度使用编号，避免机械感。不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。若采购事项较多、适合以表格呈现，则以制表符（Tab 键）分隔各项各列，列序为 名称、规格型号、单位、数量、单价、合价（单价和合价留空），不写表头行；若事项较少或更适合段落描述，直接在正文中逐项说明即可。由你判断哪种方式更合适。",
      },
      {
        key: "evaluationMethod",
        label: "评标方法",
        placeholder: "请输入评标方法",
        aiPrompt: "生成评标方法名称，只输出方法名称，例如 '最低评标价法' 或 '综合评分法'。",
        multiline: true,
      },
      {
        key: "priceLimit",
        label: "最高限价",
        placeholder: "例如 500000",
        aiPrompt: "生成项目最高限价，只输出纯数字金额，不要包含任何单位或符号，例如 '500000'。",
      },
      {
        key: "submissionDeadline",
        label: "递交报价函截止时间",
        placeholder: "另行通知",
        aiPrompt: "生成交递报价函截止时间。规则：从今天起往后推3-5个工作日（跳过周六日），格式为'YYYY年MM月DD日'，只输出日期，不要其他说明。",
      },
      { key: "contactName", label: "联系人", placeholder: "请输入联系人" },
      { key: "contactEmail", label: "联系邮箱", placeholder: "请输入联系邮箱", type: "email", aiPrompt: "生成联系邮箱。只输出纯邮箱地址（如example@company.com），不要添加'联系邮箱：'、'邮箱：'等任何前缀或说明文字。" },
      { key: "contactPhone", label: "联系电话", placeholder: "请输入联系电话", type: "tel", aiPrompt: "生成联系电话。只输出纯数字号码（如028-81753276或13812345678），不要添加'联系电话：'、'电话：'等任何前缀或说明文字。" },
    ],
  },
  {
    key: "quotation",
    title: "报价表",
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
        aiPrompt: "本部分是报价函中针对各项采购物品的报价清单，以供应商口吻呈现（即供应商填报的报价单）。删除一切说明性条款、抬头（如 致：××）和落款尾缀（如 投标人盖章、法定代表人或授权代表签字、日期），只保留具体采购事项及其报价：依据项目采购内容逐项列出物品的名称、规格型号、单位、数量，并设报价栏（单价、合价）以 ____ 留空供供应商填写，不得编造金额。条目清晰即可，不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。若采购事项较多、适合以表格呈现，则以制表符（Tab 键）分隔各项各列，列序为 名称、规格型号、单位、数量、单价、合价（单价和合价留空），不写表头行；若事项较少或更适合段落描述，直接在正文中逐项说明即可。由你判断哪种方式更合适。",
      },
    ],
  },
];

export function createEmptyInquiryPurchaseDraft(): InquiryPurchaseDraft {
  return {
    projectName: "",
    coverDate: currentYearMonth(),
    projectIntroduction: "",
    procurementContent: "",
    requiredDocuments: "",
    evaluationMethod: "",
    priceLimit: "",
    submissionDeadline: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    quotationLetter: "",
    quotationLetterType: "",
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
        aiPrompt: "根据项目名称生成项目概况和采购内容，包含采购背景、目标、范围、具体采购内容等关键信息。要求：根据内容复杂度选择合适的表达方式。简单内容直接用段落描述，无需编号；复杂或多项内容可用层次编号（主层次用1.、2.、3.，子层次用①②③）。不要过度使用编号，避免机械感。不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。若采购事项较多、适合以表格呈现，则以制表符（Tab 键）分隔各项各列，列序为 名称、规格型号、单位、数量、单价、合价（单价和合价留空），不写表头行；若事项较少或更适合段落描述，直接在正文中逐项说明即可。由你判断哪种方式更合适。",
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
        placeholder: "请输入文件获取时间",
        aiPrompt: "生成文件获取时间。规则：生成一个日期时间范围，起始为今天起往后推3-5个工作日（跳过周六日）的上午09:00，结束为起始日期往后推3-5个工作日的下午15:00。格式为'YYYY年MM月DD日HH:MM至YYYY年MM月DD日HH:MM'（如2026年03月23日09:00至2026年03月26日15:00），只输出该时间范围，不要其他说明。",
      },
      { key: "documentPrice", label: "采购文件售价", placeholder: "例如 0 元" },
      {
        key: "responseSubmissionTime",
        label: "响应文件提交时间",
        placeholder: "另行通知",
        aiPrompt: "生成响应文件提交时间。规则：从'文件获取时间'的结束日期往后推至少3个工作日（跳过周六日），取该工作日的下午14:00。格式为'YYYY年MM月DD日HH:MM'（如2026年7月1日14:00），只输出该日期时间，不要其他说明。",
      },
      { key: "contactName", label: "联系人", placeholder: "请输入联系人" },
      { key: "contactPhone", label: "联系电话", placeholder: "请输入联系电话", type: "tel", aiPrompt: "生成联系电话。只输出纯数字号码（如028-81753276或13812345678），不要添加'联系电话：'、'电话：'等任何前缀或说明文字。" },
      { key: "contactEmail", label: "联系邮箱", placeholder: "请输入联系邮箱", type: "email", aiPrompt: "生成联系邮箱。只输出纯邮箱地址（如example@company.com），不要添加'联系邮箱：'、'邮箱：'等任何前缀或说明文字。" },
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
        placeholder: "请输入其他要求",
        multiline: true,
        composite: {
          typeKey: "responseDepositOtherRequirementType",
          typeLabel: "是否有其他要求",
          typeOptions: [
            { value: "none", label: "无" },
            { value: "have", label: "有" },
          ],
        },
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
        placeholder: "请输入金额及比例，例如：合同金额的10%",
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
        aiPrompt: "根据项目类型生成商务要求，包含交付期限、付款方式、验收标准、售后服务等。要求：根据内容复杂度选择合适的表达方式。简单内容直接用段落描述，无需编号；复杂或多项内容可用层次编号（主层次用1.、2.、3.，子层次用①②③）。不要过度使用编号，避免机械感。不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。若采购事项较多、适合以表格呈现，则以制表符（Tab 键）分隔各项各列，列序为 名称、规格型号、单位、数量、单价、合价（单价和合价留空），不写表头行；若事项较少或更适合段落描述，直接在正文中逐项说明即可。由你判断哪种方式更合适。",
      },
      {
        key: "technicalRequirements",
        label: "技术要求",
        placeholder: "请输入技术要求",
        multiline: true,
        aiPrompt: "根据项目类型生成技术要求，包含技术标准、性能参数、质量要求等。要求：根据内容复杂度选择合适的表达方式。简单内容直接用段落描述，无需编号；复杂或多项内容可用层次编号（主层次用1.、2.、3.，子层次用①②③）。不要过度使用编号，避免机械感。不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。若采购事项较多、适合以表格呈现，则以制表符（Tab 键）分隔各项各列，列序为 名称、规格型号、单位、数量、单价、合价（单价和合价留空），不写表头行；若事项较少或更适合段落描述，直接在正文中逐项说明即可。由你判断哪种方式更合适。",
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
        aiPrompt: "本部分是针对各项采购物品的报价清单，以供应商口吻呈现（即供应商填报的报价单）。删除一切说明性条款、抬头（如 致：××）和落款尾缀（如 投标人盖章、法定代表人或授权代表签字、日期），只保留具体采购事项及其报价：依据项目采购内容逐项列出物品的名称、规格型号、单位、数量，并设报价栏（单价、合价）以 ____ 留空供供应商填写，不得编造金额。条目清晰即可，不要使用#、*等符号，不要出现空行，不要在开头重复字段名称。若采购事项较多、适合以表格呈现，则以制表符（Tab 键）分隔各项各列，列序为 名称、规格型号、单位、数量、单价、合价（单价和合价留空），不写表头行；若事项较少或更适合段落描述，直接在正文中逐项说明即可。由你判断哪种方式更合适。",
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
    documentPrice: "",
    responseSubmissionTime: "",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    responseDepositType: "",
    responseDepositAmount: "",
    responseDepositForm: "",
    responseDepositBankInfo: "",
    responseDepositOtherForm: "",
    responseDepositOtherRequirement: "",
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
    quotationLetterType: "",
  };
}

export const INVITED_BIDDING_SECTIONS = INTERNAL_BIDDING_SECTIONS;

export function createEmptyInvitedBiddingDraft(): InvitedBiddingDraft {
  return createEmptyInternalBiddingDraft();
}
