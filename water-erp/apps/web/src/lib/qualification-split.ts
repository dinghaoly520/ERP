export interface QualSplitGroup {
  /** 分类标签（资质/许可/认证）；无分类标记的纯枚举为空串 */
  label: string;
  items: string[];
}

/**
 * 多合一资质名称拆分（2026-11-09 用户裁定）：供应商常把多项资质/许可/认证
 * 挤进一条记录的名称，形如
 * 「资质/许可/认证: （1）资质：A、B （2）许可：C （3）认证：D、E、F 等」。
 * 展示层拆条目——命中「（N）资质/许可/认证：」分类标记按类分组；无标记但为
 * 顿号枚举（≥3 项，防「一级、二级」同级误拆）按顿号拆；单项/不可识别形态
 * 返回 null（调用方按原文渲染）。只拆展示，不改供应商录入数据。
 */

/** 顿号/分号/「以及」切条目；剥尾标点与句尾「等」 */
function toItems(text: string): string[] {
  return text
    .split(/[、；;]/)
    .flatMap((part) => part.split('以及'))
    .map((s) => s.trim().replace(/[，。,\s]+$/, '').trim())
    .map((s) => (s.length >= 4 && s.endsWith('等') ? s.slice(0, -1) : s))
    .filter((s) => s.length > 0);
}

/** 「（1）资质：」「(2)许可:」等分类标记（全/半角括号与冒号、全/半角序号均容） */
const CATEGORY_MARK = /[(（]\s*[0-9０-９一二三四五六七八九十]+\s*[)）]\s*(资质|许可|认证)\s*[:：]/g;

export function splitQualificationItems(raw: string): QualSplitGroup[] | null {
  const s = raw.trim();
  if (!s) return null;

  // 剥「资质/许可/认证:」头部（仅形态识别用；原文在其他形态下不受影响）
  const body = s.replace(/^资质\s*[/／、]\s*许可\s*[/／、]\s*认证\s*[:：]\s*/, '');

  const marks = [...body.matchAll(CATEGORY_MARK)];
  if (marks.length > 0) {
    // 标记前还有正文（非头部残料）→ 形态不可识别，交回原文渲染
    const preamble = body.slice(0, marks[0].index ?? 0).trim();
    if (preamble.length >= 4) return null;
    const groups: QualSplitGroup[] = [];
    marks.forEach((m, i) => {
      const start = (m.index ?? 0) + m[0].length;
      const end = i + 1 < marks.length ? (marks[i + 1].index ?? body.length) : body.length;
      const items = toItems(body.slice(start, end));
      if (items.length > 0) groups.push({ label: m[1], items });
    });
    if (groups.length > 0) return groups;
  }

  // 无分类标记：顿号枚举 ≥3 项才拆（2 项保持原文——同级别「一级、二级」多为一名不可断）
  const plainItems = toItems(body);
  if (!body.match(CATEGORY_MARK) && plainItems.length >= 3) {
    return [{ label: '', items: plainItems }];
  }
  return null;
}
