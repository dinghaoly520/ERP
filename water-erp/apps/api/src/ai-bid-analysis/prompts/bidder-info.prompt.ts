// apps/api/src/ai-bid-analysis/prompts/bidder-info.prompt.ts
export const BIDDER_INFO_PROMPT = `你是一个投标文件信息提取专家。请从以下投标文件中提取关键信息。

投标单位名称：{{BIDDER_NAME}}

输出 JSON 格式：
{
  "keyInfo": {
    "bidderName": "投标单位全称（从文件中核实）",
    "legalPerson": "法定代表人姓名",
    "registeredCapital": "注册资本（如：5000万元）",
    "establishedDate": "成立日期（如：2005年）",
    "quotePrice": 153.95,
    "quotePriceYuan": "1,539,500.00元",
    "priceValidity": 90,
    "qualificationLevel": "甲级",
    "qualificationName": "工程勘察甲级",
    "qualificationStatus": "通过",
    "performanceCount": 5,
    "keyPerformances": [
      { "projectName": "xxx工程", "contractAmount": "200万元", "completionDate": "2023年", "keyMetrics": "孔深1043m，顶角58°" }
    ],
    "projectManager": "张三",
    "projectManagerTitle": "高级工程师",
    "constructionPeriod": "90日历天",
    "warrantyPeriod": "3年",
    "contactInfo": {
      "phone": "联系电话（用于串通检测）",
      "email": "电子邮箱",
      "address": "公司地址"
    },
    "missingItems": ["缺少安全生产许可证"]
  },
  "license": {
    "type": "营业执照|事业单位法人证书",
    "number": "统一社会信用代码",
    "validFrom": "有效期起",
    "validTo": "有效期止",
    "issuedBy": "发证机关"
  },
  "qualifications": [
    {
      "name": "资质名称",
      "grade": "等级",
      "number": "证书编号",
      "validTo": "有效期",
      "issuedBy": "发证机关",
      "scope": "业务范围"
    }
  ],
  "performance": [
    {
      "projectName": "项目名称",
      "client": "业主单位",
      "contractDate": "合同签订日期",
      "contractAmount": "合同金额（万元）",
      "workContent": "工作内容摘要",
      "keyMetrics": "关键指标（孔深、顶角等）",
      "completionDate": "完工日期",
      "qualityResult": "验收结果"
    }
  ],
  "team": {
    "projectManager": {
      "name": "姓名",
      "title": "职称",
      "qualification": "执业资格",
      "experience": "相关经验年限",
      "similarProjects": "类似项目经验"
    },
    "keyMembers": [
      { "name": "姓名", "role": "角色", "title": "职称", "qualification": "执业资格" }
    ],
    "totalPersonnel": "投入总人数"
  },
  "technicalProposal": {
    "methodology": "技术方案概述（200字）",
    "equipment": [
      { "name": "设备名称", "model": "型号", "quantity": "数量", "condition": "新旧程度" }
    ],
    "qualityControl": "质量控制措施",
    "safetyMeasures": "安全措施",
    "environmentalMeasures": "环保措施",
    "timeline": "工期安排",
    "keyTechnicalPoints": ["关键技术要点"]
  },
  "commercial": {
    "price": "报价金额（万元，数字）",
    "priceBreakdown": {
      "labor": 30,
      "material": 40,
      "equipment": 20,
      "management": 5,
      "profit": 5,
      "other": 0,
      "provisional": 0,
      "tax": 0
    },
    "warranty": "质保承诺",
    "serviceCommitment": "售后服务承诺",
    "paymentTerms": "付款条件响应"
  },
  "attachments": [
    { "name": "附件名称", "type": "证书|合同|图纸|其他", "pageLocation": "文件页码位置" }
  ],
  "documentMetadata": {
    "totalPages": "总页数",
    "formatVersion": "文件格式版本",
    "softwareUsed": "编制软件（如Word版本）",
    "creationDate": "文件创建日期",
    "lastModifiedDate": "最后修改日期"
  }
}

投标文件内容：
{{BIDDER_TEXT}}

注意：
1. keyInfo 必须填写，用于关键信息对比展示
2. qualificationStatus 必须填写，根据资质证书是否齐全、有效判断："通过" 或 "不通过" 或 "待审查"
3. contactInfo 用于串通投标检测，务必提取
4. quotePrice 必须是数字类型，单位统一为万元
5. priceBreakdown 用于报价结构一致性检测；尽量输出数字，单位可为万元或占比，但同一投标文件内部应保持一致
6. documentMetadata 用于文件相似度检测
7. 缺失项明确列出，影响资格审查`;