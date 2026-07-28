/* =====================================================================
   业务标签生成器（规则引擎，确定、零网络、可批量）
   ---------------------------------------------------------------------
   背景：schema 上 Supplier.tags:String[] 长期为空，导致供应商智能选取缺少
   可匹配的业务维度（画像分析已把「业务标签为空」列为漏选风险）。本模块从
   经营范围(businessScope) + 企业名称 + 分类 推断 2~8 个业务标签，回填 tags。

   设计取舍：经营范围本身就是工商登记的「业务活动清单」，按分隔符切分+清洗
   即可得到高质量关键词标签，无需 LLM（无成本/无超时/可同步回填全库 500+ 行）。
   名称行业词作为补充锚点，分类名作为兜底锚点。纯函数，便于单测与复用。
   ===================================================================== */

export const TAG_MIN = 2;
export const TAG_MAX = 8;

export interface TagSource {
  name: string;
  businessScope?: string | null;
  classificationName?: string | null;
}

/** 经营范围里的法律/许可套话括号，整段剔除（噪声，非业务关键词）。 */
const LEGAL_PAREN = /（[^）]*(?:依法|须经|需经|批准|备案|凭.*许可|许可.*经营|除外|限制|不得|禁止|凭|审批)[^）]*）/g;

/** 经营范围常见标签前缀。 */
const SCOPE_LABEL = /^(?:推荐业务范围|推荐范围|业务范围|主营范围|经营范围|主营业务)[:：]?\s*/;

/** 纯噪声 token（精确匹配剔除）。 */
const NOISE = new Set([
  '等', '其他', '相关', '业务', '服务', '一般', '许可', '项目', '范围',
  '经营', '推荐', '主营', '包括', '以及', '可', '的', '和', '及',
]);

/** 无区分度的分类名：作为标签毫无选取价值，不作分类锚点（也不进词表噪声）。 */
const USELESS_CLASS = new Set(['其他', '未分类', '其它', '综合', '其他类']);

/** 企业名称 → 行业标签（更具体的词放前面，避免被泛词吞掉）。顺序敏感。 */
const NAME_SECTOR: Array<[RegExp, string]> = [
  [/勘察设计|勘测设计/, '工程勘察设计'],
  [/设计院|设计/, '工程设计'],
  [/勘察|勘查/, '工程勘察'],
  [/测绘/, '测绘服务'],
  [/监理/, '工程监理'],
  [/造价/, '工程造价'],
  [/岩土/, '岩土工程'],
  [/检测|检验|测试|试验/, '检验检测'],
  [/会计|审计|税务|评估/, '财税评估'],
  [/律师|法律|法务/, '法律服务'],
  [/通信|电信/, '通信工程'],
  [/保险/, '保险服务'],
  [/物流|运输|货运/, '物流运输'],
  [/食品|餐饮/, '食品餐饮'],
  [/医药|药业|医疗/, '医药医疗'],
  [/电力|电气/, '电力工程'],
  [/水利/, '水利工程'],
  [/环保|环境/, '环保工程'],
  [/矿山|矿业/, '矿业工程'],
  [/物业/, '物业服务'],
  [/软件|信息|网络|数据|智能|科技|技术/, '信息技术'],
  [/大学|学院|学校|研究院|研究所|科研/, '科研教育'],
  [/广告|传媒|文化/, '文化传媒'],
  [/旅游|酒店/, '文旅服务'],
  [/金融|投资|基金/, '金融服务'],
  [/农业|种植|养殖/, '农林牧渔'],
  [/咨询/, '管理咨询'],
  [/机械|设备/, '机械设备'],
  [/材料|物资|供应/, '物资供应'],
  [/建设|建筑|工程/, '工程施工'],
];

function normToken(t: string): string {
  return t.replace(SCOPE_LABEL, '').replace(/[。.]+$/g, '').replace(/等+$/g, '').trim();
}

/** 切分经营范围为标签片段。 */
function extractScopeTags(scope: string): string[] {
  if (!scope) return [];
  let s = scope.replace(LEGAL_PAREN, ' ');
  // 非法律括号：保留括号内文字但改为分隔（如「固定资产（电子设备）」→ 固定资产 电子设备）。
  s = s.replace(/[（()）]/g, ' ');
  const out: string[] = [];
  for (const raw of s.split(/[、，；;,，\s\/\n｜|]+/)) {
    const t = normToken(raw);
    if (t.length < 2 || t.length > 14) continue; // 过短=噪声，过长=句子残段
    if (NOISE.has(t)) continue;
    out.push(t);
  }
  return out;
}

function extractNameTags(name: string): string[] {
  const out: string[] = [];
  for (const [re, tag] of NAME_SECTOR) {
    if (re.test(name)) out.push(tag);
  }
  return out;
}

function dedupeKeepOrder(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of arr) {
    const k = t.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/** 由经营范围+名称+分类生成 2~8 个业务标签。纯函数。 */
export function generateBusinessTags(s: TagSource): string[] {
  const scopeTags = extractScopeTags(s.businessScope || '');
  const nameTags = extractNameTags(s.name || '');
  const cls = (s.classificationName || '').trim();
  const clsTag = cls.length >= 2 && cls.length <= 14 && !USELESS_CLASS.has(cls) ? cls : '';

  // 优先级：经营范围关键词（最具体）> 名称行业词 > 分类锚点（兜底）。
  let tags = dedupeKeepOrder([...scopeTags, ...nameTags, ...(clsTag ? [clsTag] : [])]);

  // 不足下限：经营范围本身即工商登记的业务活动，首段短语是合法且具体的业务标签，作补位。
  // 用「保留冒号/空格」的切分，使「推荐业务范围: 质量管理体系认证」首段=完整短语而非「推荐业务范围」。
  if (tags.length < TAG_MIN) {
    const head = normToken((s.businessScope || '').split(/[、，；;\n｜|]+/)[0] || '');
    if (head.length >= 2 && !tags.includes(head)) tags.push(head.slice(0, 14));
  }
  // 仍不足（极稀疏：scope 单词且与名称行业词/有效分类全撞车）：用原始分类名兜底，硬性满足 2~8。
  // 此处允许「其他」等弱分类名——仅出现在 ~5 家极端样本上，对词表频次影响可忽略，换取全库 2~8 契约。
  if (tags.length < TAG_MIN && cls.length >= 2 && cls.length <= 14 && !tags.includes(cls)) {
    tags.push(cls);
  }

  return tags.slice(0, TAG_MAX);
}
