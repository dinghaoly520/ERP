import { ReportGeneratorService } from './report-generator.service';

/** 提取字段透明化（2026-11-19）回归锁：
 *  1) generateFromRuleResults 按 REVIEW_FIELD_VOCAB 词表序组装、词表外键附尾、空集 undefined；
 *  2) mergeWithLlmFreeResults 必须透传 extractedFields——该 merge 未来若从 spread
 *     重构为逐字段组装会静默丢此字段（审查报告页再也看不到提取字段），此测试即红。 */
describe('ReportGeneratorService extractedFields', () => {
  const service = new ReportGeneratorService({} as any);

  describe('generateFromRuleResults', () => {
    it('按词表序输出已提取字段，词表外键附加在尾', () => {
      const report = service.generateFromRuleResults([], {
        publicityDays: 3,
        budgetAmount: 500000,
        自由键: 'x',
      });
      expect(report.extractedFields).toEqual([
        { field: 'budgetAmount', value: 500000 },
        { field: 'publicityDays', value: 3 },
        { field: '自由键', value: 'x' },
      ]);
    });

    it('跳过 null/undefined/空串值；全部为空时 extractedFields=undefined', () => {
      const report = service.generateFromRuleResults([], {
        budgetAmount: null,
        publicityDays: undefined,
        procurementMethod: '',
      });
      expect(report.extractedFields).toBeUndefined();
    });

    it('不传提取结果时 extractedFields=undefined（general 路径/旧调用兼容）', () => {
      expect(service.generateFromRuleResults([]).extractedFields).toBeUndefined();
    });
  });

  describe('mergeWithLlmFreeResults（spread 透传锁）', () => {
    it('合并 llm-free 结果后 extractedFields 原样保留', () => {
      const kbReport = service.generateFromRuleResults([], { budgetAmount: 120000 });
      const merged = service.mergeWithLlmFreeResults(kbReport, {
        results: [],
        totalSections: 0,
      } as any);
      expect(merged.extractedFields).toEqual([{ field: 'budgetAmount', value: 120000 }]);
    });
  });
});
