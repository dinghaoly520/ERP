// apps/api/src/ai-bid-analysis/prompts/tender-requirements.prompt.ts
export const TENDER_REQUIREMENTS_PROMPT = `你是一个招标文件分析专家。请从以下招标文件中提取评审要点。

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
      "content": "具体要求内容",
      "isRequired": true,
      "evidenceType": "证书|合同|声明书|审计报告",
      "threshold": "门槛值（如：近5年、单项500万以上等）"
    }
  ],
  "technicalRequirements": [
    {
      "id": "t1",
      "category": "技术方案|设备配置|人员配置|工期|质量保障|安全措施",
      "content": "具体要求内容",
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
      "content": "具体要求内容",
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
1. 带★号的条款必须标注 isStarred: true，这些是实质性要求
2. 尽可能提取量化的门槛值和验收标准
3. 评分规则要准确提取，影响后续评分计算
4. 不得自行估算招标控制价、预算价、项目概算、成本或市场价；只能提取文件明确载明的数据`;