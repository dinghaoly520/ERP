import {
  QUALIFICATION_DICTIONARY,
  hardConditionsEmpty,
  verifySupplierHardConditions,
  filterPoolByHardConditions,
  sanitizeHardConditions,
  sanitizeSuggestedHardConditions,
} from './supplier-hard-conditions';

const DAYS = 24 * 3600 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAYS);

function mkSupplier(over: Partial<Parameters<typeof verifySupplierHardConditions>[0]> = {}) {
  return {
    id: 's1',
    name: '测试供应商',
    industry: '通用设备制造业',
    qualifications: [],
    performances: [],
    ...over,
  };
}

describe('资质字典', () => {
  it('key 唯一且 keywords 非空', () => {
    const keys = QUALIFICATION_DICTIONARY.map((q) => q.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const q of QUALIFICATION_DICTIONARY) expect(q.keywords.length).toBeGreaterThan(0);
  });
});

describe('hardConditionsEmpty', () => {
  it('空对象/undefined 为 true，任一维度有值为 false', () => {
    expect(hardConditionsEmpty(undefined)).toBe(true);
    expect(hardConditionsEmpty({})).toBe(true);
    expect(hardConditionsEmpty({ industries: ['批发业'] })).toBe(false);
    expect(hardConditionsEmpty({ performance: { minCount: 2 } })).toBe(false);
    expect(hardConditionsEmpty({ qualifications: [{ key: 'iso9001', required: true }] })).toBe(false);
    expect(hardConditionsEmpty({ minGrade: 'B' })).toBe(false);
    // 空壳子对象视为空
    expect(hardConditionsEmpty({ performance: {} })).toBe(true);
    expect(hardConditionsEmpty({ industries: [] })).toBe(true);
  });
});

describe('行业三态', () => {
  const cond = { industries: ['通用设备制造业', '批发业'] };
  it('命中=PASS', () => {
    const checks = verifySupplierHardConditions(mkSupplier(), cond);
    expect(checks[0].status).toBe('PASS');
    expect(checks[0].type).toBe('industry');
    expect(checks[0].required).toBe(true);
  });
  it('未命中=FAIL 且 detail 载明实际行业', () => {
    const checks = verifySupplierHardConditions(mkSupplier({ industry: '餐饮业' }), cond);
    expect(checks[0].status).toBe('FAIL');
    expect(checks[0].detail).toContain('餐饮业');
  });
  it('未填行业=MISSING', () => {
    const checks = verifySupplierHardConditions(mkSupplier({ industry: null }), cond);
    expect(checks[0].status).toBe('MISSING');
  });
});

describe('资质三态（关键词变体匹配）', () => {
  const cond = { qualifications: [{ key: 'iso9001', required: true }] };
  it.each(['ISO9001质量管理体系认证', 'ISO 9001:2015认证', '质量管理体系认证证书'])(
    '变体命中且有效=PASS（%s）',
    (name) => {
      const checks = verifySupplierHardConditions(
        mkSupplier({ qualifications: [{ name, validTo: null }] }),
        cond,
      );
      expect(checks[0].status).toBe('PASS');
    },
  );
  it('命中但全部过期=FAIL', () => {
    const checks = verifySupplierHardConditions(
      mkSupplier({ qualifications: [{ name: 'ISO9001认证', validTo: new Date('2020-01-01') }] }),
      cond,
    );
    expect(checks[0].status).toBe('FAIL');
    expect(checks[0].detail).toContain('过期');
  });
  it('无命中=MISSING（长串自由文本不含关键词）', () => {
    const checks = verifySupplierHardConditions(
      mkSupplier({ qualifications: [{ name: '持证等级: 工程勘察（综合）甲级', validTo: null }] }),
      cond,
    );
    expect(checks[0].status).toBe('MISSING');
  });
  it('优先级不改变核验状态，required=false 随行', () => {
    const checks = verifySupplierHardConditions(
      mkSupplier(),
      { qualifications: [{ key: 'iso9001', required: false }] },
    );
    expect(checks[0].status).toBe('MISSING');
    expect(checks[0].required).toBe(false);
  });
  it('字符串 validTo 可解析（ISO 日期）', () => {
    const checks = verifySupplierHardConditions(
      mkSupplier({ qualifications: [{ name: '质量管理体系认证', validTo: '2030-01-01T00:00:00.000Z' }] }),
      cond,
    );
    expect(checks[0].status).toBe('PASS');
  });
});

describe('业绩三态', () => {
  const perf = (name: string, signDate: Date) => ({
    projectName: name,
    description: null,
    signDate,
    createdAt: signDate,
  });
  it('年限窗内数量达标=PASS', () => {
    const s = mkSupplier({
      performances: [perf('钻机采购', daysAgo(30)), perf('钻具供货', daysAgo(400))],
    });
    const checks = verifySupplierHardConditions(s, {
      performance: { years: 3, minCount: 2, keywords: ['钻'] },
    });
    expect(checks[0].status).toBe('PASS');
  });
  it('有记录但数量不足=FAIL', () => {
    const s = mkSupplier({ performances: [perf('办公家具', daysAgo(30))] });
    const checks = verifySupplierHardConditions(s, { performance: { minCount: 2 } });
    expect(checks[0].status).toBe('FAIL');
  });
  it('记录在年限窗外不计入（FAIL）', () => {
    const s = mkSupplier({ performances: [perf('钻机', daysAgo(4 * 365))] });
    const checks = verifySupplierHardConditions(s, { performance: { years: 3, minCount: 1 } });
    expect(checks[0].status).toBe('FAIL');
  });
  it('signDate 缺失回退 createdAt', () => {
    const s = mkSupplier({
      performances: [{ projectName: '钻机', description: null, signDate: null, createdAt: daysAgo(30) }],
    });
    const checks = verifySupplierHardConditions(s, { performance: { minCount: 1 } });
    expect(checks[0].status).toBe('PASS');
  });
  it('零记录=MISSING（库内数据空白期常态）', () => {
    const checks = verifySupplierHardConditions(mkSupplier(), { performance: { minCount: 1 } });
    expect(checks[0].status).toBe('MISSING');
    expect(checks[0].detail).toContain('业绩');
  });
  it('minCount 未设但（年限窗内）有记录=PASS', () => {
    const s = mkSupplier({ performances: [perf('任意项目', daysAgo(30))] });
    const checks = verifySupplierHardConditions(s, { performance: { years: 3 } });
    expect(checks[0].status).toBe('PASS');
  });
});

describe('评价等级三态', () => {
  it('阈值比较：达标=PASS / 不达标=FAIL / 无记录=MISSING', () => {
    expect(verifySupplierHardConditions(mkSupplier(), { minGrade: 'B' }, 'B')[0].status).toBe('PASS');
    expect(verifySupplierHardConditions(mkSupplier(), { minGrade: 'A' }, 'B')[0].status).toBe('FAIL');
    expect(verifySupplierHardConditions(mkSupplier(), { minGrade: 'B' })[0].status).toBe('MISSING');
    expect(verifySupplierHardConditions(mkSupplier(), { minGrade: 'B' }, null)[0].status).toBe('MISSING');
  });
});

describe('filterPoolByHardConditions', () => {
  it('必须级 FAIL 剔除进 filteredOut，MISSING 保留，checks 记录保留者', () => {
    const pool = [
      mkSupplier({ id: 'a', name: '甲', industry: '通用设备制造业' }),
      mkSupplier({ id: 'b', name: '乙', industry: '餐饮业' }), // 行业 FAIL → 剔除
      mkSupplier({ id: 'c', name: '丙', industry: null }), // 行业 MISSING → 保留
    ];
    const r = filterPoolByHardConditions(pool, { industries: ['通用设备制造业'] });
    expect(r.kept.map((s) => s.id)).toEqual(['a', 'c']);
    expect(r.filteredOut).toEqual([
      { supplierId: 'b', name: '乙', failedCondition: expect.stringContaining('行业') },
    ]);
    expect(r.checksBySupplier.get('a')![0].status).toBe('PASS');
    expect(r.checksBySupplier.get('c')![0].status).toBe('MISSING');
    expect(r.checksBySupplier.get('b')).toBeDefined(); // 被剔除者也留 checks 供复核
  });
  it('优先级资质 FAIL 不剔除', () => {
    const pool = [mkSupplier({ id: 'a', qualifications: [] })];
    const r = filterPoolByHardConditions(pool, {
      qualifications: [{ key: 'iso9001', required: false }],
    });
    expect(r.kept).toHaveLength(1);
    expect(r.filteredOut).toHaveLength(0);
  });
  it('空条件原样放行', () => {
    const pool = [mkSupplier()];
    expect(filterPoolByHardConditions(pool, {}).kept).toHaveLength(1);
  });
});

describe('sanitizeHardConditions', () => {
  it('消毒：非法 key 剔除、数字夹取、类型矫正', () => {
    const out = sanitizeHardConditions({
      industries: ['批发业', 42, ''],
      qualifications: [
        { key: 'iso9001', required: 'yes' },
        { key: '不存在的key', required: true },
      ],
      performance: { years: 99, minCount: -3, keywords: ['钻机', 7] },
      minGrade: 'D',
    });
    expect(out.industries).toEqual(['批发业']);
    expect(out.qualifications).toEqual([{ key: 'iso9001', required: true }]);
    expect(out.performance).toEqual({ years: 10, minCount: 1, keywords: ['钻机'] });
    expect(out.minGrade).toBeUndefined();
  });
  it('垃圾输入返回空对象', () => {
    expect(sanitizeHardConditions('nonsense')).toEqual({});
    expect(sanitizeHardConditions(null)).toEqual({});
  });
});

describe('sanitizeSuggestedHardConditions（LLM 预填白名单）', () => {
  const vocab = { industries: ['通用设备制造业', '批发业'], qualKeys: ['iso9001', 'hightech'] };
  it('词表内保留、词表外剔除', () => {
    const out = sanitizeSuggestedHardConditions(
      {
        industries: ['批发业', '餐饮业'],
        qualifications: [
          { key: 'iso9001', required: true },
          { key: 'iso45001', required: false },
        ],
        minGrade: 'B',
      },
      vocab,
    );
    expect(out).toEqual({
      industries: ['批发业'],
      qualifications: [{ key: 'iso9001', required: true }],
      minGrade: 'B',
    });
  });
  it('LLM 编造的垃圾全滤后返回空对象', () => {
    expect(sanitizeSuggestedHardConditions({ industries: ['不存在行业'] }, vocab)).toEqual({});
  });
});
