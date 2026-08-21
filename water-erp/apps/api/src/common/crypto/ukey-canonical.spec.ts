import { canonicalJson, canonicalEnvelopeHash, computeFieldsCommit } from '@water-erp/ukey';

describe('ukey canonical（前后端一致性锚点）', () => {
  const fields = { price: '798000', deliveryPeriod: '120日历天', qualityCommitment: '合格' };

  it('canonicalJson：键字典序、无空白、嵌套递归', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 2], c: 'x' } }))
      .toBe('{"a":{"c":"x","d":[3,2]},"b":1}');
  });
  it('canonicalJson：undefined 值键被剔除（Partial files 场景）', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
  it('computeFieldsCommit：确定性 + nonce 变化则变化', async () => {
    const c1 = await computeFieldsCommit(fields, 'ff'.repeat(16));
    const c2 = await computeFieldsCommit(fields, 'ff'.repeat(16));
    const c3 = await computeFieldsCommit(fields, '00'.repeat(16));
    expect(c1).toBe(c2); expect(c1).not.toBe(c3); expect(c1).toMatch(/^[0-9a-f]{64}$/);
  });
  it('canonicalEnvelopeHash：file 条目次序不影响哈希（canonical 排序）', async () => {
    const mk = (order: string[]) => ({ version: 'dual-v2' as const, certSn: 'sn-1', adminCertId: 'ac-1',
      files: Object.fromEntries(order.map(r => [r, { sha256: 'a', kself: 'b', kadmin: 'c' }])),
      sealedFields: { cipher: 'c1', kself: 'k1', fieldsSha256: 'f1' }, fieldsCommit: 'fc' });
    const h1 = await canonicalEnvelopeHash(mk(['technical', 'bond']) as any);
    const h2 = await canonicalEnvelopeHash(mk(['bond', 'technical']) as any);
    expect(h1).toBe(h2);
  });
});
