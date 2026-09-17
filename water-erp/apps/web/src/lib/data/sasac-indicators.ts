// 自动生成（2026-09-16，提取自《四川省国资监管九大领域业务数据指标库》业务指标表·采购领域）——勿手改；重新生成见 /tmp/gen_indicators.mjs
export interface SasacIndicator {
  catalog: string; type: string; name: string; desc: string;
  unit: string | null; required: string; dimension: string | null;
  dataType: string; length: string | null;
}
export const SASAC_INDICATORS: SasacIndicator[] = [
  {
    "catalog": "采购项目基础信息",
    "type": "描述项",
    "name": "采购项目名称",
    "desc": "采购项目的具体名称",
    "unit": null,
    "required": "必填",
    "dimension": null,
    "dataType": "字符串型C",
    "length": "512"
  },
  {
    "catalog": "采购项目基础信息",
    "type": "描述项",
    "name": "采购单位名称",
    "desc": "实施采购的单位名称",
    "unit": null,
    "required": "必填",
    "dimension": null,
    "dataType": "字符串型C",
    "length": "512"
  },
  {
    "catalog": "采购项目基础信息",
    "type": "描述项",
    "name": "采购联系人",
    "desc": "采购方负责联系的人员姓名",
    "unit": null,
    "required": "必填",
    "dimension": null,
    "dataType": "字符串型C",
    "length": "255"
  },
  {
    "catalog": "采购项目基础信息",
    "type": "描述项",
    "name": "采购类别",
    "desc": "采购项目的类别划分",
    "unit": null,
    "required": "必填",
    "dimension": "采购类别",
    "dataType": "字符串型C",
    "length": "64"
  },
  {
    "catalog": "采购项目基础信息",
    "type": "描述项",
    "name": "采购方式",
    "desc": "采购项目的具体开展方式",
    "unit": null,
    "required": "必填",
    "dimension": "采购方式",
    "dataType": "字符串型C",
    "length": "64"
  },
  {
    "catalog": "采购项目基础信息",
    "type": "描述项",
    "name": "发布形式",
    "desc": "采购信息的发布形式",
    "unit": null,
    "required": "必填",
    "dimension": "发布形式",
    "dataType": "字符串型C",
    "length": "64"
  },
  {
    "catalog": "采购项目基础信息",
    "type": "指标项",
    "name": "采购预算金额",
    "desc": "项目计划的最高采购金额",
    "unit": "元",
    "required": "必填",
    "dimension": null,
    "dataType": "数值型N",
    "length": "16,4"
  },
  {
    "catalog": "采购项目基础信息",
    "type": "指标项",
    "name": "采购中标（成交）金额",
    "desc": "最终中标或成交的合同金额",
    "unit": "元",
    "required": "必填",
    "dimension": null,
    "dataType": "数值型N",
    "length": "16,4"
  },
  {
    "catalog": "采购项目基础信息",
    "type": "描述项",
    "name": "采购日期（采购公告日期）",
    "desc": "采购公告发布的日期",
    "unit": null,
    "required": "必填",
    "dimension": null,
    "dataType": "日期型D",
    "length": "-"
  },
  {
    "catalog": "采购项目基础信息",
    "type": "描述项",
    "name": "中标日期",
    "desc": "项目中标公告的日期",
    "unit": null,
    "required": "必填",
    "dimension": null,
    "dataType": "日期型D",
    "length": "-"
  },
  {
    "catalog": "采购项目基础信息",
    "type": "描述项",
    "name": "是否集中采购",
    "desc": "是否由统一机构组织采购",
    "unit": null,
    "required": "必填",
    "dimension": null,
    "dataType": "字符串型C",
    "length": "522"
  },
  {
    "catalog": "采购项目基础信息",
    "type": "描述项",
    "name": "文件发售期是否满足要求",
    "desc": "发售时长是否符合规定",
    "unit": null,
    "required": "必填",
    "dimension": null,
    "dataType": "字符串型C",
    "length": "522"
  },
  {
    "catalog": "采购项目基础信息",
    "type": "描述项",
    "name": "发售期不满足要求详情",
    "desc": "不满足时的具体原因说明",
    "unit": null,
    "required": "必填",
    "dimension": null,
    "dataType": "字符串型C",
    "length": "522"
  },
  {
    "catalog": "采购项目基础信息",
    "type": "描述项",
    "name": "候选人公示期是否满足要求",
    "desc": "公示时长是否符合规定",
    "unit": null,
    "required": "必填",
    "dimension": null,
    "dataType": "字符串型C",
    "length": "522"
  },
  {
    "catalog": "采购项目基础信息",
    "type": "描述项",
    "name": "公示期不满足要求详情",
    "desc": "不满足时的具体原因说明",
    "unit": null,
    "required": "必填",
    "dimension": null,
    "dataType": "字符串型C",
    "length": "522"
  },
  {
    "catalog": "采购项目基础信息",
    "type": "描述项",
    "name": "中标供应商名称",
    "desc": "中标供应商的企业全称",
    "unit": null,
    "required": "必填",
    "dimension": null,
    "dataType": "字符串型C",
    "length": "255"
  },
  {
    "catalog": "采购项目基础信息",
    "type": "描述项",
    "name": "中标供应商代码（统一社会信用代码）",
    "desc": "中标供应商的法定身份标识",
    "unit": null,
    "required": "必填",
    "dimension": null,
    "dataType": "字符串型C",
    "length": "255"
  },
  {
    "catalog": "采购项目过程信息",
    "type": "描述项",
    "name": "采购实施阶段名称",
    "desc": "当前采购流程的阶段名称",
    "unit": null,
    "required": "必填",
    "dimension": null,
    "dataType": "字符串型C",
    "length": "255"
  },
  {
    "catalog": "采购供应商",
    "type": "描述项",
    "name": "供应商名",
    "desc": "供应商企业全称",
    "unit": null,
    "required": "必填",
    "dimension": null,
    "dataType": "字符串型C",
    "length": "255"
  },
  {
    "catalog": "采购供应商",
    "type": "描述项",
    "name": "供应商统一信用代码",
    "desc": "供应商的法定统一身份代码",
    "unit": null,
    "required": "必填",
    "dimension": null,
    "dataType": "字符串型C",
    "length": "255"
  },
  {
    "catalog": "采购供应商",
    "type": "描述项",
    "name": "主营业务",
    "desc": "企业主要经营业务范围",
    "unit": null,
    "required": "必填",
    "dimension": null,
    "dataType": "字符串型C",
    "length": "255"
  },
  {
    "catalog": "采购供应商",
    "type": "描述项",
    "name": "成立日期",
    "desc": "供应商企业注册成立的日期",
    "unit": null,
    "required": "必填",
    "dimension": null,
    "dataType": "日期型D",
    "length": "-"
  },
  {
    "catalog": "采购供应商",
    "type": "描述项",
    "name": "所属行业",
    "desc": "供应商所属的国民经济行业",
    "unit": null,
    "required": "必填",
    "dimension": null,
    "dataType": "字符串型C",
    "length": "255"
  },
  {
    "catalog": "采购供应商",
    "type": "描述项",
    "name": "企业简介",
    "desc": "供应商的基本情况介绍",
    "unit": null,
    "required": "必填",
    "dimension": null,
    "dataType": "字符串型C",
    "length": "255"
  },
  {
    "catalog": "采购供应商",
    "type": "指标项",
    "name": "注册资金",
    "desc": "供应商注册时的资本金额",
    "unit": "万元",
    "required": "必填",
    "dimension": null,
    "dataType": "数值型N",
    "length": "16,4"
  },
  {
    "catalog": "采购组织结构树",
    "type": "描述项",
    "name": "单位统一社会信用代码",
    "desc": "采购单位的统一身份代码",
    "unit": null,
    "required": "必填",
    "dimension": null,
    "dataType": "字符串型C",
    "length": "255"
  },
  {
    "catalog": "采购组织结构树",
    "type": "描述项",
    "name": "采购单位ID",
    "desc": "采购方内部唯一标识编号",
    "unit": null,
    "required": "必填",
    "dimension": null,
    "dataType": "字符串型C",
    "length": "255"
  },
  {
    "catalog": "采购组织结构树",
    "type": "描述项",
    "name": "上级单位ID",
    "desc": "采购单位的直属上级标识",
    "unit": null,
    "required": "必填",
    "dimension": null,
    "dataType": "字符串型C",
    "length": "255"
  },
  {
    "catalog": "采购组织结构树",
    "type": "描述项",
    "name": "所属集团ID",
    "desc": "采购单位归属集团标识",
    "unit": null,
    "required": "必填",
    "dimension": null,
    "dataType": "字符串型C",
    "length": "255"
  }
];
