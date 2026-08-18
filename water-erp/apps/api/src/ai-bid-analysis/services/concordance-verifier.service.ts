// apps/api/src/ai-bid-analysis/services/concordance-verifier.service.ts
// 双源一致性引擎（方案第七章）：系统结构化数据（权威）vs 标书 OCR（验证）
// String 归一化（报价/工期是 String，资质等级从 name 正则解析）
import { Injectable } from '@nestjs/common';
import type {
  SystemData,
  FieldCheck,
  ConcordanceResult,
} from '../types';
import type { BidderKeyInfo } from '../types';

@Injectable()
export class ConcordanceVerifierService {
  /**
   * 校验系统数据 vs 标书提取的关键信息
   * @param systemData ERP 聚合的系统结构化数据（权威源）
   * @param docKeyInfo 标书 LLM/OCR 提取的关键信息（BidderKeyInfo）
   */
  verify(systemData: SystemData, docKeyInfo: BidderKeyInfo): ConcordanceResult {
    const checks: FieldCheck[] = [
      this.checkPrice(
        this.normalizePriceYuan(systemData.openingAmount) ??
          this.normalizePriceYuan(systemData.submissionPrice),
        this.normalizePrice(docKeyInfo.quotePriceYuan) ?? docKeyInfo.quotePrice,
      ),
      this.checkPeriod(
        this.parsePeriodDays(systemData.openingPeriod) ??
          this.parsePeriodDays(systemData.submissionPeriod),
        this.parsePeriodDays(docKeyInfo.constructionPeriod),
      ),
      this.checkQualification(
        this.extractQualificationLevels(systemData.qualifications),
        docKeyInfo.qualificationLevel,
      ),
      this.checkContact(systemData.contacts, docKeyInfo.contactInfo),
      this.checkLegalPerson(systemData.legalPerson, docKeyInfo.legalPerson),
      this.checkCreditCode(systemData.creditCode),
    ];
    return this.summarize(checks);
  }

  // ── 归一化（String → 数值/等级）──

  /** 报价归一化：处理 万元/元/亿 单位，统一为万元 */
  private normalizePrice(value: unknown): number | null {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return null;
    // ★ 去除千分位逗号后再匹配（"1,539,500.00元" → "1539500.00元"）
    const cleaned = value.replace(/[,，\s]/g, '');
    const m = cleaned.match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    let n = parseFloat(m[0]);
    if (value.includes('亿')) n *= 10000;
    else if (value.includes('万元')) {
      /* 已是万元 */
    } else if (value.includes('元')) n /= 10000; // 元 → 万元
    return n;
  }

  /**
   * 系统侧报价归一化：BidOpeningRecord.amount / 表单 bidPrice 以元存储且常无单位后缀
   * （如 "1512000"），统一为万元。带后缀按后缀处理（亿→×10000、万元→原值），无后缀一律按元。
   */
  private normalizePriceYuan(value: unknown): number | null {
    if (typeof value === 'number') return value / 10000;
    if (typeof value !== 'string') return null;
    const cleaned = value.replace(/[,，\s]/g, '');
    const m = cleaned.match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    let n = parseFloat(m[0]);
    if (value.includes('亿')) n *= 10000;
    else if (value.includes('万元')) {
      /* 已是万元 */
    } else n /= 10000; // 元（含无单位后缀）→ 万元
    return n;
  }

  /** 工期归一化：日历天/天/月/年 → 天数 */
  private parsePeriodDays(value: unknown): number | null {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return null;
    const mDay = value.match(/(\d+(?:\.\d+)?)\s*(日历天|天|日|day|days)/i);
    if (mDay) return parseFloat(mDay[1]);
    const mMonth = value.match(/(\d+(?:\.\d+)?)\s*个?月/);
    if (mMonth) return Math.round(parseFloat(mMonth[1]) * 30);
    const mYear = value.match(/(\d+(?:\.\d+)?)\s*年/);
    if (mYear) return Math.round(parseFloat(mYear[1]) * 365);
    return null;
  }

  /** 资质等级从 name 解析（无独立 level 字段，如「水利水电工程施工总承包甲级」） */
  private extractQualificationLevels(
    quals: Array<{ name?: string | null }>,
  ): string[] {
    const levels = ['特级', '甲级', '一级', '乙级', '二级', '丙级', '三级'];
    return quals
      .map((q) => levels.find((l) => q.name?.includes(l)))
      .filter((l): l is string => !!l);
  }

  // ── 字段检查 ──

  private checkPrice(sys: number | null, doc: number | null): FieldCheck {
    return this.checkNumeric('price', '报价', sys, doc, {
      consistentRatio: 0.001,
      minorRatio: 0.05,
    });
  }

  private checkPeriod(sys: number | null, doc: number | null): FieldCheck {
    return this.checkNumeric('period', '工期(天)', sys, doc, {
      consistentRatio: 0,
      minorRatio: 0,
      absoluteMinor: 0, // 工期按整数比对
      absoluteConflict: 1, // 差 1 天即冲突（法律效力）
    });
  }

  private checkNumeric(
    field: string,
    label: string,
    sys: number | null,
    doc: number | null,
    opts: {
      consistentRatio: number;
      minorRatio: number;
      absoluteMinor?: number;
      absoluteConflict?: number;
    },
  ): FieldCheck {
    if (sys == null || doc == null) {
      return this.field(field, label, sys, doc, 'insufficient_data', 'low');
    }
    const diff = Math.abs(sys - doc);
    const ratio = sys !== 0 ? diff / Math.abs(sys) : 0;

    if (opts.absoluteConflict != null && diff >= opts.absoluteConflict) {
      return this.field(
        field,
        label,
        sys,
        doc,
        'conflict',
        'high',
        `系统 ${sys} vs 标书 ${doc}，差 ${diff}`,
      );
    }
    if (ratio <= opts.consistentRatio) {
      return this.field(field, label, sys, doc, 'consistent', 'low');
    }
    if (ratio <= opts.minorRatio) {
      return this.field(
        field,
        label,
        sys,
        doc,
        'minor_diff',
        'medium',
        `差异 ${(ratio * 100).toFixed(2)}%`,
      );
    }
    return this.field(
      field,
      label,
      sys,
      doc,
      'conflict',
      'high',
      `差异 ${(ratio * 100).toFixed(2)}%`,
    );
  }

  private checkQualification(
    sysLevels: string[],
    docLevel: string,
  ): FieldCheck {
    const hasDoc = !!docLevel;
    const matched = sysLevels.includes(docLevel);
    let status: FieldCheck['status'];
    let severity: FieldCheck['severity'];
    let note: string;

    if (!hasDoc) {
      status = 'insufficient_data';
      severity = 'low';
      note = '标书未声明资质等级';
    } else if (sysLevels.length === 0) {
      status = 'minor_diff';
      severity = 'medium';
      note = `标书声明「${docLevel}」，系统无对应资质记录`;
    } else if (matched) {
      status = 'consistent';
      severity = 'low';
      note = `系统资质含「${docLevel}」`;
    } else {
      status = 'conflict';
      severity = 'high';
      note = `标书声明「${docLevel}」，系统资质为 ${sysLevels.join('/')}`;
    }
    return this.field(
      'qualification',
      '资质等级',
      sysLevels,
      docLevel,
      status,
      severity,
      note,
    );
  }

  private checkContact(
    sysContacts: Array<{ phone?: string | null; email?: string | null }>,
    docContact: { phone: string; email: string; address: string },
  ): FieldCheck {
    const sysPhones = sysContacts
      .map((c) => this.normalizePhone(c.phone))
      .filter((p): p is string => !!p);
    const docPhone = this.normalizePhone(docContact.phone);
    const sysEmails = sysContacts
      .map((c) => c.email?.trim().toLowerCase())
      .filter((e): e is string => !!e);
    const docEmail = docContact.email?.trim().toLowerCase();

    const phoneMatch = docPhone && sysPhones.includes(docPhone);
    const emailMatch = docEmail && sysEmails.includes(docEmail);

    // 展示值须为字符串（专家端直接 String() 渲染，对象会显示成 "[object Object]"）；电话保留原始格式
    const rawSysPhones = sysContacts
      .map((c) => c.phone?.trim())
      .filter((p): p is string => !!p);
    const rawSysEmails = sysContacts
      .map((c) => c.email?.trim())
      .filter((e): e is string => !!e);
    const sysDisplay = `电话：${rawSysPhones.join('、') || '—'}；邮箱：${rawSysEmails.join('、') || '—'}`;
    const docDisplay = `电话：${docContact.phone || '—'}；邮箱：${docContact.email || '—'}`;

    if (!docPhone) {
      return this.field(
        'contact',
        '联系方式',
        sysDisplay,
        docDisplay,
        'insufficient_data',
        'low',
        '标书未提供联系方式',
      );
    }
    if (phoneMatch && (!docEmail || emailMatch)) {
      return this.field(
        'contact',
        '联系方式',
        sysDisplay,
        docDisplay,
        'consistent',
        'low',
      );
    }
    return this.field(
      'contact',
      '联系方式',
      sysDisplay,
      docDisplay,
      'minor_diff',
      'medium',
      `电话${phoneMatch ? '匹配' : '不匹配'}；邮箱${emailMatch ? '匹配' : docEmail ? '不匹配' : '系统无记录'}`,
    );
  }

  private checkLegalPerson(
    sys: string | null | undefined,
    doc: string,
  ): FieldCheck {
    if (!doc) {
      return this.field('legalPerson', '法定代表人', sys, doc, 'insufficient_data', 'low');
    }
    if (!sys) {
      return this.field('legalPerson', '法定代表人', sys, doc, 'insufficient_data', 'low', '系统无记录');
    }
    const match = sys.trim() === doc.trim();
    return this.field(
      'legalPerson',
      '法定代表人',
      sys,
      doc,
      match ? 'consistent' : 'conflict',
      match ? 'low' : 'high',
    );
  }

  private checkCreditCode(sys: string | null | undefined): FieldCheck {
    // 标书 OCR 通常提取不到信用代码（在 license 里），仅记录系统值供人工核对
    if (!sys) {
      return this.field('creditCode', '统一社会信用代码', sys, null, 'insufficient_data', 'low');
    }
    return this.field('creditCode', '统一社会信用代码', sys, null, 'insufficient_data', 'low', '系统有记录，标书待人工核对');
  }

  // ── 辅助 ──

  private normalizePhone(phone?: string | null): string | null {
    if (!phone) return null;
    return phone.replace(/[\s\-+()]/g, '');
  }

  private field(
    field: string,
    label: string,
    systemValue: unknown,
    docValue: unknown,
    status: FieldCheck['status'],
    severity: FieldCheck['severity'],
    note?: string,
  ): FieldCheck {
    return { field, label, systemValue, docValue, status, severity, note };
  }

  private summarize(checks: FieldCheck[]): ConcordanceResult {
    const conflictCount = checks.filter((c) => c.status === 'conflict').length;
    const warningCount = checks.filter(
      (c) => c.status === 'minor_diff',
    ).length;
    const insufficient = checks.filter(
      (c) => c.status === 'insufficient_data',
    ).length;

    let overallStatus: ConcordanceResult['overallStatus'];
    if (conflictCount > 0) overallStatus = 'conflict';
    else if (warningCount > 0) overallStatus = 'minor_diff';
    else if (insufficient === checks.length) overallStatus = 'insufficient_data';
    else overallStatus = 'consistent';

    return { overallStatus, conflictCount, warningCount, checks };
  }
}
