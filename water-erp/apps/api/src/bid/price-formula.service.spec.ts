import { PriceFormulaService, PriceFormulaConfig } from './price-formula.service';

describe('PriceFormulaService', () => {
  let service: PriceFormulaService;

  beforeEach(() => {
    service = new PriceFormulaService();
  });

  describe('最低评标价法 (lowest_price)', () => {
    const config: PriceFormulaConfig = { formulaType: 'lowest_price' };

    it('最低报价得满分,其余按比例折算', () => {
      const prices = new Map([['A', 90], ['B', 100], ['C', 120]]);
      const scores = service.calculate(config, prices, null, 30);
      expect(Number(scores.get('A'))).toBe(30);   // 最低 → 满分
      expect(Number(scores.get('B'))).toBe(27);   // 90/100 × 30 = 27
      expect(Number(scores.get('C'))).toBeCloseTo(22.5, 1); // 90/120 × 30 = 22.5
    });

    it('所有报价相等时都得满分', () => {
      const prices = new Map([['A', 100], ['B', 100]]);
      const scores = service.calculate(config, prices, null, 30);
      expect(Number(scores.get('A'))).toBe(30);
      expect(Number(scores.get('B'))).toBe(30);
    });

    it('空报价或 0 返回 0 分', () => {
      const prices = new Map([['A', 0], ['B', 100]]);
      const scores = service.calculate(config, prices, null, 30);
      expect(Number(scores.get('A'))).toBe(0);
    });
  });

  describe('基准价偏离法 (benchmark_deviation)', () => {
    const config: PriceFormulaConfig = {
      formulaType: 'benchmark_deviation',
      K: 1.0,        // benchmark = ceiling × 1.0
      penaltyRate: 2, // 每 1% 偏离扣 2% 满分
    };

    it('等于基准价时满分', () => {
      const prices = new Map([['A', 100]]);
      // benchmark = 100 × 1.0 = 100, 报价 100 = 基准 → 满分
      const scores = service.calculate(config, prices, 100, 30);
      expect(Number(scores.get('A'))).toBe(30);
    });

    it('偏离 10% 扣 20% 满分', () => {
      const prices = new Map([['A', 110]]); // 偏离 +10%
      // deduction = (10 - 0) × (2/100) = 0.2 → score = 30 × (1 - 0.2) = 24
      const scores = service.calculate(config, prices, 100, 30);
      expect(Number(scores.get('A'))).toBe(24);
    });

    it('双向偏离都扣分', () => {
      const prices = new Map([['A', 110], ['B', 90]]); // +10% / -10%
      const scores = service.calculate(config, prices, 100, 30);
      expect(Number(scores.get('A'))).toBe(24);
      expect(Number(scores.get('B'))).toBe(24); // 对称扣分
    });

    it('无惩罚区间内不扣分', () => {
      const configWithRange: PriceFormulaConfig = {
        ...config,
        noPenaltyRange: 5, // ±5% 内不扣
      };
      const prices = new Map([['A', 104]]); // 偏离 +4%(在区间内)
      const scores = service.calculate(configWithRange, prices, 100, 30);
      expect(Number(scores.get('A'))).toBe(30);
    });

    it('偏离过大得 0 分(封底)', () => {
      const prices = new Map([['A', 200]]); // 偏离 100%
      // deduction = (100-0) × (2/100) = 2 → score = 30 × (1-2) = -30 → max(0,...) = 0
      const scores = service.calculate(config, prices, 100, 30);
      expect(Number(scores.get('A'))).toBe(0);
    });
  });

  describe('比例法 (ratio)', () => {
    const config: PriceFormulaConfig = { formulaType: 'ratio' };

    it('报价等于控制价时满分', () => {
      const prices = new Map([['A', 100]]);
      const scores = service.calculate(config, prices, 100, 30);
      expect(Number(scores.get('A'))).toBe(30);
    });

    it('报价低于控制价时分更高', () => {
      const prices = new Map([['A', 80]]);
      // 100/80 × 30 = 37.5 → 但不应超过满分?比例法本身不封顶
      const scores = service.calculate(config, prices, 100, 30);
      expect(Number(scores.get('A'))).toBeCloseTo(37.5, 1);
    });

    it('报价高于控制价时分更低', () => {
      const prices = new Map([['A', 120]]);
      // 100/120 × 30 = 25
      const scores = service.calculate(config, prices, 100, 30);
      expect(Number(scores.get('A'))).toBeCloseTo(25, 1);
    });
  });

  describe('getOverCeilingSuppliers', () => {
    it('返回超出限价的供应商 ID', () => {
      const prices = new Map([['A', 90], ['B', 110], ['C', 105]]);
      const over = service.getOverCeilingSuppliers(prices, 100);
      expect(over).toContain('B');
      expect(over).toContain('C');
      expect(over).not.toContain('A');
    });

    it('无 ceilingPrice 时返回空', () => {
      const prices = new Map([['A', 999]]);
      expect(service.getOverCeilingSuppliers(prices, null)).toEqual([]);
    });
  });

  describe('边界情况', () => {
    it('空报价 Map 返回空结果', () => {
      const scores = service.calculate({ formulaType: 'lowest_price' }, new Map(), null, 30);
      expect(scores.size).toBe(0);
    });

    it('maxScore 为 0 返回空结果', () => {
      const prices = new Map([['A', 100]]);
      const scores = service.calculate({ formulaType: 'lowest_price' }, prices, null, 0);
      expect(scores.size).toBe(0);
    });

    it('未知公式类型回退最低价法', () => {
      const prices = new Map([['A', 90], ['B', 100]]);
      const scores = service.calculate({ formulaType: 'unknown' as any }, prices, null, 30);
      expect(Number(scores.get('A'))).toBe(30); // 最低价满分
    });
  });
});
