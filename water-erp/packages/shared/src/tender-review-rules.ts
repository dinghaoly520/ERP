/** 审查规则枚举域（2026-11-19 审查 #13 收口）：规则抽取提示词、后端 normalizeRule
 *  归一化、web 编辑/新建表单三处共用。此前提示词与前端各自手工维护两份清单，
 *  加值漏改任一侧即复发「选项表静默改写」类缺陷（select 的 defaultValue 落空
 *  时浏览器回显首项，用户不碰也会被改写）。 */

/** 检查对象（checkTarget）已砍（2026-11-19 用户裁定）：登记性元数据零消费——
 *  审查执行/规则列表/报告三面均不读，LLM 判定与表单下拉徒增噪音；DB 列 NOT NULL
 *  无默认暂留（写入点兜底 '全部'），删列待安全 schema 窗口。 */

/** 数值比较字段全集（value=入库 logic.field、label=表单展示、unit=绑定单位）。
 *  词表须与 field-extractor 提示词字段对齐——执行器按 fields[field] 精确键名
 *  匹配（无别名映射），词表外值=每次审查「数据缺失」；单位绑定并锁定：执行
 *  比的是裸数值、unit 不参与运算，自由选单位会造出「看起来对、实际差一万倍」
 *  的规则（同构 2026-09-14 唱标万元事故）。 */
export const RULE_NUMERIC_FIELDS: ReadonlyArray<{ value: string; label: string; unit: string }> = [
  { value: 'budgetAmount', label: '预算金额（元）', unit: 'cny' },
  { value: 'publicityDays', label: '公示期天数（天）', unit: 'days' },
];

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
