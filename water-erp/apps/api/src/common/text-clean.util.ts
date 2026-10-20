/**
 * 剔除 U+FFFD（�）替换符：UTF-8 多字节字符在传输/OCR 环节损坏后以替换符落进
 * 文本，出现在公告/草稿/提取字段里即乱码（2026-10-15 公告资格条款
 * 「重大税���违法失信主体」实录）。仅清字符不动其余内容。
 */
export function stripMojibake(text: string): string {
  if (!text || !text.includes('�')) return text;
  return text.replace(/�+/g, '');
}

/** 递归剔除对象/数组内全部字符串值的替换符（LLM JSON 输出清洗用） */
export function stripMojibakeDeep<T>(value: T): T {
  if (typeof value === 'string') return stripMojibake(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => stripMojibakeDeep(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripMojibakeDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}

const CJK = '\\u4e00-\\u9fff\\u3400-\\u4dbf';
const SENTENCE_END = '。！？；：';
/** 行首序号/项目符号结构（列表行）：「1、」「(2)」「（一）」「①」「- / • / ·」「【」等。
 *  用结构匹配而非首字符——数字开头的续行（「33870-20\n17」）不是列表，不得误保留。 */
const LIST_LINE_RE = /^\s*(?:[0-9]{1,3}[、．.)）]|[（(][0-9一二三四五六七八九十]{1,4}[)）]|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]|[-•·■▶▸◆【][\s]*)/;

/**
 * 合并 PDF 解析文本里的句中软换行（2026-10-20 公告词中断行根修）。
 *
 * 背景：需求表/立项表 PDF 提取的文本带排版软换行（「勘察设\n计资料采购」），经公告
 * 模板替换进 docx 后，convertToHtml 把 w:t 内裸 \n 转成 <br/>——门户正文出现词中断行。
 *
 * 合并规则（只并「明显断在词中」的行）：
 * - 前行不以句末标点（。！？；：）结尾，且下一行以 CJK/ASCII 字母数字开头 → 合并
 *   （CJK↔CJK 直接拼接；ASCII↔ASCII 补一个空格）
 * - 句末标点后、行首为序号/项目符号（1、（一）①…）的换行是合法结构，原样保留
 * - 空行（段落边界）保留
 */
export function joinSoftWrappedLines(text: string): string {
  if (!text || !text.includes('\n')) return text;
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = out[out.length - 1];
    if (
      prev !== undefined &&
      prev.length > 0 &&
      line.length > 0 &&
      // 前行不以句末标点收尾（句界换行保留）
      !SENTENCE_END.includes(prev[prev.length - 1]) &&
      // 行首非序号/项目符号结构（列表行保留）
      !LIST_LINE_RE.test(line) &&
      // 两侧至少一侧为词字符（CJK/字母数字）才判定为词中断行
      (isWordChar(prev[prev.length - 1]) || isWordChar(line[0]))
    ) {
      // 同 token 续行（数字串/连字符后接数字）直接拼接；英文单词间补空格
      const lastCh = prev[prev.length - 1];
      const joiner = /[0-9]/.test(lastCh) || (lastCh === '-' && /[0-9]/.test(line[0]))
        ? ''
        : isAsciiWord(lastCh) && isAsciiWord(line[0]) ? ' ' : '';
      out[out.length - 1] = prev + joiner + line;
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

function isWordChar(ch: string): boolean {
  return new RegExp(`[${CJK}A-Za-z0-9）)》」』%．.,]`).test(ch);
}

function isAsciiWord(ch: string): boolean {
  return /[A-Za-z0-9]/.test(ch);
}
