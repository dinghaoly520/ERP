/** 审查规则枚举域（2026-11-19 审查 #13 收口）：规则抽取提示词、后端 normalizeRule
 *  归一化、web 编辑/新建表单三处共用。此前提示词与前端各自手工维护两份清单，
 *  加值漏改任一侧即复发「选项表静默改写」类缺陷（select 的 defaultValue 落空
 *  时浏览器回显首项，用户不碰也会被改写）。 */

/** 检查对象（checkTarget）已砍（2026-11-19 用户裁定）：登记性元数据零消费——
 *  审查执行/规则列表/报告三面均不读，LLM 判定与表单下拉徒增噪音；DB 列 NOT NULL
 *  无默认暂留（写入点兜底 '全部'），删列待安全 schema 窗口。 */

/** 审查提取字段全集（单一权威，2026-11-19 扩充）：field-extractor 提示词
 *  （提取侧）、规则表单数值字段下拉（配置侧）、审查报告「提取字段」块（展示侧）
 *  三面共用。kind=number 可配数值比较（unit 绑定锁定）；boolean/string/date
 *  供报告展示与存在性 field 检查。
 *  ⚠️ 增删字段必须同步 field-extractor.service.ts 提示词——词表漂移=提取不到/
 *  规则「数据缺失」；rule-extractor 提示词的 field 白名单引同一名单（派生）。
 *  注意：公告类文档天然不含招标文件/合同字段（如质保期），报告灰显「未提取」
 *  是预期行为非提取故障。 */
export type ReviewFieldDef =
  | { value: string; label: string; kind: 'number'; unit: string; hint?: string }
  | { value: string; label: string; kind: 'boolean' | 'string' | 'date'; hint?: string };

export const REVIEW_FIELD_VOCAB: ReadonlyArray<ReviewFieldDef> = [
  { value: 'budgetAmount', label: '预算金额', kind: 'number', unit: 'cny', hint: '单位元；50万填500000' },
  { value: 'publicityDays', label: '公示期天数', kind: 'number', unit: 'days' },
  { value: 'bidBondPercent', label: '投标保证金比例', kind: 'number', unit: 'percent', hint: '数值2表示2%，勿填"2%"或0.02' },
  { value: 'performanceBondPercent', label: '履约保证金比例', kind: 'number', unit: 'percent', hint: '同上' },
  { value: 'clarificationLeadDays', label: '澄清答疑提前天数', kind: 'number', unit: 'days' },
  { value: 'expertPanelSize', label: '评标委员会人数', kind: 'number', unit: 'count', hint: '单数约束需另配语义规则，数值只查人数下限' },
  { value: 'bidValidDays', label: '投标有效期', kind: 'number', unit: 'days' },
  { value: 'warrantyMonths', label: '质保期', kind: 'number', unit: 'months' },
  { value: 'announcementDate', label: '公告发布日期', kind: 'date' },
  { value: 'deadlineDate', label: '投标截止日期', kind: 'date' },
  { value: 'procurementMethod', label: '采购方式', kind: 'string' },
  { value: 'documentType', label: '文件类型', kind: 'string' },
  { value: 'hasRenewalJustification', label: '续约必要性说明', kind: 'boolean' },
  { value: 'hasPublicAnnouncement', label: '发布公示', kind: 'boolean' },
  { value: 'hasTechnicalRequirements', label: '完整技术要求', kind: 'boolean' },
  { value: 'hasEvaluationCriteria', label: '评分标准', kind: 'boolean' },
];

/** 数值比较字段下拉（自词表 number 子集派生，单位随字段锁定——执行比的是裸
 *  数值、unit 不参与运算，自由选单位会造出「看起来对、实际差一万倍」的规则） */
export const RULE_NUMERIC_FIELDS: ReadonlyArray<{ value: string; label: string; unit: string }> =
  REVIEW_FIELD_VOCAB.filter(
    (f): f is ReviewFieldDef & { kind: 'number'; unit: string } => f.kind === 'number',
  ).map(({ value, label, unit }) => ({ value, label, unit }));

/** 数值比较单位全集（value=入库值，label=表单展示） */
export const RULE_UNITS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'cny', label: '元' },
  { value: 'ten_thousand_cny', label: '万元' },
  { value: 'days', label: '天' },
  { value: 'months', label: '月' },
  { value: 'years', label: '年' },
  { value: 'percent', label: '%' },
  { value: 'ratio', label: '比率' },
  { value: 'count', label: '个/次/人' },
  { value: 'copies', label: '份' },
  { value: 'points', label: '分' },
  { value: 'hours', label: '小时' },
  { value: 'none', label: '无' },
];

/** 数值比较算子全集 */
export const RULE_OPERATORS = ['>=', '<=', '>', '<', '==', '!='] as const;

/** 严重程度全集 */
export const RULE_SEVERITIES = ['critical', 'warning', 'info'] as const;

/** 存在性检查类型（executor 另支持 'field'，仅供内部数值缺失判适用，非用户面） */
export const RULE_CHECK_TYPES = ['keyword', 'section'] as const;
