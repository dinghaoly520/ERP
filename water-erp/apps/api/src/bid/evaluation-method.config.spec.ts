import { getEvaluationDefault, getScoreTemplate } from './evaluation-method.config';

describe('evaluation-method.config', () => {
  describe('getEvaluationDefault', () => {
    it('谈判采购 → qualified_lowest_price, 无价格公式', () => {
      const d = getEvaluationDefault('谈判采购');
      expect(d.evaluationMethod).toBe('qualified_lowest_price');
      expect(d.formulaType).toBeNull();
      expect(d.rounds).toBe(0);
    });

    it('邀请招标 → comprehensive', () => {
      const d = getEvaluationDefault('邀请招标');
      expect(d.evaluationMethod).toBe('comprehensive');
    });

    it('询比采购 → lowest_price', () => {
      const d = getEvaluationDefault('询比采购');
      expect(d.evaluationMethod).toBe('lowest_price');
    });

    it('直接采购 → none', () => {
      const d = getEvaluationDefault('直接采购');
      expect(d.evaluationMethod).toBe('none');
    });

    it('未知方式 → fallback comprehensive', () => {
      const d = getEvaluationDefault('不存在的方式');
      expect(d.evaluationMethod).toBe('comprehensive');
    });
  });

  describe('getScoreTemplate', () => {
    it('qualified_lowest_price: 无 PRICE, BUSINESS+TECHNICAL=100', () => {
      const t = getScoreTemplate('qualified_lowest_price');
      const categories = t.map(i => i.category);
      expect(categories).not.toContain('PRICE');
      expect(categories).toContain('QUALIFICATION');
      expect(categories).toContain('RESPONSIVE');
      expect(categories).toContain('BUSINESS');
      expect(categories).toContain('TECHNICAL');

      // 评分类合计须=100（通过性 maxScore=0 不计入）
      const sum = t.filter(i => i.maxScore > 0).reduce((s, i) => s + i.maxScore, 0);
      expect(sum).toBe(100);
    });

    it('comprehensive: 含 PRICE(30)', () => {
      const t = getScoreTemplate('comprehensive');
      const priceItem = t.find(i => i.category === 'PRICE');
      expect(priceItem).toBeDefined();
      expect(priceItem!.maxScore).toBe(30);
    });

    it('lowest_price: PRICE(100)', () => {
      const t = getScoreTemplate('lowest_price');
      const priceItem = t.find(i => i.category === 'PRICE');
      expect(priceItem).toBeDefined();
      expect(priceItem!.maxScore).toBe(100);
    });

    it('none: 空数组', () => {
      expect(getScoreTemplate('none')).toEqual([]);
    });
  });
});
