import type {
  CompetitiveNegotiationAnswers,
  InquiryPurchaseAnswers,
  SingleSourceAnswers,
  InternalBiddingAnswers,
  TableData,
} from './tender-write.types';

export const COMPETITIVE_NEGOTIATION_TEMPLATE_FILE =
  '模板文件/谈判采购文件模板.docx';
export const SINGLE_SOURCE_TEMPLATE_FILE = '模板文件/直接采购模板.docx';
export const INQUIRY_PURCHASE_TEMPLATE_FILE = '模板文件/询比采购文件模板.docx';
export const INTERNAL_BIDDING_TEMPLATE_FILE =
  '模板文件/竞价采购文件模板.docx';
export const INVITED_BIDDING_TEMPLATE_FILE = '模板文件/邀请招标文件模板.docx';

// Chinese number mapping for date formatting
const CHINESE_NUMBERS = [
  '〇',
  '一',
  '二',
  '三',
  '四',
  '五',
  '六',
  '七',
  '八',
  '九',
];
const CHINESE_TENS = ['', '十', '二十', '三十'];

// Chinese digits for amount conversion
const CHINESE_DIGITS = [
  '零',
  '壹',
  '贰',
  '叁',
  '肆',
  '伍',
  '陆',
  '柒',
  '捌',
  '玖',
];

function numberToChinese(num: number): string {
  if (num < 10) {
    return CHINESE_NUMBERS[num];
  }
  const tens = Math.floor(num / 10);
  const ones = num % 10;
  if (ones === 0) {
    return CHINESE_TENS[tens];
  }
  return CHINESE_TENS[tens] + CHINESE_NUMBERS[ones];
}

// Convert number to Chinese uppercase (for amount)
// - 小数点后全零则忽略，不读角分
// - 不加"整"
function numberToChineseUppercase(amountStr: string): string {
  if (!amountStr || !amountStr.trim()) {
    return '';
  }

  const amount = parseFloat(amountStr);
  if (isNaN(amount)) {
    return amountStr;
  }

  // Handle negative numbers
  if (amount < 0) {
    return '负' + numberToChineseUppercase(Math.abs(amount).toString());
  }

  // Handle zero
  if (amount === 0) {
    return '零元';
  }

  const parts = amountStr.split('.');
  const integerPart = parseInt(parts[0], 10);
  const decimalPart = parts[1] ? parts[1].padEnd(2, '0').substring(0, 2) : '';

  let result = '';

  // Convert integer part
  if (integerPart > 0) {
    result = convertIntegerToChinese(integerPart) + '元';
  }

  // Only read decimal part when it has non-zero digits
  if (decimalPart) {
    const jiao = parseInt(decimalPart[0], 10);
    const fen = parseInt(decimalPart[1], 10);

    if (jiao > 0 || fen > 0) {
      if (jiao > 0) {
        result += CHINESE_DIGITS[jiao] + '角';
      }
      if (fen > 0) {
        result += CHINESE_DIGITS[fen] + '分';
      }
    }
  }

  return result;
}

function convertIntegerToChinese(num: number): string {
  if (num === 0) return '';

  const units = ['', '万', '亿'];
  let result = '';
  let unitIndex = 0;

  while (num > 0) {
    const section = num % 10000;
    if (section > 0) {
      result = convertSectionToChinese(section) + units[unitIndex] + result;
    }
    num = Math.floor(num / 10000);
    unitIndex++;
  }

  return result;
}

function convertSectionToChinese(section: number): string {
  const units = ['', '拾', '佰', '仟'];
  let result = '';
  let zeroFlag = false;

  for (let i = 3; i >= 0; i--) {
    const divisor = Math.pow(10, i);
    const digit = Math.floor(section / divisor) % 10;

    if (digit === 0) {
      // 前导零不置 flag（82 → 「捌拾贰」而非「零捌拾贰」）；节中零仍补（1002 → 「壹仟零贰」）
      if (result) zeroFlag = true;
    } else {
      if (zeroFlag) {
        result += '零';
        zeroFlag = false;
      }
      result += CHINESE_DIGITS[digit] + units[i];
    }
    section = section % divisor;
  }

  return result;
}

function formatDateToChinese(dateString: string | undefined | null): string {
  if (!dateString || !dateString.trim()) {
    return '';
  }

  // Handle YYYY-MM format (cover date, month only)
  if (/^\d{4}-\d{2}$/.test(dateString)) {
    const [yearStr, monthStr] = dateString.split('-');
    const month = parseInt(monthStr, 10);

    const chineseYear = yearStr
      .split('')
      .map((d) => CHINESE_NUMBERS[parseInt(d, 10)])
      .join('');
    const chineseMonth = numberToChinese(month);

    return `${chineseYear}年${chineseMonth}月`;
  }

  // Try to parse the date
  let date: Date;

  // Handle different date formats
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    // Format: YYYY-MM-DD
    date = new Date(dateString);
  } else if (/^\d{4}\.\d{2}\.\d{2}$/.test(dateString)) {
    // Format: YYYY.MM.DD
    const parts = dateString.split('.');
    date = new Date(`${parts[0]}-${parts[1]}-${parts[2]}`);
  } else if (/^\d{4}年\d{1,2}月\d{1,2}日/.test(dateString)) {
    // Already in Chinese format, return as is
    return dateString;
  } else {
    // Try generic parsing
    date = new Date(dateString);
  }

  // Check if date is valid
  if (isNaN(date.getTime())) {
    return dateString; // Return original if parsing failed
  }

  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  // Convert year to Chinese (e.g., 2026 -> 二0二六)
  const yearStr = year.toString();
  const chineseYear = yearStr
    .split('')
    .map((d) => CHINESE_NUMBERS[parseInt(d, 10)])
    .join('');

  // Convert month and day
  const chineseMonth = numberToChinese(month);
  const chineseDay = numberToChinese(day);

  return `${chineseYear}年${chineseMonth}月${chineseDay}日`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Convert plain text to Word XML paragraphs with proper formatting
 * - 两端对齐 (justified alignment)
 * - 首行缩进2字符 (first line indent 2 characters, ~480 twips for 仿宋)
 * - Uses 仿宋 font for consistency with template
 * - Automatically splits numbered points (1. 2. 3.) into separate paragraphs
 * - Supports hierarchical numbering (1. → ①②③)
 *
 * Hierarchy rules:
 * - First level: 1. 2. 3. (Arabic numerals with period)
 * - Second level: ①②③ (Circled numbers) under each first-level point
 */
/**
 * Convert plain text to Word XML paragraphs for 报价表 text mode.
 * Formatting: 仿宋小四(12pt), 1.5倍行距, 首行缩进2字符, 两端对齐.
 * Only used for 报价表 — other fields use replacePlaceholderPreservingFormat.
 */
function textToFormattedParagraphs(text: string): string {
  if (!text || !text.trim()) {
    return '';
  }

  const lines = text.split('\n').filter((line) => line.trim());

  return lines
    .map((line) => {
      const escapedLine = escapeXml(line);

      return (
        `<w:p>` +
        `<w:pPr>` +
        `<w:spacing w:line="360" w:lineRule="auto"/>` +
        `<w:ind w:firstLineChars="200" w:firstLine="480"/>` +
        `<w:jc w:val="both"/>` +
        `</w:pPr>` +
        `<w:r>` +
        `<w:rPr>` +
        `<w:rFonts w:ascii="仿宋" w:eastAsia="仿宋" w:hAnsi="仿宋" w:cs="仿宋"/>` +
        `<w:sz w:val="24"/>` +
        `<w:szCs w:val="24"/>` +
        `</w:rPr>` +
        `<w:t xml:space="preserve">${escapedLine}</w:t>` +
        `</w:r>` +
        `</w:p>`
      );
    })
    .join('');
}

/**
 * Insert newline before hierarchical numbered markers in plain text.
 * Hierarchy: 1. 2. 3. → ①②③④⑤⑥⑦⑧⑨⑩ → (1)(2)(3)
 * Used for 商务要求、技术要求、特定资格要求、项目概况及采购内容 fields
 * so that both preview and exported DOCX render proper line breaks.
 */
function formatHierarchicalText(text: string): string {
  if (!text || !text.trim()) return text;

  // Normalize line endings
  let result = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Break before parenthesized numbers: (1) (2) (3)
  result = result.replace(/(\(\d+\))/g, '\n$1');

  // Break before first-level numbers: 1. 2. 3. (digit + period + space)
  result = result.replace(/(\d+\.\s)/g, '\n$1');

  // Break before circled numbers (①②③④⑤⑥⑦⑧⑨⑩)
  result = result.replace(/([①②③④⑤⑥⑦⑧⑨⑩]+)/g, '\n$1');

  // Clean up
  result = result.replace(/^\n/, '');
  result = result.replace(/\n+/g, '\n');

  return result.trim();
}

/**
 * 大写金额去尾「整」：询比/竞价/邀请招标/直接采购公告模板的金额占位符后自带「整」字
 * （「人民币{{最高限价1}}整」），调用方传入的大写值若也带「整」会拼出「元整整」
 * （实测「捌拾柒万叁仟元整整」）——归一为不带「整」，由模板补。
 */
function stripTrailingZheng(v?: string | null): string | undefined {
  const t = v?.trim();
  return t ? t.replace(/整$/, '') : (v ?? undefined);
}

function normalizeSubmissionRequirements(value: string): string {
  // DTO 字段可缺省（直调测试/导入场景）——空值直接归一为空串，不在此抛 500
  const trimmed = (value ?? '').trim();
  if (!trimmed) return '';

  return /^5[.．]\s*提交成果要求[:：]/.test(trimmed)
    ? trimmed
    : `5.提交成果要求：${trimmed}`;
}

function buildReplacement(
  label: string,
  value: string | undefined | null,
  allowEmpty: boolean = false,
): { replacementText: string; highlight: boolean } {
  // 如果允许为空且值为空字符串，返回空字符串
  if (allowEmpty && value === '') {
    return { replacementText: '', highlight: false };
  }
  if (!value) {
    return { replacementText: `请填写${label}`, highlight: true };
  }
  const trimmed = value.trim();
  return trimmed
    ? { replacementText: trimmed, highlight: false }
    : { replacementText: `请填写${label}`, highlight: true };
}

/**
 * Convert TableData to Word XML table
 * Uses 仿宋 for Chinese characters as default (consistent with template)
 * Table width is set to auto-fit to window
 */
/** 报价函模式解析（2026-09-09 拍板：优先表格）——显式选择按存值；
 * 未选择时：已有文字内容的老草稿保持文字（不吞存量），否则默认表格。 */
function resolveQuotationMode(answers: {
  quotationLetterType?: string;
  quotationLetter?: string;
}): 'text' | 'table' {
  if (answers.quotationLetterType === 'table' || answers.quotationLetterType === 'text') {
    return answers.quotationLetterType;
  }
  return answers.quotationLetter?.trim() ? 'text' : 'table';
}

/** 表格模式下无表数据时的兜底空表（与前端 createDefaultQuotationTable 同构）。 */
function defaultQuotationTable(): TableData {
  const headers = ['名称', '规格型号', '单位', '数量', '单价（元）', '合价（元）'];
  const cells = [
    headers.map((h) => ({ content: h, rowSpan: 1, colSpan: 1, align: 'center' as const })),
    ...Array.from({ length: 3 }, () =>
      headers.map((_, i) => ({ content: '', rowSpan: 1, colSpan: 1, align: (i <= 3 ? 'center' : 'right') as 'center' | 'right' })),
    ),
  ];
  return { rows: cells.length, cols: headers.length, cells };
}

function tableDataToWordXml(table: TableData): string {
  const rows: string[] = [];

  // ── 网格完整性（2026-09-09 修复：空单元格/合并单元格导出后线条缺失）──
  // Word 的 <w:tbl> 要求每行的 <w:tc> 数与 tblGrid 列数严格对齐：
  //  1. 纵向合并（rowSpan>1）覆盖的下方单元格必须仍然输出 <w:tc><w:vmerge/></w:tc> 续格，
  //     直接跳过会导致该行列数不足 → Word 修复表格 → 边框线缺失/错位；
  //  2. 未填写（模型缺失）的单元格也要输出空 <w:tc>，保持网格；
  //  3. 仅横向合并（colSpan）覆盖的同行单元格不输出（由 gridSpan 占位），维持原逻辑。
  // 预计算纵向合并覆盖：锚点 (r,c) rowSpan>1 时，其下方 (r+1..r+rowSpan-1, c..c+colSpan-1)
  // 均为 vmerge 续格，续格的 gridSpan 取锚点的 colSpan。
  const vmergeContinue = new Map<string, number>(); // "r,c" → 锚点 colSpan
  for (let r = 0; r < table.rows; r++) {
    for (let c = 0; c < table.cols; c++) {
      const anchor = table.cells[r]?.[c];
      if (!anchor || anchor.hidden || anchor.rowSpan <= 1) continue;
      for (let rr = r + 1; rr < Math.min(r + anchor.rowSpan, table.rows); rr++) {
        for (let cc = c; cc < Math.min(c + anchor.colSpan, table.cols); cc++) {
          vmergeContinue.set(`${rr},${cc}`, anchor.colSpan);
        }
      }
    }
  }

  const emptyCellXml = (gridSpan: number, vmerge: boolean) =>
    `<w:tc>` +
    `<w:tcPr>` +
    (vmerge ? '<w:vmerge/>' : '') +
    (gridSpan > 1 ? `<w:gridSpan w:val="${gridSpan}"/>` : '') +
    `<w:tcW w:w="0" w:type="auto"/>` +
    `</w:tcPr>` +
    `<w:p/>` +
    `</w:tc>`;

  for (let r = 0; r < table.rows; r++) {
    const cells: string[] = [];
    for (let c = 0; c < table.cols; c++) {
      // 纵向合并续格：输出 vmerge 续 tc（跳过模型中可能存在的 hidden 标记）
      const contSpan = vmergeContinue.get(`${r},${c}`);
      if (contSpan !== undefined) {
        cells.push(emptyCellXml(contSpan, true));
        // 横向被该续格覆盖的后续列一并消费
        c += contSpan - 1;
        continue;
      }
      const cell = table.cells[r]?.[c];
      if (!cell) {
        // 未填写的空单元格：输出空 tc，保住网格与边框
        cells.push(emptyCellXml(1, false));
        continue;
      }
      if (cell.hidden) continue; // 横向合并覆盖 → 不输出

      const alignValue =
        cell.align === 'center'
          ? 'center'
          : cell.align === 'right'
            ? 'right'
            : 'left';

      cells.push(
        `<w:tc>` +
          `<w:tcPr>` +
          (cell.rowSpan > 1 ? '<w:vmerge w:val="restart"/>' : '') +
          (cell.colSpan > 1 ? `<w:gridSpan w:val="${cell.colSpan}"/>` : '') +
          `<w:tcW w:w="0" w:type="auto"/>` +
          `<w:vAlign w:val="${alignValue}"/>` +
          `</w:tcPr>` +
          `<w:p><w:r><w:rPr><w:rFonts w:ascii="仿宋" w:eastAsia="仿宋" w:hAnsi="仿宋" w:cs="仿宋"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t xml:space="preserve">${escapeXml(cell.content ?? '')}</w:t></w:r></w:p>` +
          `</w:tc>`,
      );
    }
    // 整行被隐藏/缺失时兜底输出完整空行，避免出现 <w:tr> 无 <w:tc> 的非法结构
    if (cells.length === 0) {
      for (let c = 0; c < table.cols; c++) cells.push(emptyCellXml(1, false));
    }
    rows.push(`<w:tr>${cells.join('')}</w:tr>`);
  }

  // Calculate approximate column width for auto distribution
  // Use auto width so columns adjust to content and window
  const gridColWidth = Math.floor(9288 / table.cols); // 9288 twips ≈ full page width

  // Create table with borders and auto-fit to window
  return (
    `<w:tbl>` +
    `<w:tblPr>` +
    `<w:tblW w:w="0" w:type="auto"/>` +
    `<w:tblLayout w:type="autofit"/>` +
    `<w:tblBorders>` +
    `<w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `<w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `<w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `</w:tblBorders>` +
    `</w:tblPr>` +
    `<w:tblGrid>` +
    Array.from(
      { length: table.cols },
      () => `<w:gridCol w:w="${gridColWidth}"/>`,
    ).join('') +
    `</w:tblGrid>` +
    rows.join('') +
    `</w:tbl>`
  );
}

export type TemplateReplacement = {
  targetText: string;
  replacementText: string;
  highlight: boolean;
  isTable?: boolean;
  tableXml?: string;
  isFormattedText?: boolean; // 标记为需要格式化的文本（报价函等）
  formattedTextXml?: string; // 格式化后的文本XML
  isHierarchicalText?: boolean; // 标记含分级编号的文本（商务要求、技术要求等），导出时 \n 转为换行
  shouldDeleteLine?: boolean; // 标记需要删除整行（如服务内容选择"不包含"）
  shouldDeleteComprehensiveScoringTable?: boolean;
};


// ── 时间类字段兜底引擎（2026-09-08）：前端 AI 生成/手动填写遗漏时，后端按业务规则推导，
// 消除「请填写XX时间」占位——所有采购方式的 plan builder 统一经过 applyTimeFallbacks ──

/** 加 N 个工作日（跳过周六日） */
function addWorkdays(from: Date, days: number): Date {
  const d = new Date(from);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** Date → 'YYYY年MM月DD日HH:MM'（与前端 aiPrompt 输出格式一致） */
function fmtZh(dt: Date, hh: number, mm: number): string {
  const d = new Date(dt);
  d.setHours(hh, mm, 0, 0);
  return `${d.getFullYear()}年${pad2(d.getMonth() + 1)}月${pad2(d.getDate())}日${pad2(hh)}:${pad2(mm)}`;
}

/** 从「获取时间」区间串（…至YYYY年MM月DD日HH:MM）解析结束日期；失败返回今天 */
function parseAcquireEnd(acquireTime: string | undefined): Date {
  const m = (acquireTime || '').match(/至\s*(\d{4})年(\d{1,2})月(\d{1,2})日/) || (acquireTime || '').match(/(\d{4})年(\d{1,2})月(\d{1,2})日[^至]*$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date();
}

/** 时间类字段兜底（各字段空值才推导，已有值不覆盖） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyTimeFallbacks<T extends Record<string, any>>(answers: T): T {
  const out = { ...answers } as Record<string, any>;
  const today = new Date();
  const empty = (k: string) => !String(out[k] ?? '').trim();

  // 封面时间：空 → 当前年月
  if (empty('coverDate')) out.coverDate = `${today.getFullYear()}年${pad2(today.getMonth() + 1)}月`;

  // 文件获取时间：空 → 今天+3工作日09:00 至 +5工作日15:00
  if (empty('documentAcquireTime')) {
    out.documentAcquireTime = `${fmtZh(addWorkdays(today, 3), 9, 0)}至${fmtZh(addWorkdays(today, 5), 15, 0)}`;
  }

  const acquireEnd = parseAcquireEnd(out.documentAcquireTime);

  // 响应/递交/开标类截止时间：空 → 获取结束后+3工作日 14:00（单一直接来源为 09:00）
  if (empty('responseDeadline')) out.responseDeadline = fmtZh(addWorkdays(acquireEnd, 3), 14, 0);
  if (empty('responseSubmissionTime')) out.responseSubmissionTime = fmtZh(addWorkdays(acquireEnd, 3), 14, 0);
  if (empty('submissionAndNegotiationTime')) out.submissionAndNegotiationTime = fmtZh(addWorkdays(acquireEnd, 3), 9, 0);
  if (empty('bidOpeningTime')) out.bidOpeningTime = fmtZh(addWorkdays(acquireEnd, 3), 14, 0);
  return out as T;
}

export function buildCompetitiveNegotiationReplacementPlan(
  answers: CompetitiveNegotiationAnswers,
): TemplateReplacement[] {
  answers = applyTimeFallbacks(answers);
  // Handle quotation letter - could be text or table
  // 2026-09-09 拍板：优先表格——未显式选择且无文字存量时默认表格模式
  const isQuotationText = resolveQuotationMode(answers) !== 'table';
  let quotationReplacement: TemplateReplacement;
  if (!isQuotationText && (answers.quotationLetterTable || defaultQuotationTable())) {
    quotationReplacement = {
      targetText: '报价表',
      replacementText: '',
      highlight: false,
      isTable: true,
      tableXml: tableDataToWordXml(answers.quotationLetterTable || defaultQuotationTable()),
    };
  } else if (answers.quotationLetter && answers.quotationLetter.trim()) {
    // 文本模式的报价函，使用格式化段落
    quotationReplacement = {
      targetText: '报价表',
      replacementText: '',
      highlight: false,
      isFormattedText: true,
      formattedTextXml: textToFormattedParagraphs(answers.quotationLetter),
    };
  } else {
    quotationReplacement = {
      targetText: '报价表',
      ...buildReplacement('报价表', answers.quotationLetter),
    };
  }

  // Handle submission requirements - empty if type is "none"
  const submissionRequirementsValue =
    answers.submissionRequirementsType === 'none'
      ? ''
      : normalizeSubmissionRequirements(answers.submissionRequirements);

  // Handle contract subcontracting - checkbox format
  // ☐ = empty checkbox, ☑ = checked checkbox
  const contractSubcontracting1 =
    answers.contractSubcontractingType === 'none' ? '☑' : '☐';
  const contractSubcontracting2 =
    answers.contractSubcontractingType === 'allow' ? '☑' : '☐';
  const contractSubcontracting3 =
    answers.contractSubcontractingType === 'allow'
      ? answers.contractSubcontracting
      : '/';

  // 项目概况和采购内容、提交成果要求、商务要求、技术要求：内容替换，保留模板格式
  const projectOverviewReplacement: TemplateReplacement = {
    targetText: '项目概况和采购内容',
    ...buildReplacement('项目概况和采购内容', answers.projectOverview),
    isHierarchicalText: true,
  };

  const projectOverviewAliasReplacement: TemplateReplacement = {
    targetText: '项目概述及采购内容',
    ...buildReplacement('项目概述及采购内容', answers.projectOverview),
    isHierarchicalText: true,
  };

  const submissionRequirementsReplacement: TemplateReplacement = {
    targetText: '提交成果要求',
    ...buildReplacement('提交成果要求', submissionRequirementsValue, true),
    shouldDeleteLine: answers.submissionRequirementsType === 'none',
  };

  const businessRequirementsReplacement: TemplateReplacement = {
    targetText: '商务要求',
    ...buildReplacement('商务要求', answers.businessRequirements),
    isHierarchicalText: true,
  };

  const technicalRequirementsReplacement: TemplateReplacement = {
    targetText: '技术要求',
    ...buildReplacement('技术要求', answers.technicalRequirements),
    isHierarchicalText: true,
  };

  return [
    {
      targetText: '项目名称',
      ...buildReplacement('项目名称', answers.projectName),
    },
    {
      targetText: '封面时间',
      ...buildReplacement('封面时间', formatDateToChinese(answers.coverDate)),
    },
    {
      ...projectOverviewReplacement,
    },
    {
      ...projectOverviewAliasReplacement,
    },
    {
      targetText: '采购内容',
      ...buildReplacement('采购内容', answers.procurementContent),
      isHierarchicalText: true,
    },
    {
      targetText: '最高限价',
      ...buildReplacement('最高限价', answers.maxPrice),
    },
    {
      ...submissionRequirementsReplacement,
    },
    {
      targetText: '特定资格要求',
      ...buildReplacement('特定资格要求', answers.qualificationRequirements),
      isHierarchicalText: true,
    },
    {
      targetText: '文件获取时间',
      ...buildReplacement('文件获取时间', answers.documentAcquireTime),
    },
    {
      // 2026-09-09 拍板：原「响应文件提交截止时间」统一改「开标时间」（docx 模板已同步改名）
      targetText: '开标时间',
      ...buildReplacement('开标时间', answers.responseDeadline),
    },
    {
      targetText: '联系人',
      ...buildReplacement('联系人', answers.contactName),
    },
    {
      targetText: '联系电话',
      ...buildReplacement('联系电话', answers.contactPhone),
    },
    {
      targetText: '联系邮箱',
      ...buildReplacement('联系邮箱', answers.contactEmail),
    },
    {
      targetText: '合同分包1',
      replacementText: contractSubcontracting1,
      highlight: false,
    },
    {
      targetText: '合同分包2',
      replacementText: contractSubcontracting2,
      highlight: false,
    },
    {
      targetText: '合同分包3',
      replacementText: contractSubcontracting3,
      highlight: false,
    },
    {
      targetText: '是否组织现场踏勘',
      ...buildReplacement('是否组织现场踏勘', answers.siteSurvey),
    },
    businessRequirementsReplacement,
    technicalRequirementsReplacement,
    quotationReplacement,
  ];
}

export function buildSingleSourceReplacementPlan(
  answers: SingleSourceAnswers,
): TemplateReplacement[] {
  answers = applyTimeFallbacks(answers);
  // Handle quotation letter - could be text or table
  // 2026-09-09 拍板：优先表格——未显式选择且无文字存量时默认表格模式
  const isQuotationText = resolveQuotationMode(answers) !== 'table';
  let quotationReplacement: TemplateReplacement;
  if (!isQuotationText && (answers.quotationLetterTable || defaultQuotationTable())) {
    quotationReplacement = {
      targetText: '报价表',
      replacementText: '',
      highlight: false,
      isTable: true,
      tableXml: tableDataToWordXml(answers.quotationLetterTable || defaultQuotationTable()),
    };
  } else if (answers.quotationLetter && answers.quotationLetter.trim()) {
    quotationReplacement = {
      targetText: '报价表',
      replacementText: '',
      highlight: false,
      isFormattedText: true,
      formattedTextXml: textToFormattedParagraphs(answers.quotationLetter),
    };
  } else {
    quotationReplacement = {
      targetText: '报价表',
      ...buildReplacement('报价表', answers.quotationLetter),
    };
  }

  // 采购要求：内容替换，保留模板格式；空值时按采购内容生成通用要求要点（不再留「请填写采购要求」占位）
  const fallbackRequirements = [
    '1、供应商须按采购内容完整供货，产品质量符合国家现行标准及行业规范，并随货提供合格证明文件。',
    '2、供货周期：合同签订后按合同约定时间完成供货，供应商负责运输、安装调试及操作培训。',
    '3、验收方式：货到后由采购人按采购内容组织验收，验收合格后方可办理结算。',
    '4、质保要求：整机质保期不低于12个月，质保期内出现质量问题的，供应商负责免费维修或更换。',
  ].join('\n');
  const procurementRequirementsReplacement: TemplateReplacement = {
    targetText: '采购要求',
    ...buildReplacement('采购要求', answers.procurementRequirements?.trim() || fallbackRequirements),
    isHierarchicalText: true,
  };

  return [
    {
      targetText: '项目名称',
      ...buildReplacement('项目名称', answers.projectName),
    },
    {
      targetText: '封面时间',
      ...buildReplacement('封面时间', formatDateToChinese(answers.coverDate)),
    },
    {
      targetText: '供应商名称',
      ...buildReplacement('供应商名称', answers.supplierName),
    },
    {
      targetText: '项目预算价格',
      ...buildReplacement('项目预算价格', answers.projectBudget),
    },
    {
      targetText: '项目完成期限',
      ...buildReplacement('项目完成期限', answers.projectDuration),
    },
    {
      targetText: '采购文件获取时间',
      ...buildReplacement('采购文件获取时间', answers.documentAcquireTime),
    },
    {
      targetText: '采购文件售价',
      // 电子采购文件免费提供：售价缺失时兜底 0，不再留「请填写采购文件售价」占位
      ...buildReplacement('采购文件售价', answers.documentPrice || '0'),
    },
    {
      // 2026-09-09 拍板：原「递交和谈判时间」统一改「开标时间」（docx 模板已同步改名）
      targetText: '开标时间',
      ...buildReplacement(
        '开标时间',
        answers.submissionAndNegotiationTime,
      ),
    },
    {
      targetText: '联系人',
      ...buildReplacement('联系人', answers.contactName),
    },
    {
      targetText: '联系邮箱',
      ...buildReplacement('联系邮箱', answers.contactEmail),
    },
    {
      targetText: '联系电话',
      ...buildReplacement('联系电话', answers.contactPhone),
    },
    // 服务内容: 选择"不包含"时导出为空字符串并删除该行
    {
      targetText: '服务内容',
      ...buildReplacement(
        '服务内容',
        answers.serviceContent === '' ? '' : answers.serviceContent,
        true,
      ),
      shouldDeleteLine: answers.serviceContent === '',
    },
    {
      targetText: '采购内容',
      ...buildReplacement('采购内容', answers.procurementContent),
      isHierarchicalText: true,
    },
    procurementRequirementsReplacement,
    quotationReplacement,
  ];
}

export function buildInquiryPurchaseReplacementPlan(
  answers: InquiryPurchaseAnswers,
): TemplateReplacement[] {
  answers = applyTimeFallbacks(answers);
  // Handle quotation letter - could be text or table
  // 2026-09-09 拍板：优先表格——未显式选择且无文字存量时默认表格模式
  const isQuotationText = resolveQuotationMode(answers) !== 'table';
  let quotationReplacement: TemplateReplacement;
  if (!isQuotationText && (answers.quotationLetterTable || defaultQuotationTable())) {
    quotationReplacement = {
      targetText: '报价表',
      replacementText: '',
      highlight: false,
      isTable: true,
      tableXml: tableDataToWordXml(answers.quotationLetterTable || defaultQuotationTable()),
    };
  } else if (answers.quotationLetter && answers.quotationLetter.trim()) {
    quotationReplacement = {
      targetText: '报价表',
      replacementText: '',
      highlight: false,
      isFormattedText: true,
      formattedTextXml: textToFormattedParagraphs(answers.quotationLetter),
    };
  } else {
    quotationReplacement = {
      targetText: '报价表',
      ...buildReplacement('报价表', answers.quotationLetter),
    };
  }

  // 项目介绍、采购内容、需提供的资料：内容替换，保留模板格式
  const projectIntroductionReplacement: TemplateReplacement = {
    targetText: '项目介绍',
    ...buildReplacement('项目介绍', answers.projectIntroduction),
    isHierarchicalText: true,
  };

  const procurementContentReplacement: TemplateReplacement = {
    targetText: '采购内容',
    ...buildReplacement('采购内容', answers.procurementContent),
    isHierarchicalText: true,
  };

  const requiredDocumentsReplacement: TemplateReplacement = {
    targetText: '需提供的资料',
    ...buildReplacement('需提供的资料', answers.requiredDocuments),
  };

  return [
    {
      targetText: '项目名称',
      ...buildReplacement('项目名称', answers.projectName),
    },
    {
      targetText: '封面时间',
      ...buildReplacement('封面时间', formatDateToChinese(answers.coverDate)),
    },
    projectIntroductionReplacement,
    procurementContentReplacement,
    requiredDocumentsReplacement,
    {
      targetText: '评标方法',
      ...buildReplacement('评标方法', answers.evaluationMethod),
    },
    {
      targetText: '最高限价',
      ...buildReplacement('最高限价', answers.priceLimit),
    },
    {
      targetText: '采购文件获取时间',
      ...buildReplacement('采购文件获取时间', answers.documentAcquireTime),
    },
    {
      targetText: '开标时间',
      ...buildReplacement('开标时间', answers.bidOpeningTime),
    },
    {
      targetText: '联系人',
      ...buildReplacement('联系人', answers.contactName),
    },
    {
      targetText: '联系邮箱',
      ...buildReplacement('联系邮箱', answers.contactEmail),
    },
    {
      targetText: '联系电话',
      ...buildReplacement('联系电话', answers.contactPhone),
    },
    quotationReplacement,
  ];
}

export function buildInternalBiddingReplacementPlan(
  answers: InternalBiddingAnswers,
): TemplateReplacement[] {
  answers = applyTimeFallbacks(answers);
  // Handle quotation letter - could be text or table
  // 2026-09-09 拍板：优先表格——未显式选择且无文字存量时默认表格模式
  const isQuotationText = resolveQuotationMode(answers) !== 'table';
  let quotationReplacement: TemplateReplacement;
  if (!isQuotationText && (answers.quotationLetterTable || defaultQuotationTable())) {
    quotationReplacement = {
      targetText: '报价表',
      replacementText: '',
      highlight: false,
      isTable: true,
      tableXml: tableDataToWordXml(answers.quotationLetterTable || defaultQuotationTable()),
    };
  } else if (answers.quotationLetter && answers.quotationLetter.trim()) {
    quotationReplacement = {
      targetText: '报价表',
      replacementText: '',
      highlight: false,
      isFormattedText: true,
      formattedTextXml: textToFormattedParagraphs(answers.quotationLetter),
    };
  } else {
    quotationReplacement = {
      targetText: '报价表',
      ...buildReplacement('报价表', answers.quotationLetter),
    };
  }

  // Handle consortium form - checkbox format
  // ☐ = empty checkbox, ☑ = checked checkbox
  const consortiumForm1 = answers.consortiumFormType === 'accept' ? '☑' : '☐';
  const consortiumForm2 = answers.consortiumFormType === 'reject' ? '☑' : '☐';
  const consortiumFormValue =
    answers.consortiumFormType === 'accept' ? answers.consortiumForm : '/';

  // Handle contract subcontracting - checkbox format
  const contractSubcontracting1 =
    answers.contractSubcontractingType === 'none' ? '☑' : '☐';
  const contractSubcontracting2 =
    answers.contractSubcontractingType === 'allow' ? '☑' : '☐';
  const contractSubcontracting3 =
    answers.contractSubcontractingType === 'allow'
      ? answers.contractSubcontracting
      : '/';

  // Handle response deposit
  const isCollectingDeposit = answers.responseDepositType === 'collect';
  const deposit1 = isCollectingDeposit ? '☐' : '☑';
  const deposit2 = isCollectingDeposit ? '☑' : '☐';
  const deposit3 = isCollectingDeposit ? answers.responseDepositAmount : '';
  const deposit4 = isCollectingDeposit
    ? numberToChineseUppercase(answers.responseDepositAmount)
    : '';

  // Deposit form checkboxes
  const deposit5 = answers.responseDepositForm === 'cash' ? '☑' : '☐';
  const deposit6 =
    answers.responseDepositForm === 'cash'
      ? answers.responseDepositBankInfo
      : '/';
  const deposit7 = answers.responseDepositForm === 'bank_guarantee' ? '☑' : '☐';
  const deposit8 =
    answers.responseDepositForm === 'guarantee_institution' ? '☑' : '☐';
  const deposit9 = answers.responseDepositForm === 'insurance' ? '☑' : '☐';
  const deposit10 = answers.responseDepositForm === 'other' ? '☑' : '☐';
  const deposit11 =
    answers.responseDepositForm === 'other'
      ? answers.responseDepositOtherForm
      : '/';

  // Other requirement
  const deposit12 =
    answers.responseDepositOtherRequirementType === 'have'
      ? answers.responseDepositOtherRequirement
      : '/';

  // Non-refund situation
  // If not collecting deposit: deposit13=☑, deposit14=☐, deposit15=/
  // If collecting and no non-refund: deposit13=☑, deposit14=☐, deposit15=/
  // If collecting and has non-refund: deposit13=☐, deposit14=☑, deposit15=content
  const deposit13 =
    !isCollectingDeposit || answers.responseDepositNonRefundType === 'none'
      ? '☑'
      : '☐';
  const deposit14 =
    isCollectingDeposit && answers.responseDepositNonRefundType === 'have'
      ? '☑'
      : '☐';
  const deposit15 =
    isCollectingDeposit && answers.responseDepositNonRefundType === 'have'
      ? answers.responseDepositNonRefundContent
      : '/';

  // Handle performance deposit
  const isCollectingPerformanceDeposit =
    answers.performanceDepositType === 'collect';
  const perf1 = isCollectingPerformanceDeposit ? '☐' : '☑';
  const perf2 = isCollectingPerformanceDeposit ? '☑' : '☐';
  const perf3 = isCollectingPerformanceDeposit
    ? answers.performanceDepositAmount
    : '';

  // Performance deposit form checkboxes
  const perf4 = answers.performanceDepositForm === 'cash' ? '☑' : '☐';
  const perf5 = answers.performanceDepositForm === 'bank_guarantee' ? '☑' : '☐';
  const perf6 =
    answers.performanceDepositForm === 'guarantee_institution' ? '☑' : '☐';
  const perf7 = answers.performanceDepositForm === 'insurance' ? '☑' : '☐';
  const perf8 = answers.performanceDepositForm === 'other' ? '☑' : '☐';
  const perf9 =
    answers.performanceDepositForm === 'other'
      ? answers.performanceDepositOtherForm
      : '/';

  // Handle evaluation method
  const evalMethod1 = answers.evaluationMethod === '综合评分法' ? '☑' : '☐';
  const evalMethod2 = answers.evaluationMethod === '最低评标价法' ? '☑' : '☐';

  // Handle submission requirements - empty if type is "none"
  const submissionRequirementsValue =
    answers.submissionRequirementsType === 'none'
      ? ''
      : normalizeSubmissionRequirements(answers.submissionRequirements);
  const submissionRequirementsReplacement: TemplateReplacement = {
    targetText: '提交成果要求',
    ...buildReplacement('提交成果要求', submissionRequirementsValue, true),
    shouldDeleteLine: answers.submissionRequirementsType === 'none',
  };

  const projectOverviewReplacement: TemplateReplacement = {
    targetText: '项目概况和采购内容',
    ...buildReplacement('项目概况和采购内容', answers.projectOverview),
    isHierarchicalText: true,
  };

  const procurementContentReplacement: TemplateReplacement = {
    targetText: '采购内容',
    ...buildReplacement('采购内容', answers.procurementContent),
    isHierarchicalText: true,
  };

  const qualificationRequirementsReplacement: TemplateReplacement = {
    targetText: '特定资质要求',
    ...buildReplacement('特定资质要求', answers.qualificationRequirements),
    isHierarchicalText: true,
  };

  const businessRequirementsReplacement: TemplateReplacement = {
    targetText: '商务要求',
    ...buildReplacement('商务要求', answers.businessRequirements),
    isHierarchicalText: true,
  };

  const technicalRequirementsReplacement: TemplateReplacement = {
    targetText: '技术要求',
    ...buildReplacement('技术要求', answers.technicalRequirements),
    isHierarchicalText: true,
  };

  return [
    {
      targetText: '项目名称',
      ...buildReplacement('项目名称', answers.projectName),
    },
    {
      targetText: '封面时间',
      ...buildReplacement('封面时间', formatDateToChinese(answers.coverDate)),
    },
    projectOverviewReplacement,
    {
      targetText: '项目概述及采购内容',
      ...buildReplacement('项目概述及采购内容', answers.projectOverview),
      isHierarchicalText: true,
    },
    procurementContentReplacement,
    {
      targetText: '最高限价',
      ...buildReplacement('最高限价', answers.maxPrice),
    },
    submissionRequirementsReplacement,
    qualificationRequirementsReplacement,
    {
      targetText: '特定资格要求',
      ...buildReplacement('特定资格要求', answers.qualificationRequirements),
      isHierarchicalText: true,
    },
    {
      targetText: '联合体形式1',
      replacementText: consortiumForm1,
      highlight: false,
    },
    {
      targetText: '联合体形式2',
      replacementText: consortiumForm2,
      highlight: false,
    },
    {
      targetText: '联合体形式要求',
      replacementText: consortiumFormValue,
      highlight: false,
    },
    {
      targetText: '文件获取时间',
      ...buildReplacement('文件获取时间', answers.documentAcquireTime),
    },
    {
      targetText: '采购文件售价',
      // 电子采购文件免费提供：售价缺失时兜底 0，不再留「请填写采购文件售价」占位
      ...buildReplacement('采购文件售价', answers.documentPrice || '0'),
    },
    {
      // 2026-09-09 拍板：原「响应文件提交时间」统一改「开标时间」（docx 模板已同步改名）
      targetText: '开标时间',
      ...buildReplacement('开标时间', answers.responseSubmissionTime),
    },
    {
      targetText: '联系人',
      ...buildReplacement('联系人', answers.contactName),
    },
    {
      targetText: '联系电话',
      ...buildReplacement('联系电话', answers.contactPhone),
    },
    {
      targetText: '联系邮箱',
      ...buildReplacement('联系邮箱', answers.contactEmail),
    },
    // Response deposit placeholders
    { targetText: '响应保证金1', replacementText: deposit1, highlight: false },
    { targetText: '响应保证金2', replacementText: deposit2, highlight: false },
    { targetText: '响应保证金3', replacementText: deposit3, highlight: false },
    { targetText: '响应保证金4', replacementText: deposit4, highlight: false },
    { targetText: '响应保证金5', replacementText: deposit5, highlight: false },
    { targetText: '响应保证金6', replacementText: deposit6, highlight: false },
    { targetText: '响应保证金7', replacementText: deposit7, highlight: false },
    { targetText: '响应保证金8', replacementText: deposit8, highlight: false },
    { targetText: '响应保证金9', replacementText: deposit9, highlight: false },
    {
      targetText: '响应保证金10',
      replacementText: deposit10,
      highlight: false,
    },
    {
      targetText: '响应保证金11',
      replacementText: deposit11,
      highlight: false,
    },
    {
      targetText: '响应保证金12',
      replacementText: deposit12,
      highlight: false,
    },
    {
      targetText: '响应保证金13',
      replacementText: deposit13,
      highlight: false,
    },
    {
      targetText: '响应保证金14',
      replacementText: deposit14,
      highlight: false,
    },
    {
      targetText: '响应保证金15',
      replacementText: deposit15,
      highlight: false,
    },
    // Performance deposit placeholders
    { targetText: '履约保证金1', replacementText: perf1, highlight: false },
    { targetText: '履约保证金2', replacementText: perf2, highlight: false },
    { targetText: '履约保证金3', replacementText: perf3, highlight: false },
    { targetText: '履约保证金4', replacementText: perf4, highlight: false },
    { targetText: '履约保证金5', replacementText: perf5, highlight: false },
    { targetText: '履约保证金6', replacementText: perf6, highlight: false },
    { targetText: '履约保证金7', replacementText: perf7, highlight: false },
    { targetText: '履约保证金8', replacementText: perf8, highlight: false },
    { targetText: '履约保证金9', replacementText: perf9, highlight: false },
    // Evaluation method placeholders
    { targetText: '评标方法1', replacementText: evalMethod1, highlight: false },
    { targetText: '评标方法2', replacementText: evalMethod2, highlight: false },
    {
      targetText: '评标委员会人数',
      ...buildReplacement('评标委员会人数', answers.evaluationCommitteeCount ?? ''),
    },
    {
      targetText: '合同分包1',
      replacementText: contractSubcontracting1,
      highlight: false,
    },
    {
      targetText: '合同分包2',
      replacementText: contractSubcontracting2,
      highlight: false,
    },
    {
      targetText: '合同分包3',
      replacementText: contractSubcontracting3,
      highlight: false,
    },
    {
      targetText: '是否组织现场踏勘',
      ...buildReplacement('是否组织现场踏勘', answers.siteSurvey),
    },
    {
      targetText: '副本份数',
      ...buildReplacement('副本份数', answers.copyCount),
    },
    {
      targetText: '综合评分法评标标准',
      replacementText: '',
      highlight: false,
      shouldDeleteComprehensiveScoringTable:
        answers.evaluationMethod === '最低评标价法',
    },
    businessRequirementsReplacement,
    technicalRequirementsReplacement,
    quotationReplacement,
  ];
}

function deleteComprehensiveScoringTable(xml: string): string {
  // 遍历所有段落，提取纯文本（合并跨 <w:r>/<w:t> 的文本片段），
  // 定位含「六、综合评分法评标标准」的标题段落。
  // 「六、」和「综合评分法评标标准」在模板中常在不同 run 里，
  // 直接 regex 匹配 raw XML 会失败。
  let headingStart = -1;
  let headingEnd = -1;

  const pStarts: number[] = [];
  const psRe = /<w:p\b/g;
  let psMatch: RegExpExecArray | null;
  while ((psMatch = psRe.exec(xml)) !== null) {
    pStarts.push(psMatch.index);
  }

  const pEnds: number[] = [];
  const peRe = /<\/w:p>/g;
  let peMatch: RegExpExecArray | null;
  while ((peMatch = peRe.exec(xml)) !== null) {
    pEnds.push(peMatch.index + 6);
  }

  for (let i = 0; i < Math.min(pStarts.length, pEnds.length); i++) {
    const pStart = pStarts[i];
    const pEnd = pEnds[i];
    const pXml = xml.substring(pStart, pEnd);
    const texts = [
      ...pXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g),
    ].map((m) => m[1]);
    const plain = texts.join('').trim();
    if (/六、\s*综合评分法评标标准/.test(plain)) {
      headingStart = pStart;
      headingEnd = pEnd;
      break;
    }
  }

  if (headingStart < 0 || headingEnd < 0) {
    return xml;
  }

  const tableStart = xml.indexOf('<w:tbl', headingEnd);
  if (tableStart === -1) {
    return xml;
  }

  const chapterFourStart = xml.indexOf('第四章', headingEnd);
  if (chapterFourStart !== -1 && chapterFourStart < tableStart) {
    return xml;
  }

  const tableEnd = xml.indexOf('</w:tbl>', tableStart);
  if (tableEnd === -1) {
    return xml;
  }

  return xml.substring(0, headingStart) + xml.substring(tableEnd + 8);
}

export function normalizeCompetitiveNegotiationTemplateXml(xml: string) {
  return xml
    .replaceAll('{{封面日期)}}', '{{封面日期}}')
    .replaceAll('{{付款进程)}}', '{{付款进程}}');
}

export function highlightUnresolvedPlaceholders(xml: string) {
  return xml.replace(
    /<w:r>([\s\S]*?)<w:t([^>]*)>(\{\{[^<]+?\}\})<\/w:t>([\s\S]*?)<\/w:r>/g,
    (match, before, textAttrs, placeholder, after) => {
      if (/w:color w:val="FF0000"/.test(match)) {
        return match;
      }

      if (/<w:rPr>/.test(match)) {
        return match.replace('<w:rPr>', '<w:rPr><w:color w:val="FF0000"/>');
      }

      return `<w:r><w:rPr><w:color w:val="FF0000"/></w:rPr>${before}<w:t${textAttrs}>${placeholder}</w:t>${after}</w:r>`;
    },
  );
}

/**
 * Merge adjacent <w:t> tags within the same <w:r> to handle split placeholders
 * Optimized to avoid catastrophic backtracking on large XML files
 * NOTE: This function is currently disabled because it causes XML structure issues
 * with templates that have complex formatting. Keeping the function for reference.
 */
function mergeAdjacentTextTags(xml: string): string {
  // Disabled - return original XML
  // The mergeSplitPlaceholders function handles the placeholder merging correctly
  // without needing to merge adjacent text tags
  return xml;
}

/**
 * Merge split placeholders across multiple <w:r> elements
 * Handles cases like: {{</w:t></w:r>...<w:t>项目名称</w:t></w:r>...<w:t>}}
 * IMPORTANT: This function should be called BEFORE mergeAdjacentTextTags
 *
 * Key insight: When placeholders are split across runs, each <w:r> has identical <w:rPr>
 * (font properties). We need to preserve the font from the first run.
 */
function mergeSplitPlaceholders(xml: string): string {
  let result = xml;
  const paragraphPattern = /<w:p[\s\S]*?<\/w:p>/g;
  const paragraphs: { start: number; end: number; replacement: string }[] = [];
  let paragraphMatch;

  while ((paragraphMatch = paragraphPattern.exec(result)) !== null) {
    const paragraph = paragraphMatch[0];
    // 跳过不含 { 的段落。{{ 可能被 Word 拆成 { + { 跨 <w:r>
    if (!paragraph.includes('{')) {
      continue;
    }

    let runs = Array.from(
      paragraph.matchAll(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g),
    ).map((match: RegExpMatchArray) => ({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      xml: match[0],
      text: Array.from(match[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g))
        .map((textMatch: RegExpMatchArray) => textMatch[1])
        .join(''),
    }));

    let changed = false;
    let nextParagraph = paragraph;

    // ── Pre-pass: 合并被 Word 拆开的 { + { → {{ 和 } + } → }} ──
    const preReplacements: { start: number; end: number; xml: string }[] = [];
    for (let i = 0; i < runs.length - 1; i++) {
      if ((runs[i].xml.match(/<w:t[^>]*>/g) ?? []).length !== 1) continue;
      if ((runs[i + 1].xml.match(/<w:t[^>]*>/g) ?? []).length !== 1) continue;

      if (runs[i].text === '{' && runs[i + 1].text === '{') {
        const rPrMatch = runs[i].xml.match(/<w:rPr[^>]*>[\s\S]*?<\/w:rPr>/);
        const rPr = rPrMatch ? rPrMatch[0] : '';
        const merged = rPr
          ? `<w:r>${rPr}<w:t xml:space="preserve">{{</w:t></w:r>`
          : `<w:r><w:t xml:space="preserve">{{</w:t></w:r>`;
        preReplacements.push({ start: runs[i].start, end: runs[i + 1].end, xml: merged });
        i++;
      } else if (runs[i].text === '}' && runs[i + 1].text === '}') {
        const rPrMatch = runs[i].xml.match(/<w:rPr[^>]*>[\s\S]*?<\/w:rPr>/);
        const rPr = rPrMatch ? rPrMatch[0] : '';
        const merged = rPr
          ? `<w:r>${rPr}<w:t xml:space="preserve">}}</w:t></w:r>`
          : `<w:r><w:t xml:space="preserve">}}</w:t></w:r>`;
        preReplacements.push({ start: runs[i].start, end: runs[i + 1].end, xml: merged });
        i++;
      }
    }
    if (preReplacements.length > 0) {
      for (let i = preReplacements.length - 1; i >= 0; i--) {
        const r = preReplacements[i];
        nextParagraph =
          nextParagraph.substring(0, r.start) + r.xml + nextParagraph.substring(r.end);
      }
      changed = true;
      runs = Array.from(
        nextParagraph.matchAll(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g),
      ).map((match: RegExpMatchArray) => ({
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
        xml: match[0],
        text: Array.from(match[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g))
          .map((textMatch: RegExpMatchArray) => textMatch[1])
          .join(''),
      }));
    }

    const runReplacements: { start: number; end: number; xml: string }[] = [];

    for (let runIndex = 0; runIndex < runs.length; runIndex++) {
      if ((runs[runIndex].xml.match(/<w:t[^>]*>/g) ?? []).length !== 1) {
        continue;
      }

      const openOffset = runs[runIndex].text.indexOf('{{');
      if (openOffset === -1) {
        continue;
      }

      let combinedText = '';
      let closingRunIndex = -1;
      let closingOffset = -1;

      for (let searchIndex = runIndex; searchIndex < runs.length; searchIndex++) {
        if ((runs[searchIndex].xml.match(/<w:t[^>]*>/g) ?? []).length !== 1) {
          break;
        }

        const searchText =
          searchIndex === runIndex
            ? runs[searchIndex].text.slice(openOffset + 2)
            : runs[searchIndex].text;
        const previousLength = combinedText.length;
        combinedText += searchText;
        const found = combinedText.indexOf('}}');
        if (found !== -1) {
          closingRunIndex = searchIndex;
          closingOffset = found - previousLength;
          break;
        }
      }

      if (closingRunIndex === -1 || closingRunIndex === runIndex) {
        continue;
      }

      const firstRun = runs[runIndex];
      const closingRun = runs[closingRunIndex];
      const placeholderText = combinedText.slice(0, combinedText.indexOf('}}'));
      const prefixText = firstRun.text.slice(0, openOffset);
      const suffixText = closingRun.text.slice(closingOffset + 2);
      const rPrMatch = firstRun.xml.match(/<w:rPr[^>]*>[\s\S]*?<\/w:rPr>/);
      const rPr = rPrMatch ? rPrMatch[0] : '';
      const mergedText = `${prefixText}{{${placeholderText}}}${suffixText}`;
      const mergedRun = rPr
        ? `<w:r>${rPr}<w:t xml:space="preserve">${mergedText}</w:t></w:r>`
        : `<w:r><w:t xml:space="preserve">${mergedText}</w:t></w:r>`;

      runReplacements.push({
        start: firstRun.start,
        end: closingRun.end,
        xml: mergedRun,
      });
      changed = true;
      runIndex = closingRunIndex;
    }

    for (let i = runReplacements.length - 1; i >= 0; i--) {
      const replacement = runReplacements[i];
      nextParagraph =
        nextParagraph.substring(0, replacement.start) +
        replacement.xml +
        nextParagraph.substring(replacement.end);
    }

    if (changed) {
      paragraphs.push({
        start: paragraphMatch.index,
        end: paragraphMatch.index + paragraph.length,
        replacement: nextParagraph,
      });
    }
  }

  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const paragraph = paragraphs[i];
    result =
      result.substring(0, paragraph.start) +
      paragraph.replacement +
      result.substring(paragraph.end);
  }

  return result;
}

/**
 * Replace placeholder text within XML, preserving surrounding text
 * Only replaces {{target}} format placeholders, not plain text
 */
function replacePlaceholderInXml(
  xml: string,
  targetText: string,
  replacementText: string,
): string {
  const escapedTarget = escapeXml(targetText);
  const escapedReplacement = escapeXml(replacementText);

  // Pattern 1: {{target}} embedded in text within a single <w:t> tag
  // e.g., "最高限价{{356864}}元" -> "最高限价500000元"
  const embeddedWithBracesRegex = new RegExp(
    `(<w:t[^>]*>[^<]*)\\{\\{${escapedTarget}\\}\\}([^<]*</w:t>)`,
    'g',
  );
  let result = xml.replace(
    embeddedWithBracesRegex,
    `$1${escapedReplacement}$2`,
  );

  // Pattern 2: target}} embedded in text within a single <w:t> tag
  const embeddedMissingOpeningRegex = new RegExp(
    `(<w:t[^>]*>[^<]*)${escapedTarget}\\}\\}([^<]*</w:t>)`,
    'g',
  );
  result = result.replace(
    embeddedMissingOpeningRegex,
    `$1${escapedReplacement}$2`,
  );

  // Pattern 3: {{target}} is the entire content of <w:t> tag
  // e.g., "{{项目名称}}" -> "测试项目"
  const entireContentRegex = new RegExp(
    `(<w:t[^>]*>)\\{\\{${escapedTarget}\\}\\}(</w:t>)`,
    'g',
  );
  result = result.replace(entireContentRegex, `$1${escapedReplacement}$2`);

  return result;
}

export function renderCompetitiveNegotiationXml(
  xml: string,
  renderData: Record<string, string | null>,
): string {
  // First merge split placeholders across multiple <w:r> elements
  // This must be done BEFORE mergeAdjacentTextTags to preserve XML structure
  let output = mergeSplitPlaceholders(xml);

  // Then merge adjacent text tags within same <w:r>
  output = mergeAdjacentTextTags(output);

  // Normalize known template issues
  output = normalizeCompetitiveNegotiationTemplateXml(output);

  // Replace each placeholder - use replacePlaceholderInXml to preserve surrounding text
  for (const [key, value] of Object.entries(renderData)) {
    if (value !== null) {
      output = replacePlaceholderInXml(output, key, value);
    }
  }

  return highlightUnresolvedPlaceholders(output);
}

/**
 * Replace a placeholder paragraph with a table
 * Preserves the paragraph's formatting (pPr) and applies it to table rows
 * Only replaces {{target}} format placeholders
 */
function replaceParagraphWithTable(
  xml: string,
  targetText: string,
  tableXml: string,
): string {
  const escapedTarget = escapeXml(targetText);

  // Find all paragraphs and check if they contain the {{targetText}} placeholder
  let result = xml;
  const replacements: { start: number; end: number; pPr: string }[] = [];

  // Find all paragraph end tags
  const endPattern = /<\/w:p>/g;
  let match;

  while ((match = endPattern.exec(result)) !== null) {
    const pEnd = match.index + 6; // Include the </w:p> tag

    // Find the paragraph start by looking backwards for <w:p
    let pStart = -1;
    for (let i = match.index - 1; i >= 0; i--) {
      if (
        result.substring(i, i + 4) === '<w:p' &&
        (result[i + 4] === ' ' || result[i + 4] === '>')
      ) {
        // Find the end of the start tag
        let tagEnd = i + 4;
        while (tagEnd < result.length && result[tagEnd] !== '>') {
          tagEnd++;
        }
        tagEnd++; // Include the >
        pStart = i;
        break;
      }
    }

    if (pStart >= 0) {
      const paragraph = result.substring(pStart, pEnd);
      // Check if this paragraph contains {{targetText}} placeholder
      const placeholderPattern = new RegExp(`\\{\\{${escapedTarget}\\}\\}`);

      if (placeholderPattern.test(paragraph)) {
        // Extract paragraph properties (pPr) if present
        const pPrMatch = paragraph.match(/<w:pPr[^>]*>[\s\S]*?<\/w:pPr>/);
        const pPr = pPrMatch ? pPrMatch[0] : '';
        replacements.push({ start: pStart, end: pEnd, pPr });
      }
    }
  }

  // Apply replacements from end to start to preserve indices
  for (let i = replacements.length - 1; i >= 0; i--) {
    const { start, end, pPr } = replacements[i];
    // If there were paragraph properties, inject them into the table
    let finalTableXml = tableXml;
    if (pPr) {
      // Add pPr to each <w:p> in the table for consistent formatting
      finalTableXml = tableXml.replace(/<w:p>/g, `<w:p>${pPr}`);
    }
    result = result.substring(0, start) + finalTableXml + result.substring(end);
  }

  return result;
}

export function renderTemplateXml(
  xml: string,
  replacements: TemplateReplacement[],
): string {
  // First merge split placeholders across multiple <w:r> elements
  // This must be done BEFORE mergeAdjacentTextTags to preserve XML structure
  let output = mergeSplitPlaceholders(xml);

  // Then merge adjacent text tags within same <w:r>
  output = mergeAdjacentTextTags(output);

  const replaced = replacements.reduce((result, replacement) => {
    if (replacement.shouldDeleteComprehensiveScoringTable) {
      return deleteComprehensiveScoringTable(result);
    }

    // Handle table replacement differently - replace entire paragraph
    if (replacement.isTable && replacement.tableXml) {
      return replaceParagraphWithTable(
        result,
        replacement.targetText,
        replacement.tableXml,
      );
    }

    // Handle formatted text replacement - replace entire paragraph with formatted paragraphs
    if (replacement.isFormattedText && replacement.formattedTextXml) {
      return replaceParagraphWithFormattedText(
        result,
        replacement.targetText,
        replacement.formattedTextXml,
      );
    }

    // Handle line deletion - when shouldDeleteLine is true and replacement is empty
    if (replacement.shouldDeleteLine && replacement.replacementText === '') {
      return deleteParagraphWithPlaceholder(result, replacement.targetText);
    }

    // Handle hierarchical text - format numbered markers and convert \n to <w:br/>
    if (replacement.isHierarchicalText) {
      const formattedText = formatHierarchicalText(
        replacement.replacementText,
      );
      return replacePlaceholderPreservingFormat(
        result,
        replacement.targetText,
        formattedText,
        replacement.highlight,
        true,
      );
    }

    // Use replacePlaceholderPreservingFormat to preserve original font
    return replacePlaceholderPreservingFormat(
      result,
      replacement.targetText,
      replacement.replacementText,
      replacement.highlight,
    );
  }, output);

  return wrapCheckboxCharsInSymbolFont(replaced);
}

/**
 * Post-processing: wrap ☑ (U+2611) / ☐ (U+2610) checkbox characters in
 * separate <w:r> runs with Segoe UI Symbol font.  Without this step
 * the checkbox chars inherit the parent run's font (e.g. Times New Roman
 * or Apple Color Emoji) and render as coloured emoji icons instead of
 * clean outlined ballot-box glyphs.
 */
function wrapCheckboxCharsInSymbolFont(xml: string): string {
  const SYMBOL_RPR =
    '<w:rPr><w:rFonts w:ascii="Segoe UI Symbol" w:hAnsi="Segoe UI Symbol" ' +
    'w:eastAsia="Segoe UI Symbol" w:cs="Segoe UI Symbol"/></w:rPr>';

  const RUN_RE = /<w:r\b[\s\S]*?<\/w:r>/g;
  const CHECK = /[☐☑]/;

  const reps: Array<{ start: number; end: number; rebuilt: string }> = [];

  let m: RegExpExecArray | null;
  while ((m = RUN_RE.exec(xml)) !== null) {
    const run = m[0];
    if (!CHECK.test(run)) continue;
    if (/Segoe UI Symbol/i.test(run)) continue; // already correct

    const rTag = run.match(/^<w:r[^>]*>/)?.[0];
    if (!rTag) continue;

    const origRPr = run.match(/<w:rPr[^>]*>[\s\S]*?<\/w:rPr>/)?.[0] ?? '';

    const tMatch = run.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/);
    if (!tMatch) continue;
    const tOpen = tMatch[0].match(/<w:t[^>]*>/)?.[0] ?? '<w:t>';
    const text = tMatch[1];

    // Split around checkbox chars (capturing parens keep them in the array)
    const segments = text.split(/([☐☑])/);

    let rebuilt = '';
    for (const seg of segments) {
      if (!seg) continue;
      if (CHECK.test(seg)) {
        rebuilt += `<w:r>${SYMBOL_RPR}${tOpen}${seg}</w:t></w:r>`;
      } else {
        rebuilt += `${rTag}${origRPr}${tOpen}${seg}</w:t></w:r>`;
      }
    }

    reps.push({ start: m.index, end: m.index + run.length, rebuilt });
  }

  // Apply end → start so earlier indices stay valid
  for (let i = reps.length - 1; i >= 0; i--) {
    const r = reps[i];
    xml = xml.slice(0, r.start) + r.rebuilt + xml.slice(r.end);
  }

  return xml;
}

/**
 * Delete a paragraph containing the target placeholder
 * Used for service content when "不包含" is selected
 */
function deleteParagraphWithPlaceholder(
  xml: string,
  targetText: string,
): string {
  const escapedTarget = escapeXml(targetText);

  // Find all paragraphs and check if they contain the {{targetText}} placeholder
  let result = xml;
  const deletions: { start: number; end: number }[] = [];

  // Find all paragraph end tags
  const endPattern = /<\/w:p>/g;
  let match;

  while ((match = endPattern.exec(result)) !== null) {
    const pEnd = match.index + 6; // Include the </w:p> tag

    // Find the paragraph start by looking backwards for <w:p
    let pStart = -1;
    for (let i = match.index - 1; i >= 0; i--) {
      if (
        result.substring(i, i + 4) === '<w:p' &&
        (result[i + 4] === ' ' || result[i + 4] === '>')
      ) {
        pStart = i;
        break;
      }
    }

    if (pStart >= 0) {
      const paragraph = result.substring(pStart, pEnd);
      // Check if this paragraph contains {{targetText}} placeholder
      const placeholderPattern = new RegExp(`\\{\\{${escapedTarget}\\}\\}`);

      if (placeholderPattern.test(paragraph)) {
        deletions.push({ start: pStart, end: pEnd });
      }
    }
  }

  // Apply deletions from end to start to preserve indices
  for (let i = deletions.length - 1; i >= 0; i--) {
    const { start, end } = deletions[i];
    result = result.substring(0, start) + result.substring(end);
  }

  return result;
}

/**
 * Replace a placeholder paragraph with formatted text (multiple paragraphs)
 * Used for quotation letter text mode - applies 两端对齐 and 首行缩进
 */
function replaceParagraphWithFormattedText(
  xml: string,
  targetText: string,
  formattedTextXml: string,
): string {
  const escapedTarget = escapeXml(targetText);

  // Find all paragraphs and check if they contain the {{targetText}} placeholder
  let result = xml;
  const replacements: { start: number; end: number }[] = [];

  // Find all paragraph end tags
  const endPattern = /<\/w:p>/g;
  let match;

  while ((match = endPattern.exec(result)) !== null) {
    const pEnd = match.index + 6; // Include the </w:p> tag

    // Find the paragraph start by looking backwards for <w:p
    let pStart = -1;
    for (let i = match.index - 1; i >= 0; i--) {
      if (
        result.substring(i, i + 4) === '<w:p' &&
        (result[i + 4] === ' ' || result[i + 4] === '>')
      ) {
        pStart = i;
        break;
      }
    }

    if (pStart >= 0) {
      const paragraph = result.substring(pStart, pEnd);
      // Check if this paragraph contains {{targetText}} placeholder
      const placeholderPattern = new RegExp(`\\{\\{${escapedTarget}\\}\\}`);

      if (placeholderPattern.test(paragraph)) {
        replacements.push({ start: pStart, end: pEnd });
      }
    }
  }

  // Apply replacements from end to start to preserve indices
  for (let i = replacements.length - 1; i >= 0; i--) {
    const { start, end } = replacements[i];
    result =
      result.substring(0, start) + formattedTextXml + result.substring(end);
  }

  return result;
}

/**
 * Replace placeholder preserving the original font format from the template
 * Finds the <w:rPr> in the containing <w:r> and preserves it
 */
function replacePlaceholderPreservingFormat(
  xml: string,
  targetText: string,
  replacementText: string,
  highlight: boolean,
  convertLineBreaks: boolean = false,
): string {
  const escapedTarget = escapeXml(targetText);
  const escapedReplacement = escapeXml(replacementText);

  let result = xml;

  // STEP 1: Handle complete placeholders FIRST (where {{target}} is the entire <w:t> content).
  // This must run before the embedded regex so that convertLineBreaks (\n → <w:br/>) is applied.
  // The embedded regex also matches complete placeholders, so if it ran first, this code path
  // would never execute and line breaks would never be converted to Word <w:br/> elements.
  const completePlaceholderRegex = new RegExp(
    `<w:t[^>]*>\\{\\{${escapedTarget}\\}\\}</w:t>`,
    'g',
  );

  const matches: {
    start: number;
    end: number;
    rStart: number;
    rEnd: number;
    rPr: string;
  }[] = [];

  let match;
  while ((match = completePlaceholderRegex.exec(result)) !== null) {
    const tStart = match.index;
    const tEnd = match.index + match[0].length;

    // Find the containing <w:r> element
    let rStart = -1;
    for (let i = tStart - 1; i >= 0; i--) {
      if (
        result.substring(i, i + 4) === '<w:r' &&
        (result[i + 4] === ' ' || result[i + 4] === '>')
      ) {
        rStart = i;
        break;
      }
    }

    if (rStart === -1) continue;

    // Find the end of this <w:r>
    const rEnd = result.indexOf('</w:r>', tEnd) + 6;
    if (rEnd <= tEnd) continue;

    // Extract rPr from the containing <w:r>
    const runContent = result.substring(rStart, rEnd);
    const rPrMatch = runContent.match(/<w:rPr[^>]*>[\s\S]*?<\/w:rPr>/);
    const rPr = rPrMatch ? rPrMatch[0] : '';

    matches.push({ start: tStart, end: tEnd, rStart, rEnd, rPr });
  }

  // Also find any remaining placeholders that might be in merged format
  // (after mergeSplitPlaceholders, they should be in single <w:t> but let's be safe)
  if (matches.length === 0) {
    // Try finding the placeholder text directly in the merged format
    const mergedPlaceholderRegex = new RegExp(
      `<w:r>.*?<w:t[^>]*>\\{\\{${escapedTarget}\\}\\}</w:t>.*?</w:r>`,
      'g',
    );

    while ((match = mergedPlaceholderRegex.exec(result)) !== null) {
      const rStart = match.index;
      const rEnd = match.index + match[0].length;

      // Extract the placeholder position within the run
      const runContent = match[0];
      const tMatch = runContent.match(/<w:t[^>]*>([^<]*)<\/w:t>/);
      if (!tMatch) continue;

      const rPrMatch = runContent.match(/<w:rPr[^>]*>[\s\S]*?<\/w:rPr>/);
      const rPr = rPrMatch ? rPrMatch[0] : '';

      // Calculate actual positions
      const placeholderTextStart = rStart + runContent.indexOf(tMatch[1]);
      const placeholderTextEnd = placeholderTextStart + tMatch[1].length;

      matches.push({
        start: placeholderTextStart,
        end: placeholderTextEnd,
        rStart,
        rEnd,
        rPr,
      });
    }
  }

  // Process from end to start to preserve indices
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];

    // Build new <w:r> with preserved rPr
    let newRPr = m.rPr;
    if (highlight) {
      // Add red color to rPr
      if (newRPr) {
        // Insert color into existing rPr
        newRPr = newRPr.replace(
          '</w:rPr>',
          '<w:color w:val="FF0000"/></w:rPr>',
        );
      } else {
        newRPr = '<w:rPr><w:color w:val="FF0000"/></w:rPr>';
      }
    }

    // For hierarchical text, convert \n to Word line breaks (<w:br/>)
    const finalReplacement = convertLineBreaks
      ? escapedReplacement.replace(
          /\n/g,
          '</w:t><w:br/><w:t xml:space="preserve">',
        )
      : escapedReplacement;

    // Create new run with preserved format
    const newRun = newRPr
      ? `<w:r>${newRPr}<w:t xml:space="preserve">${finalReplacement}</w:t></w:r>`
      : `<w:r><w:t xml:space="preserve">${finalReplacement}</w:t></w:r>`;

    // Replace the entire <w:r> element
    result = result.substring(0, m.rStart) + newRun + result.substring(m.rEnd);
  }

  // STEP 2: Handle remaining embedded placeholders (where {{target}} is part of larger text)
  const embeddedPlaceholderRegex = new RegExp(
    `(<w:t[^>]*>[^<]*)\\{\\{${escapedTarget}\\}\\}([^<]*</w:t>)`,
    'g',
  );

  if (convertLineBreaks) {
    result = result.replace(embeddedPlaceholderRegex, (_match, before, after) => {
      const replacement = escapedReplacement.replace(
        /\n/g,
        '</w:t><w:br/><w:t xml:space="preserve">',
      );
      return `${before}${replacement}${after}`;
    });
  } else {
    result = result.replace(
      embeddedPlaceholderRegex,
      `$1${escapedReplacement}$2`,
    );
  }

  return result;
}

// ─── Announcement Templates ───

export const INVITED_BIDDING_ANNOUNCEMENT_TEMPLATE_FILE =
  '模板文件/邀请招标公告模板.docx';
export const INTERNAL_BIDDING_ANNOUNCEMENT_TEMPLATE_FILE =
  '模板文件/竞价采购公告.docx';
export const INQUIRY_PURCHASE_ANNOUNCEMENT_TEMPLATE_FILE =
  '模板文件/询比采购公示.docx';
export const SINGLE_SOURCE_ANNOUNCEMENT_TEMPLATE_FILE =
  '模板文件/直接采购公告模板.docx';
export const FAILED_BID_ANNOUNCEMENT_TEMPLATE_FILE = '模板文件/流标公示模板.docx';
export const WINNING_BID_ANNOUNCEMENT_TEMPLATE_FILE = '模板文件/中标公告模板.docx';
export const NOTIFICATION_LETTER_TEMPLATE_FILE = '模板文件/中标通知书模板.docx';

export type AnnouncementCategory =
  | 'procurement_document'
  | 'failed_bid'
  | 'winning_bid';

export type AnnouncementDraft = {
  projectName?: string;
  projectOverview?: string;
  maxPriceChinese?: string;
  maxPriceNumeric?: string;
  scheduleRequirements?: string;
  registrationMethod?: string;
  announcementStart?: string;
  announcementEnd?: string;
  announcementDays?: string;
  bidOpeningTime?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  signatureDate?: string;
  argumentOpinion?: string;
  supplierName?: string;
  supplierAddress?: string;
  procurementTime?: string;
  projectBriefDescription?: string;
  resultInfo?: string;
  maxPrice?: string;
  bidder1Name?: string;
  bidder1Price?: string;
  bidder1Remark?: string;
  bidder2Name?: string;
  bidder2Price?: string;
  bidder2Remark?: string;
  bidder3Name?: string;
  bidder3Price?: string;
  bidder3Remark?: string;
  [key: string]: string | undefined;
};

function formatAnnouncementDateToChinese(dateString: string): string {
  if (!dateString?.trim()) return dateString;
  if (/^\d{4}-\d{2}$/.test(dateString)) {
    const [yearStr, monthStr] = dateString.split('-');
    return `${yearStr}年${parseInt(monthStr, 10)}月`;
  }
  // Handle datetime-local format: "2026-05-05T10:30" → "2026年5月5日10:30"
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dateString)) {
    const [datePart, timePart] = dateString.split('T');
    const [yearStr, monthStr, dayStr] = datePart.split('-');
    return `${yearStr}年${parseInt(monthStr, 10)}月${parseInt(dayStr, 10)}日${timePart}`;
  }
  let date: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    date = new Date(dateString);
  } else if (/^\d{4}\.\d{2}\.\d{2}$/.test(dateString)) {
    const parts = dateString.split('.');
    date = new Date(`${parts[0]}-${parts[1]}-${parts[2]}`);
  } else if (/^\d{4}年\d{1,2}月\d{1,2}日/.test(dateString)) {
    return dateString;
  } else {
    date = new Date(dateString);
  }
  if (isNaN(date.getTime())) return dateString;
  const yearStr = date.getFullYear().toString();
  return `${yearStr}年${date.getMonth() + 1}月${date.getDate()}日`;
}

/**
 * Format bid opening time: if type is "text", pass through as-is (e.g. "另行通知").
 * If type is "datetime" or empty, format as Chinese date with time.
 */
function formatBidOpeningTime(
  timeValue: string | undefined,
  timeType: string | undefined,
): string {
  if (!timeValue?.trim()) return '';
  // If text mode, return the text value directly
  if (timeType === 'text') return timeValue;
  // Otherwise format as date (handles datetime-local format too)
  return formatAnnouncementDateToChinese(timeValue);
}

export function buildInvitedBiddingAnnouncementPlan(
  answers: AnnouncementDraft,
): TemplateReplacement[] {
  return [
    { targetText: '项目名称', ...buildReplacement('项目名称', answers.projectName) },
    { targetText: '项目概况和采购内容', ...buildReplacement('项目概况和采购内容', answers.projectOverview), isHierarchicalText: true },
    // 模板（询比采购公示/竞价采购公告/邀请招标公告）占位符为编号式：{{最高限价1}}（大写）/ {{最高限价2}}（小写）。
    // 旧版括号式目标（最高限价（大写）等）在模板中不存在 → 占位符原样残留（用户实测反馈）。
    { targetText: '最高限价1', ...buildReplacement('最高限价（大写）', stripTrailingZheng(answers.maxPriceChinese)) },
    { targetText: '最高限价2', ...buildReplacement('最高限价（小写）', answers.maxPriceNumeric) },
    { targetText: '工期及进度要求', ...buildReplacement('工期及进度要求', answers.scheduleRequirementsType === 'none' ? '无' : answers.scheduleRequirements), isHierarchicalText: true },
    { targetText: '报名方式及条件', ...buildReplacement('报名方式及条件', answers.registrationMethod), isHierarchicalText: true },
    // 模板占位符为编号式：{{公示期限1}}（起）/ {{公示期限2}}（止）
    { targetText: '公示期限1', ...buildReplacement('公示期限（起）', formatAnnouncementDateToChinese(answers.announcementStart || '')) },
    { targetText: '公示期限2', ...buildReplacement('公示期限（止）', formatAnnouncementDateToChinese(answers.announcementEnd || '')) },
    { targetText: '开标时间', ...buildReplacement('开标时间', formatBidOpeningTime(answers.bidOpeningTime, answers.bidOpeningTimeType)) },
    { targetText: '联系人', ...buildReplacement('联系人', answers.contactName) },
    { targetText: '联系电话', ...buildReplacement('联系电话', answers.contactPhone) },
    { targetText: '联系邮箱', ...buildReplacement('联系邮箱', answers.contactEmail) },
    { targetText: '落款日期', ...buildReplacement('落款日期', formatAnnouncementDateToChinese(answers.signatureDate || '')) },
  ];
}

export function buildInternalBiddingAnnouncementPlan(
  answers: AnnouncementDraft,
): TemplateReplacement[] {
  return buildInvitedBiddingAnnouncementPlan(answers);
}

export function buildSingleSourceAnnouncementPlan(
  answers: AnnouncementDraft,
): TemplateReplacement[] {
  return [
    { targetText: '项目名称', ...buildReplacement('项目名称', answers.projectName) },
    { targetText: '项目概况和采购内容', ...buildReplacement('项目概况和采购内容', answers.projectOverview), isHierarchicalText: true },
    // 模板占位符为 {{最高限价1}}（大写）/ {{最高限价2}}（小写）
    { targetText: '最高限价1', ...buildReplacement('预算金额（大写）', stripTrailingZheng(answers.maxPriceChinese)) },
    { targetText: '最高限价2', ...buildReplacement('预算金额（小写）', answers.maxPriceNumeric) },
    { targetText: '论证意见', ...buildReplacement('论证意见', answers.argumentOpinion), isHierarchicalText: true },
    { targetText: '供应商名称', ...buildReplacement('供应商名称', answers.supplierName) },
    { targetText: '供应商地址', ...buildReplacement('供应商地址', answers.supplierAddress) },
    // 模板占位符为 {{公示期限1}}（起）/ {{公示期限2}}（止）/ {{公示期限3}}（天数）
    { targetText: '公示期限1', ...buildReplacement('公示期限（起）', formatAnnouncementDateToChinese(answers.announcementStart || '')) },
    { targetText: '公示期限2', ...buildReplacement('公示期限（止）', formatAnnouncementDateToChinese(answers.announcementEnd || '')) },
    { targetText: '公示期限3', ...buildReplacement('公示天数', answers.announcementDays) },
    { targetText: '采购时间', ...buildReplacement('采购时间', formatAnnouncementDateToChinese(answers.procurementTime || '')) },
    { targetText: '落款日期', ...buildReplacement('落款日期', formatAnnouncementDateToChinese(answers.signatureDate || '')) },
  ];
}

export function buildFailedBidAnnouncementPlan(
  answers: AnnouncementDraft,
): TemplateReplacement[] {
  return [
    { targetText: '项目名称', ...buildReplacement('项目名称', answers.projectName) },
    { targetText: '项目简要说明', ...buildReplacement('项目简要说明', answers.projectBriefDescription), isHierarchicalText: true },
    { targetText: '开标时间', ...buildReplacement('开标时间', formatBidOpeningTime(answers.bidOpeningTime, answers.bidOpeningTimeType)) },
    { targetText: '开标结果公示信息', ...buildReplacement('开标结果公示信息', answers.resultInfo), isHierarchicalText: true },
    { targetText: '落款日期', ...buildReplacement('落款日期', formatAnnouncementDateToChinese(answers.signatureDate || '')) },
  ];
}

export function buildWinningBidAnnouncementPlan(
  answers: AnnouncementDraft,
): TemplateReplacement[] {
  // Collect dynamic bidders
  const bidders: Array<{ name: string; price: string }> = [];
  for (let i = 1; i <= 20; i++) {
    const name = answers[`bidder${i}Name`] ?? '';
    const price = answers[`bidder${i}Price`] ?? '';
    if (name.trim() || price.trim()) {
      bidders.push({ name, price });
    }
  }

  const rankLabels = ['第一名', '第二名', '第三名', '第四名', '第五名', '第六名', '第七名', '第八名', '第九名', '第十名'];

  // Build replacement plan
  const replacements: TemplateReplacement[] = [
    { targetText: '项目名称', ...buildReplacement('项目名称', answers.projectName) },
    { targetText: '项目简要说明', ...buildReplacement('项目简要说明', answers.projectBriefDescription), isHierarchicalText: true },
    // 模板占位符为编号式：{{最高限价1}}（大写）/ {{最高限价2}}（小写）——
    // 与询比/竞价/邀请招标公告同一套口径（旧版括号式目标在模板中不存在 → 占位符原样残留）
    { targetText: '最高限价1', ...buildReplacement('最高限价（大写）', stripTrailingZheng(answers.maxPriceChinese)) },
    { targetText: '最高限价2', ...buildReplacement('最高限价（小写）', answers.maxPrice) },
    { targetText: '开标时间', ...buildReplacement('开标时间', formatBidOpeningTime(answers.bidOpeningTime, answers.bidOpeningTimeType)) },
    // 正文「中标金额为人民币{{中标金额1}}（￥{{中标金额2}}）」：第一名报价大小写
    ...(bidders.length > 0
      ? [
          { targetText: '中标金额1', ...buildReplacement('中标金额（大写）', numberToChineseUppercase(bidders[0].price)) },
          { targetText: '中标金额2', ...buildReplacement('中标金额（小写）', bidders[0].price) },
        ]
      : []),
    // 公示期限（2026-09-07）：此前模板硬编码「1日」，与数据层 3 天公示期（发布后顺延）
    // 不一致——占位符化后取 draft.publicityPeriod（前端向导自动填「X日 至 Y日（3天）」），
    // 兜底法定 3 日
    { targetText: '公示期限', replacementText: answers.publicityPeriod?.trim() || '3日', highlight: false },
  ];

  // Generate the full bidder table as a replacement
  // The template has 4 table rows: header + 3 data rows
  // We replace the entire bidder data section with dynamic rows
  if (bidders.length > 0) {
    replacements.push(
      { targetText: '投标单位1', ...buildReplacement('投标单位1', bidders[0]?.name ?? '') },
      { targetText: '报价1', ...buildReplacement('报价1', bidders[0]?.price ?? '') },
      { targetText: '备注', ...buildReplacement('备注', answers.bidder1Remark) },
    );

    // If only 1 bidder, fill row 2 & 3 with the bidder name but mark for deletion if needed
    if (bidders.length >= 2) {
      replacements.push(
        { targetText: '投标单位2', ...buildReplacement('投标单位2', bidders[1]?.name ?? '') },
        { targetText: '报价2', ...buildReplacement('报价2', bidders[1]?.price ?? '') },
      );
    } else {
      // Clear row 2 & 3 placeholders
      replacements.push(
        { targetText: '投标单位2', replacementText: '', highlight: false },
        { targetText: '报价2', replacementText: '', highlight: false },
      );
    }

    if (bidders.length >= 3) {
      replacements.push(
        { targetText: '投标单位3', ...buildReplacement('投标单位3', bidders[2]?.name ?? '') },
        { targetText: '报价3', ...buildReplacement('报价3', bidders[2]?.price ?? '') },
      );
    } else {
      replacements.push(
        { targetText: '投标单位3', replacementText: '', highlight: false },
        { targetText: '报价3', replacementText: '', highlight: false },
      );
    }
  }

  replacements.push(
    { targetText: '落款日期', ...buildReplacement('落款日期', formatAnnouncementDateToChinese(answers.signatureDate || '')) },
  );

  return replacements;
}

// ─── 中标通知书 ───

export type NotificationLetterDraft = {
  projectName?: string;
  winnerName?: string;
  winnerPrice?: string;
  winnerPriceChinese?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  signatureDate?: string;
};

export function buildNotificationLetterPlan(
  draft: NotificationLetterDraft,
): TemplateReplacement[] {
  // formatAnnouncementDateToChinese already handles Chinese date (pass through), ISO date (convert), and empty
  const chineseDate = formatAnnouncementDateToChinese(draft.signatureDate || '');
  return [
    { targetText: '中标单位名称', ...buildReplacement('中标单位名称', draft.winnerName) },
    { targetText: '项目名称', ...buildReplacement('项目名称', draft.projectName) },
    { targetText: '中标金额1', ...buildReplacement('中标金额1', draft.winnerPrice) },
    { targetText: '中标金额2', ...buildReplacement('中标金额2', draft.winnerPriceChinese) },
    { targetText: '联系人', replacementText: draft.contactName?.trim() || ' ', highlight: false },
    { targetText: '联系电话', replacementText: draft.contactPhone?.trim() || ' ', highlight: false },
    { targetText: '联系邮箱', replacementText: draft.contactEmail?.trim() || ' ', highlight: false },
    { targetText: '落款日期', replacementText: chineseDate || ' ', highlight: false },
  ];
}
