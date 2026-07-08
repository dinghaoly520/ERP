// apps/api/src/ai-bid-analysis/prompts/tender-requirements.prompt.ts
export const TENDER_REQUIREMENTS_PROMPT = `你是一个招标文件分析专家。请**穷尽**地从以下招标文件中提取**所有**资格、技术、商务条款——每一条独立要求必须单独成项，不得合并、精炼或概括。这些条款将用于专家逐条核对投标响应，遗漏任何一条都会导致核对不全。

输出 JSON 格式：
{
  "projectName": "项目名称",
  "projectType": "工程类型（如：勘察、设计、施工、监理等）",
  "bidDeadline": "投标截止日期（如有）",
  "maxPrice": "最高限价（数字，如有）",
  "estimatedCost": "招标文件明确载明的投资估算、项目概算或预算金额（数字，如有；未载明则为 null，不得自行估算）",
  "qualificationRequirements": [
    {
      "id": "q1",
      "category": "营业执照|资质证书|业绩要求|财务状况|信誉要求|人员要求",
      "content": "逐字抄录的招标文件原文（不得改写、概括、用自己的话重述）",
      "isRequired": true,
      "evidenceType": "证书|合同|声明书|审计报告",
      "threshold": "门槛值（如：近5年、单项500万以上等）"
    }
  ],
  "technicalRequirements": [
    {
      "id": "t1",
      "category": "技术方案|设备配置|人员配置|工期|质量保障|安全措施",
      "content": "逐字抄录的招标文件原文（不得改写、概括、用自己的话重述）",
      "isStarred": true,
      "weight": 20,
      "measurable": true,
      "acceptanceCriteria": "验收标准（如有）"
    }
  ],
  "commercialRequirements": [
    {
      "id": "c1",
      "category": "售后服务|质保期|付款条件|保险要求",
      "content": "逐字抄录的招标文件原文（不得改写、概括、用自己的话重述）",
      "isRequired": true
    }
  ],
  "priceEvaluationMethod": "最低价中标|综合评分法|经评审最低价法",
  "scoringRules": {
    "technicalMax": 50,
    "commercialMax": 30,
    "priceMax": 20,
    "technicalWeights": {
      "feasibility": 20,
      "equipment": 10,
      "personnel": 10,
      "guarantee": 10
    },
    "commercialWeights": {
      "qualification": 10,
      "performance": 10,
      "service": 10
    },
    "priceMethod": "基准价法|最低价优先|性价比法",
    "notes": "评分规则说明"
  },
  "keyDates": {
    "bidDeadline": "投标截止日期",
    "validityPeriod": "投标有效期要求（天）",
    "completionDeadline": "完工期限要求"
  }
}

招标文件内容：
{{TENDER_TEXT}}

注意：
1. **穷尽提取**：逐条列出招标文件中所有实质性要求（资格/技术/商务），每条独立成项。中小型招标文件通常有 30-60 条，不要只给示例的 3-5 条精炼代表。
2. **不得合并或概括**：哪怕多条要求属于同一主题（如多项资质、多个工期节点、多档质量指标），也要拆成独立条目，保留原文细节与量化值。
3. **★实质性条款逐条提取不得遗漏**：带★号、"实质性"字样、加粗、或含"必须/应当/不得"等强制性措辞的条款，全部列入相应类别；带★号的必须 isStarred: true。
4. **保留量化门槛与验收标准**：尽可能保留数字、阈值、期限（如"近5年"、"≥95%"、"2026年4月10日前"、"单项500万以上"）于 threshold/acceptanceCriteria 字段。
5. 评分规则要准确提取，影响后续评分计算。
6. 不得自行估算招标控制价、预算价、项目概算、成本或市场价；只能提取文件明确载明的数据。
7. **content 必须逐字抄录原文**：content 字段必须是招标文件原文的逐字抄录，不得改写、概括、精炼或用自己的话重述。即使原文语句冗长也要完整抄录；只在原文超过 500 字时适当截断。这是专家用来逐条核对投标响应的基准，AI 改写会导致语义偏差。`;

export const REQUIREMENT_VALIDATION_PROMPT = `你是一个招标文件审核专家。请审查以下已提取的招标条款清单，判断每条是否属于「可供专家逐条核对投标响应的评审条款」。

## 条款清单
{{ITEMS}}

## 剔除规则（仅剔除以下类型，不得扩大范围）
1. **跨章节引用**：仅表述"满足第X章要求"或"详见合同附件"，无具体内容
2. **法律兜底**：纯法律法规兜底描述，如"法律、行政法规规定的其他条件"，无具体门槛
3. **流程说明**：描述文件提交方式、密封要求、开标流程等非评审条款
4. **空/过短**：content 少于 5 个汉字

## 保护规则（以下类型绝不剔除）
- ★实质性条款（isStarred=true）：绝不剔除
- 含量化阈值（如"≥95%""近5年""至少2项""500万以上"）：绝不剔除
- 含具体期限（如"2026年4月10日前""合同签订后15日"）：绝不剔除
- 含具体资质/证书名称：绝不剔除

## 输出格式
{ "keep": ["id1","id2",...] }  // 仅列出**保留**的条目 id（其余剔除）

逐条判断，宁留勿删。`;