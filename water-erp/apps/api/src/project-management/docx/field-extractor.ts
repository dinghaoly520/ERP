/**
 * 采购/评标文件字段文本解析器（纯函数，无 Nest 依赖）。
 *
 * 从 project-management.service.ts 抽离（2026-08 审计 P1：拆上帝服务）。
 * 从采购文件/评标文件的纯文本中提取结构化字段（正则/行扫描，不依赖 prisma/AI/storage）：
 *  - extractBiddingUnitsFromText / extractAwardedSupplierFromText /
 *    extractAwardedSupplierFromAwardTable / extractAwardedSupplierFromContract /
 *    extractContractAmountFromText / extractContractNumberFromText /
 *    extractExpertInfoFromText / extractProjectOverviewFromText
 * 唯一内部 helper 是 chineseAmountToNumber（中文大写金额 → 数字），不对外导出。
 */

const SELF_COMPANY_NAMES = [
  '四川水发勘测设计研究有限公司',
  '四川省水利水电勘测设计研究院',
  '四川水发勘测设计研究院',
  '水发勘测设计研究有限公司',
  '四川省水利科学研究院',
];

function isSelfCompany(name: string): boolean {
  const normalized = name.replace(/[\s（）()\-—]/g, '');
  return SELF_COMPANY_NAMES.some(
    (self) => normalized === self || normalized.includes(self) || self.includes(normalized),
  );
}

  /**
   * Extract bidding units from award decision document text
   * Looks for company names in the "投标情况" section
   */
  export function extractBiddingUnitsFromText(text: string): string {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

    // --- Phase 1: Locate the bidding section ---
    const sectionStartKeywords = ['投标情况', '投标人名称', '投标单位', '投标方', '供应商名称', '投标人'];
    let sectionStartIndex = -1;
    for (const kw of sectionStartKeywords) {
      const idx = lines.findIndex((l) => l.includes(kw));
      if (idx >= 0) { sectionStartIndex = idx; break; }
    }
    if (sectionStartIndex < 0) return '';

    // --- Phase 2: Find section end ---
    const endMarkers = [
      '评标委员会意见', '评标小组意见', '推荐中标', '推荐成交',
      '中标候选人', '定标意见', '附件', '备注', '流转意见',
      '评审意见', '评审结论', '签章', '审批意见',
    ];
    let endSectionIndex = -1;
    for (let i = sectionStartIndex + 1; i < lines.length; i++) {
      if (endMarkers.some((m) => lines[i].includes(m))) {
        endSectionIndex = i;
        break;
      }
    }

    const sectionLines = endSectionIndex > 0
      ? lines.slice(sectionStartIndex + 1, endSectionIndex)
      : lines.slice(sectionStartIndex + 1, sectionStartIndex + 40);

    // --- Phase 3: Extract company names ---
    const companySuffixes = '有限责任公司|有限公司|股份有限公司|公司|集团|企业|研究所|事务所|中心|院|合伙|工作室|工程处|项目部|经营部|营业部|经销部|服务部|事务所|事务所';
    const companySuffixRegex = new RegExp(companySuffixes);
    const hasSuffix = (s: string) => companySuffixRegex.test(s);

    // Match a company name: Chinese chars + optional suffix
    const extractName = (raw: string): string => {
      // Strip leading sequence number: "1", "1.", "1、", "1）", "1)"
      let cleaned = raw.replace(/^\d+[.、）)\s]*/, '');
      // Split at column boundaries (numbers like prices, scores)
      const beforeNumbers = cleaned.split(/\s+[\d,.]/)[0] ?? cleaned;
      cleaned = beforeNumbers.replace(/[|｜\t]/g, '').trim();
      // Remove trailing punctuation
      cleaned = cleaned.replace(/[，,。.、:：;；]+$/, '');

      // Try to match a company-like name with a known suffix
      const match = cleaned.match(/([一-鿿A-Za-z（）()·\s]+?(?:有限责任公司|有限公司|股份有限公司|公司|集团|企业|研究所|事务所|中心))/);
      if (match) return match[1].replace(/\s+/g, '').trim();

      // If it has any suffix indicator, return the cleaned text
      if (hasSuffix(cleaned)) return cleaned.replace(/\s+/g, '').trim();

      // Otherwise, if it's pure Chinese text and reasonably long, return as-is
      if (/^[一-鿿A-Za-z（）()]+$/.test(cleaned) && cleaned.length >= 3) {
        return cleaned;
      }
      return '';
    };

    const companies: string[] = [];
    let currentCompany = '';

    const saveCurrentCompany = () => {
      if (!currentCompany) return;
      const name = extractName(currentCompany);
      if (name.length >= 3) companies.push(name);
      currentCompany = '';
    };

    const isSkippable = (line: string) => {
      // Skip table headers
      if (line.includes('序号') && (line.includes('投标') || line.includes('名称'))) return true;
      if (line.includes('投标报价') || line.includes('评审报价') || line.includes('综合得分')) return true;
      // Skip standalone numbers
      if (/^\d+$/.test(line)) return true;
      // Skip price lines "63800.00" or "63800.00 63800.00"
      if (/^[\d,.]+(\s+[\d,.]+)?$/.test(line)) return true;
      // Skip short numeric lines
      if (/^\d+[.、）)]$/.test(line)) return true;
      return false;
    };

    for (const line of sectionLines) {
      if (isSkippable(line)) {
        if (/^\d+$/.test(line) || /^\d+[.、）)]$/.test(line)) saveCurrentCompany();
        continue;
      }

      // Pattern: "1 四川雏雁档案馆服务有限责任公司 140120.00 136400.00"
      const inlineMatch = line.match(/^\d+[.、）)\s]+(.+)/);
      if (inlineMatch) {
        saveCurrentCompany();
        const name = extractName(inlineMatch[1]);
        if (name.length >= 3) companies.push(name);
        continue;
      }

      // Pattern: company name on its own line (possibly split across lines)
      if (line.length >= 2) {
        if (hasSuffix(line) || /[一-鿿]{2,}/.test(line)) {
          // Could be a standalone company or the suffix portion
          if (currentCompany) {
            currentCompany += line;
            const name = extractName(currentCompany);
            if (name.length >= 3) {
              companies.push(name);
              currentCompany = '';
            }
          } else {
            const name = extractName(line);
            if (name.length >= 3 && hasSuffix(name)) {
              companies.push(name);
              currentCompany = '';
            } else if (name.length >= 2) {
              currentCompany = line;
            }
          }
        } else if (currentCompany) {
          // Append to current company (might be suffix on next line)
          currentCompany += line;
          const name = extractName(currentCompany);
          if (name.length >= 3 && hasSuffix(name)) {
            companies.push(name);
            currentCompany = '';
          }
        }
      }
    }

    saveCurrentCompany();

    return [...new Set(companies.filter((c) => c.length >= 3))].join('、');
  }

  /**
   * Extract awarded supplier from award notification document text
   * Looks for company name after "中标通知书" heading
   */
  /**
   * 从定标审批表 / 中标通知书 / 供方确认表 等文件中提取中标单位。
   * 支持多种定标文件表述，不依赖文件名。
   */
  export function extractAwardedSupplierFromText(text: string): string {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

    const anchors = [
      '中标通知书', '中标公告',
      '供方确认', '确认供方', '拟定供应商', '拟成交供应商', '推荐供应商', '推荐中标人',
      '定标意见', '定标结论', '中标单位', '中标人', '中标供应商',
      '评审结论', '拟推荐', '同意确定', '拟确定', '确认以下', '定标结果',
      '销售方', '卖方', '乙方', '买受人',
    ];

    for (const anchor of anchors) {
      const idx = lines.findIndex((l) => l.includes(anchor));
      if (idx < 0) continue;

      // 同行锚点后紧跟公司名
      const inline = lines[idx];
      const inlineM = inline.match(
        new RegExp(anchor + '\\s*(?::|：)?\\s*(.+?(?:公司|企业|单位|中心|院|所|局|部|办|处|室|队|组))')
      );
      if (inlineM) {
        const name = inlineM[1].trim().replace(/[：:]*$/, '').trim();
        if (!isSelfCompany(name)) return name;
      }

      // 后续 1-5 行提取公司名
      for (let i = idx + 1; i < Math.min(lines.length, idx + 6); i++) {
        const line = lines[i];
        const m = line.match(/^(.+(?:公司|企业|单位|中心|院|所|局|部|办|处|室|队|组))[：:]?$/);
        if (m) {
          const name = m[1].replace(/[：:]*$/, '').trim();
          if (!isSelfCompany(name)) return name;
        }
        const mid = line.match(/([^\s。，,;；：:]{2,}(?:公司|企业|单位))/);
        if (mid && !isSelfCompany(mid[1].trim())) return mid[1].trim();
      }
    }

    return '';
  }

  /**
   * Extract contract amount from contract approval document text.
   * Handles:
   *   "合同金额(元)\n63000.00元"        — label + value on adjacent lines (most common)
   *   "合同金额(元) 63000.00元"         — label + value on same line
   *   "合同金额 750,000.00元"           — comma-separated numbers
   *   "合同金额为人民币：132680.00 元"   — prose-style label
   *   "¥ 229000元"                      — yuan symbol prefix
   *
   * Strategy: scan for "合同金额" label, then search nearby lines for a
   * monetary value. Candidates are scored by proximity to the label, not
   * by magnitude — this prevents distant large numbers (e.g. budget
   * figures elsewhere in the document) from winning.
   */
  /** 中文大写金额 → 数字（简版：处理万/亿段，如 肆佰贰拾万 → 4200000） */
  function chineseAmountToNumber(text: string): number {
    const digit: Record<string, number> = { '壹':1,'贰':2,'叁':3,'肆':4,'伍':5,'陆':6,'柒':7,'捌':8,'玖':9,'零':0 };
    const unit: Record<string, number> = { '亿':1e8,'万':1e4,'仟':1e3,'佰':100,'拾':10 };
    let result = 0, section = 0, current = 0;
    for (const ch of text) {
      if (digit[ch] !== undefined) { current = digit[ch]; continue; }
      if (unit[ch] !== undefined) {
        const u = unit[ch];
        if (current === 0) current = 1;
        if (u >= 1e4) { section = (section + current) * u; current = 0; result += section; section = 0; }
        else { section += current * u; current = 0; }
      }
    }
    return result + section + current;
  }

  export function extractContractAmountFromText(text: string): number | null {
  
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

    // Strip commas and Chinese commas from a numeric string before parsing
    const clean = (s: string) => s.replace(/[,，、\s　]/g, '');

    // A monetary amount: optional ¥/￥ prefix, digits + optional commas + optional .dd suffix, optional 元 suffix
    const AMOUNT_RE = /(?:[¥￥]\s*)?([\d,，]+(?:\.\d{1,2})?)\s*(?:元|$)/;

    // A "合同金额" label line — matches the various forms we see
    const isContractLabel = (s: string) =>
      /^合同金额/.test(s) || s.includes('合同金额') || s.includes('合同总价') ||
      s.includes('签约合同价') || s.includes('总价') ||
      s.includes('中标金额') || s.includes('中标价') || s.includes('成交金额');

    // Score-and-value tuple — higher score = more likely correct
    const candidates: Array<{ value: number; score: number }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!isContractLabel(line)) continue;

      // ── Same-line match ──────────────────────────────────────────
      // "合同金额(元) 63000.00元"  or  "合同金额为人民币：132680.00 元"
      const sameLine = line.match(AMOUNT_RE);
      if (sameLine) {
        const val = parseFloat(clean(sameLine[1]));
        if (!Number.isNaN(val) && val > 0) {
          candidates.push({ value: val, score: 100 });
        }
      }

      // ── Adjacent-line scan (up to 3 lines below the label) ──────
      // "合同金额(元)\n63000.00元" — but OCR may insert an empty or
      // header line between the label and the value.
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        const nextLine = lines[j];

        // Stop if we hit another form-section label
        if (/^(合同|需求|经办|附件|相关|采购|中标|预算|相对方)/.test(nextLine)) break;

        const m = nextLine.match(AMOUNT_RE);
        if (m) {
          const val = parseFloat(clean(m[1]));
          if (!Number.isNaN(val) && val > 0) {
            // Closer lines get higher scores
            candidates.push({ value: val, score: 90 - (j - i - 1) * 25 });
            break; // found the value, stop scanning for this label
          }
        }
      }

      // Bail early: the first "合同金额" label in the document header
      // is essentially always the correct one. Subsequent mentions (in
      // contract body text) are downstream payment milestones etc.
      if (candidates.length > 0 && candidates[0].score >= 90) break;
    }

    // ── Fallback: "中标金额" label (award notification, not contract table) ──
    if (candidates.length === 0) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes('中标金额')) continue;
        const sameLine = line.match(AMOUNT_RE);
        if (sameLine) {
          const val = parseFloat(clean(sameLine[1]));
          if (!Number.isNaN(val) && val > 0) {
            candidates.push({ value: val, score: 80 });
          }
        }
        for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
          const nextLine = lines[j];
          if (/^(合同|需求|经办|中标单位)/.test(nextLine)) break;
          const m = nextLine.match(AMOUNT_RE);
          if (m) {
            const val = parseFloat(clean(m[1]));
            if (!Number.isNaN(val) && val > 0) {
              candidates.push({ value: val, score: 70 - (j - i - 1) * 25 });
              break;
            }
          }
        }
      }
    }

    // ── Fallback: Chinese uppercase amount (e.g. 肆佰贰拾万元整 → 4200000) ──
    if (candidates.length === 0) {
      const upperMatch = text.match(
        /([壹贰叁肆伍陆柒捌玖拾佰仟万亿零]{2,30})\s*(?:元[整正]?|万[元整正]?)/
      );
      if (upperMatch) {
        const val = chineseAmountToNumber(upperMatch[1]);
        if (val > 0) candidates.push({ value: val, score: 60 });
      }
    }

    if (candidates.length === 0) return null;

    // Pick the highest-scored candidate (ties broken by larger value —
    // the contract amount is rarely the smallest number on the page)
    candidates.sort((a, b) => b.score - a.score || b.value - a.value);
    return candidates[0].value;
  }

  /**
   * Extract awarded supplier from award decision table (定标审批表)
   * Looks for the first recommended candidate in "评标委员会意见" section
   */
  export function extractAwardedSupplierFromAwardTable(text: string): string {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

    // Find "评标委员会意见" section
    const committeeIndex = lines.findIndex((l) => l.includes('评标委员会意见'));
    if (committeeIndex < 0) {
      return '';
    }

    // Find the first company name after sequence number "1"
    let foundFirstCandidate = false;
    for (let i = committeeIndex + 1; i < Math.min(lines.length, committeeIndex + 15); i++) {
      const line = lines[i];

      // Skip sequence number "1"
      if (line === '1') {
        foundFirstCandidate = true;
        continue;
      }

      // Skip header lines
      if (line.includes('序号') || line.includes('推荐中标候选人') || line.includes('综合得分') || line.includes('评审报价')) {
        continue;
      }

      // Skip price lines
      if (/^[\d,.]+$/.test(line)) {
        continue;
      }

      // Found company name (first candidate after "1")
      if (foundFirstCandidate && line.length > 2) {
        // Build company name - check next lines for continuation
        let companyName = line;

        // Check next line for company suffix like "有限公司"
        for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
          const nextLine = lines[j]?.trim() || '';
          // If next line is a price or number, stop
          if (/^[\d,.]+$/.test(nextLine)) break;
          // If next line contains company keywords, append it
          if (nextLine.includes('公司') || nextLine.includes('有限') || nextLine.includes('责任')) {
            companyName += nextLine;
            break;
          }
          // If next line is short continuation, append it
          if (nextLine.length > 0 && nextLine.length < 6) {
            companyName += nextLine;
          }
        }
        if (!isSelfCompany(companyName)) return companyName;
        // Self company matched, skip to look for next candidate
        foundFirstCandidate = false;
        continue;
      }
    }

    return '';
  }

  /**
   * Extract awarded supplier from contract approval document (合同审批表)
   * Looks for "相对方名称" field
   */
  export function extractAwardedSupplierFromContract(text: string): string {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.includes('相对方名称') || line.includes('合同相对方名称')) {
        const inlineMatch = line.match(/(?:合同)?相对方名称\s*(.+(?:公司|企业|单位|中心|院|所|局|部|办|处|室|队|组))/);
        if (inlineMatch) {
          const name = inlineMatch[1].trim();
          if (!isSelfCompany(name)) return name;
        }

        const nextLine = lines[i + 1]?.trim() || '';
        if (nextLine.length > 2 && (nextLine.includes('公司') || nextLine.includes('有限') || nextLine.includes('责任'))) {
          if (!isSelfCompany(nextLine)) return nextLine;
        }
      }
    }

    return '';
  }

  /**
   * Extract contract number from contract approval document (合同审批表) text.
   * Looks for "合同编号：" pattern: letter prefix + digits (e.g., E202509012).
   */
  export function extractContractNumberFromText(text: string): string | null {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Pattern: "合同编号E202605002" / "合同编号：E202605002" / "合同编号: HT-2025-001"
      // Colon/space separators are optional after "合同编号"
      const match = line.match(/合同编号[：:\s]*([A-Za-z0-9][-A-Za-z0-9\/\.]{2,})/);
      if (match) {
        return match[1].trim();
      }
      // "合同编号" may appear alone on a line, with the actual number on the next line
      if (line === '合同编号' && i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const nextMatch = nextLine.match(/^([A-Za-z0-9][-A-Za-z0-9\/\.]{2,})$/);
        if (nextMatch) {
          return nextMatch[1].trim();
        }
      }
    }

    // Broader fallback: search the full text (handles PDF table extraction where
    // "合同编号" and its value may be separated by whitespace or line breaks)
    const fullMatch = text.replace(/\s+/g, ' ').match(/合同编号[：:\s]*([A-Za-z0-9][-A-Za-z0-9\/\.]{2,})/);
    if (fullMatch) {
      return fullMatch[1].trim();
    }

    // Fallback 2: search for lines that look like contract numbers near "合同编号" context
    // (handles OCR output where "合同编号" and the value get concatenated without space)
    const cnMatch = text.match(/合同编号\s*([A-Za-z0-9]+[A-Za-z0-9]?)/);
    if (cnMatch && cnMatch[1].length >= 3) {
      return cnMatch[1].trim();
    }

    return null;
  }

  /**
   * Extract expert info from 抽取结果单 text.
   * Output format: "姓名|部门|专业|职称" per line (matches ExpertInfoField display component).
   */
  export function extractExpertInfoFromText(text: string): string | null {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const experts: Array<{ name: string; department: string; specialty: string; title: string }> = [];
    const seen = new Set<string>();

    const addExpert = (name: string, department: string, specialty: string, title: string) => {
      const cleanName = name.trim().replace(/[\s,，、　]/g, '');
      if (cleanName.length < 2 || cleanName.length > 4) return;
      if (!/^[一-鿿·]+$/.test(cleanName)) return;
      if (seen.has(cleanName)) return;
      seen.add(cleanName);
      experts.push({ name: cleanName, department: department.trim(), specialty: specialty.trim(), title: title.trim() });
    };

    // Track the current expert category from "XXX专业专家N人：" lines
    let currentSpecialty = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect category line: "测绘专业专家1人：" or "职工代表专业专家1人："
      const categoryMatch = line.match(/^(.+?专业|职工代表.{0,4})专家\d+人[：:]/);
      if (categoryMatch) {
        currentSpecialty = categoryMatch[1].replace(/专业$/, '').trim();
        continue;
      }

      // Pattern 1 (most common): "黄伟 数字信息化院 测绘 高级工程师;"
      // Structure: 姓名 部门 专业 职称;
      if (line.match(/^[一-鿿]/) && line.includes(' ')) {
        const cleanLine = line.replace(/[;；，,]$/, '').trim();
        const parts = cleanLine.split(/\s+/).filter(Boolean);

        if (parts.length >= 2 && parts[0].length >= 2 && parts[0].length <= 4) {
          const name = parts[0];
          const skip = ['系统', '抽取', '结果', '备注', '注', '采购', '专家', '需求', '经办', '开标', '预算', '合同'];
          if (/^[一-鿿·]+$/.test(name) && !skip.includes(name)) {
            // parts: [姓名, 部门, 专业, 职称]
            const department = parts[1] || '';
            const specialty = parts.length >= 3 ? parts[2] : currentSpecialty;
            const title = parts.length >= 4 ? parts.slice(3).join('') : (parts.length >= 3 ? parts[parts.length - 1] : '');
            addExpert(name, department, specialty || currentSpecialty, title);
            continue;
          }
        }
      }

      // Pattern 2: "姓名：张三" key-value style
      const nameMatch = line.match(/(?:专家)?姓名[：:]\s*([一-鿿·]{2,4})/);
      if (nameMatch) {
        const name = nameMatch[1];
        let department = '', specialty = currentSpecialty, title = '';
        const deptMatch = line.match(/(?:单位|部门|院)[：:]\s*(.+)/);
        if (deptMatch) department = deptMatch[1].trim();
        const titleMatch = line.match(/(?:职称|职务)[：:]\s*(.+)/);
        if (titleMatch) title = titleMatch[1].trim();
        addExpert(name, department, specialty, title);
        continue;
      }

      // Pattern 3: Numbered table rows "1. 张三 教授"
      if (line.match(/^\d+[.\s\t、）)]/)) {
        const parts = line.split(/[\s\t|]+/).filter(Boolean);
        if (parts.length >= 2) {
          const name = parts[1].replace(/[,，、]/g, '');
          const specialty = parts.length >= 3 ? parts.slice(2, -1).join(' ') || currentSpecialty : currentSpecialty;
          const title = parts.length >= 3 ? parts[parts.length - 1] : '';
          addExpert(name, '', specialty, title);
          continue;
        }
      }

      // Pattern 4: "评审专家：张三、李四"
      const multiMatch = line.match(/(?:评审)?专家[：:]\s*(.+)/);
      if (multiMatch && !line.includes('抽取') && !line.includes('系统') && !line.includes('人数')) {
        const names = multiMatch[1].split(/[,，、\s]+/).filter(Boolean);
        for (const n of names) {
          const parenM = n.match(/([一-鿿·]{2,4})[（(]([^）)]+)[）)]/);
          if (parenM) {
            addExpert(parenM[1], '', parenM[2], '');
          } else {
            addExpert(n, '', currentSpecialty, '');
          }
        }
        continue;
      }
    }

    if (experts.length === 0) return null;

    // Output format: "姓名|部门|专业|职称" per line
    return experts.map(e => `${e.name}|${e.department}|${e.specialty}|${e.title}`).join('\n');
  }

  /** 从采购文件正文中提取项目概况描述。procurementMethod 用于适配不同采购方式的段落结构。 */
  export function extractProjectOverviewFromText(text: string, procurementMethod?: string): string | null {
    const isDirect = procurementMethod === '直接采购';
    const sectionKeywords = isDirect
      ? ['采购内容', '采购项目', '采购标的', '采购范围及内容', '采购需求', '项目内容', '项目采购']
      : ['项目概况', '采购内容', '项目概述', '项目背景', '采购需求概述', '项目简介'];
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    let startIdx = -1;
    for (const kw of sectionKeywords) {
      const idx = lines.findIndex(l => l.includes(kw));
      if (idx >= 0) { startIdx = idx; break; }
    }
    if (startIdx < 0) return null;

    // Collect lines until next major section (Chinese/English section numbers)
    const endMarkers = /^(一[、.]|二[、.]|三[、.]|四[、.]|五[、.]|[2-9][、.]|[2-9]\s|第[二三四五六七八九]|[A-D]\s|[IVX]+[、.])/;
    // 段落切割补充：以下关键词标志"采购内容"段结束、"采购要求/资格/条款"段开始，立即停收
    const stopKeywords = /供应商资格|资格要求|商务要求|技术要求|供货要求|验收标准|付款条件|评审办法|评审标准|评标办法|投标人须知|供应商须知|合同条款|报价要求|响应文件[^提]|申请文件|履约保证金|售后服务|培训要求|交货期限|交付要求/;
    const parts: string[] = [];

    // Clean up first line: remove section number prefix (e.g. "二、项目概况：", "一、采购内容", "1.项目概况")
    let firstLine = lines[startIdx];
    firstLine = firstLine.replace(/^[一二三四五六七八九十\d]+[、.）:：\s]+/, ''); // strip "二、" etc
    for (const kw of sectionKeywords) firstLine = firstLine.replace(kw, '');       // strip keyword
    firstLine = firstLine.replace(/^[和与及以及：:、.\s]+/, '');                  // strip leading connectors & colons
    if (firstLine.trim()) parts.push(firstLine.trim());

    for (let i = startIdx + 1; i < Math.min(lines.length, startIdx + 40); i++) {
      const line = lines[i];
      if (endMarkers.test(line)) break;
      if (stopKeywords.test(line)) break;  // 遇到"要求/资格/条件/条款"类段落头即停
      if (line.trim()) parts.push(line.trim());
    }

    const result = parts.join('\n');
    return result.length >= 20 ? result : null;
  }
