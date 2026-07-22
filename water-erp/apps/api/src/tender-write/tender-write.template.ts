import type {
  CompetitiveNegotiationAnswers,
  InquiryPurchaseAnswers,
  SingleSourceAnswers,
  InternalBiddingAnswers,
  TableData,
} from './tender-write.types';

export const COMPETITIVE_NEGOTIATION_TEMPLATE_FILE =
  '模板文件/谈判采购模板.docx';
export const SINGLE_SOURCE_TEMPLATE_FILE = '模板文件/直接采购模板.docx';
export const INQUIRY_PURCHASE_TEMPLATE_FILE = '模板文件/询比采购模板.docx';
export const INTERNAL_BIDDING_TEMPLATE_FILE =
  '模板文件/竞价采购模板.docx';
export const INVITED_BIDDING_TEMPLATE_FILE = '模板文件/邀请招标模板.docx';

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
      zeroFlag = true;
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

function normalizeSubmissionRequirements(value: string): string {
  const trimmed = value.trim();
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
function tableDataToWordXml(table: TableData): string {
  const rows: string[] = [];

  for (let r = 0; r < table.rows; r++) {
    const cells: string[] = [];
    for (let c = 0; c < table.cols; c++) {
      const cell = table.cells[r]?.[c];
      if (!cell || cell.hidden) continue;

      const alignValue =
        cell.align === 'center'
          ? 'center'
          : cell.align === 'right'
            ? 'right'
            : 'left';
      const rowSpanAttr = cell.rowSpan > 1 ? ` w:val="${cell.rowSpan}"` : '';
      const colSpanAttr = cell.colSpan > 1 ? ` w:val="${cell.colSpan}"` : '';

      cells.push(
        `<w:tc>` +
          `<w:tcPr>` +
          (rowSpanAttr ? `<w:vmerge w:val="restart"/>` : '') +
          (colSpanAttr ? `<w:gridSpan${colSpanAttr}/>` : '') +
          `<w:tcW w:w="0" w:type="auto"/>` +
          `<w:vAlign w:val="${alignValue}"/>` +
          `</w:tcPr>` +
          `<w:p><w:r><w:rPr><w:rFonts w:ascii="仿宋" w:eastAsia="仿宋" w:hAnsi="仿宋" w:cs="仿宋"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t>${escapeXml(cell.content)}</w:t></w:r></w:p>` +
          `</w:tc>`,
      );
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

export function buildCompetitiveNegotiationReplacementPlan(
  answers: CompetitiveNegotiationAnswers,
): TemplateReplacement[] {
  // Handle quotation letter - could be text or table
  // quotationLetterType defaults to 'text' when empty
  const isQuotationText = (answers.quotationLetterType || 'text') !== 'table';
  let quotationReplacement: TemplateReplacement;
  if (!isQuotationText && answers.quotationLetterTable) {
    quotationReplacement = {
      targetText: '报价表',
      replacementText: '',
      highlight: false,
      isTable: true,
      tableXml: tableDataToWordXml(answers.quotationLetterTable),
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
      targetText: '响应文件提交截至时间',
      ...buildReplacement('响应文件提交截至时间', answers.responseDeadline),
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
    // 合同文本: 选择"不添加"时导出为空字符串并删除该行
    {
      targetText: '合同文本',
      ...buildReplacement(
        '合同文本',
        answers.contractText === '' ? '' : answers.contractText,
        true,
      ),
      shouldDeleteLine: answers.contractText === '',
    },
    businessRequirementsReplacement,
    technicalRequirementsReplacement,
    quotationReplacement,
  ];
}

export function buildSingleSourceReplacementPlan(
  answers: SingleSourceAnswers,
): TemplateReplacement[] {
  // Handle quotation letter - could be text or table
  const isQuotationText = (answers.quotationLetterType || 'text') !== 'table';
  let quotationReplacement: TemplateReplacement;
  if (!isQuotationText && answers.quotationLetterTable) {
    quotationReplacement = {
      targetText: '报价表',
      replacementText: '',
      highlight: false,
      isTable: true,
      tableXml: tableDataToWordXml(answers.quotationLetterTable),
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

  // 采购要求：内容替换，保留模板格式
  const procurementRequirementsReplacement: TemplateReplacement = {
    targetText: '采购要求',
    ...buildReplacement('采购要求', answers.procurementRequirements),
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
      ...buildReplacement('采购文件售价', answers.documentPrice),
    },
    {
      targetText: '递交和谈判时间',
      ...buildReplacement(
        '递交和谈判时间',
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
    {
      targetText: '合同文本',
      ...buildReplacement('合同文本', answers.contractText),
    },
    quotationReplacement,
  ];
}

export function buildInquiryPurchaseReplacementPlan(
  answers: InquiryPurchaseAnswers,
): TemplateReplacement[] {
  // Handle quotation letter - could be text or table
  const isQuotationText = (answers.quotationLetterType || 'text') !== 'table';
  let quotationReplacement: TemplateReplacement;
  if (!isQuotationText && answers.quotationLetterTable) {
    quotationReplacement = {
      targetText: '报价表',
      replacementText: '',
      highlight: false,
      isTable: true,
      tableXml: tableDataToWordXml(answers.quotationLetterTable),
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
      targetText: '递交报价函截止时间',
      ...buildReplacement('递交报价函截止时间', answers.submissionDeadline),
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
  // Handle quotation letter - could be text or table
  const isQuotationText = (answers.quotationLetterType || 'text') !== 'table';
  let quotationReplacement: TemplateReplacement;
  if (!isQuotationText && answers.quotationLetterTable) {
    quotationReplacement = {
      targetText: '报价表',
      replacementText: '',
      highlight: false,
      isTable: true,
      tableXml: tableDataToWordXml(answers.quotationLetterTable),
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
      ...buildReplacement('采购文件售价', answers.documentPrice),
    },
    {
      targetText: '响应文件提交时间',
      ...buildReplacement('响应文件提交时间', answers.responseSubmissionTime),
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
  const headingTextMatch = xml.match(/六、\s*综合评分法评标标准/);
  if (!headingTextMatch || headingTextMatch.index === undefined) {
    return xml;
  }

  let headingStart = -1;
  for (let i = headingTextMatch.index; i >= 0; i--) {
    if (
      xml.substring(i, i + 4) === '<w:p' &&
      (xml[i + 4] === ' ' || xml[i + 4] === '>')
    ) {
      headingStart = i;
      break;
    }
  }
  if (headingStart === -1) {
    return xml;
  }

  const headingEnd = xml.indexOf('</w:p>', headingTextMatch.index);
  if (headingEnd === -1) {
    return xml;
  }

  const tableStart = xml.indexOf('<w:tbl', headingEnd + 6);
  if (tableStart === -1) {
    return xml;
  }

  const chapterFourStart = xml.indexOf('第四章', headingEnd + 6);
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
    if (!paragraph.includes('{{')) {
      continue;
    }

    const runs = Array.from(
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
  '模板文件/竞价采购公示采购公告.docx';
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
    { targetText: '最高限价（大写）', ...buildReplacement('最高限价（大写）', answers.maxPriceChinese) },
    { targetText: '最高限价（小写）', ...buildReplacement('最高限价（小写）', answers.maxPriceNumeric) },
    { targetText: '工期及进度要求', ...buildReplacement('工期及进度要求', answers.scheduleRequirements), isHierarchicalText: true },
    { targetText: '报名方式及条件', ...buildReplacement('报名方式及条件', answers.registrationMethod), isHierarchicalText: true },
    { targetText: '公示期限（起）', ...buildReplacement('公示期限（起）', formatAnnouncementDateToChinese(answers.announcementStart || '')) },
    { targetText: '公示期限（止）', ...buildReplacement('公示期限（止）', formatAnnouncementDateToChinese(answers.announcementEnd || '')) },
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
    { targetText: '预算金额（大写）', ...buildReplacement('预算金额（大写）', answers.maxPriceChinese) },
    { targetText: '预算金额（小写）', ...buildReplacement('预算金额（小写）', answers.maxPriceNumeric) },
    { targetText: '论证意见', ...buildReplacement('论证意见', answers.argumentOpinion), isHierarchicalText: true },
    { targetText: '供应商名称', ...buildReplacement('供应商名称', answers.supplierName) },
    { targetText: '供应商地址', ...buildReplacement('供应商地址', answers.supplierAddress) },
    { targetText: '公示期限（起）', ...buildReplacement('公示期限（起）', formatAnnouncementDateToChinese(answers.announcementStart || '')) },
    { targetText: '公示期限（止）', ...buildReplacement('公示期限（止）', formatAnnouncementDateToChinese(answers.announcementEnd || '')) },
    { targetText: '公示天数', ...buildReplacement('公示天数', answers.announcementDays) },
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
    { targetText: '最高限价（大写）', ...buildReplacement('最高限价（大写）', answers.maxPriceChinese) },
    { targetText: '最高限价（小写）', ...buildReplacement('最高限价（小写）', answers.maxPrice) },
    { targetText: '开标时间', ...buildReplacement('开标时间', formatBidOpeningTime(answers.bidOpeningTime, answers.bidOpeningTimeType)) },
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
