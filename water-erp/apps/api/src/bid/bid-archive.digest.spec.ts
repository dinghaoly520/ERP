import { computeArchiveDigest, computeArchiveChain, computeArchiveRootDigest } from './bid-archive.digest';

describe('computeArchiveDigest (legacy single digest)', () => {
  const project = { id: 'p1', projectCode: 'BID-2026-0518', name: '测试项目', stage: 'ARCHIVED' };
  const items = [
    { id: 'a1', name: '中标通知书', ownerRole: '系统', status: 'ARCHIVED' },
    { id: 'a2', name: '评审报告', ownerRole: '系统', status: 'ARCHIVED' },
  ];

  it('相同输入产生相同 digest', () => {
    const d1 = computeArchiveDigest(project as any, items as any);
    const d2 = computeArchiveDigest(project as any, items as any);
    expect(d1).toBe(d2);
  });

  it('以 sha256: 为前缀且后接 64 位 hex', () => {
    const d = computeArchiveDigest(project as any, items as any);
    expect(d).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('归档项内容变化导致 digest 变化（防篡改）', () => {
    const base = computeArchiveDigest(project as any, items as any);
    const tampered = computeArchiveDigest(project as any,
      [{ ...items[0], name: '篡改项' }, items[1]] as any);
    expect(tampered).not.toBe(base);
  });

  it('项目元数据变化导致 digest 变化', () => {
    const base = computeArchiveDigest(project as any, items as any);
    const changed = computeArchiveDigest({ ...project, name: '改名' } as any, items as any);
    expect(changed).not.toBe(base);
  });

  it('归档项顺序不影响 digest（稳定性）', () => {
    const asc = computeArchiveDigest(project as any, items as any);
    const desc = computeArchiveDigest(project as any, [items[1], items[0]] as any);
    expect(asc).toBe(desc);
  });
});

describe('computeArchiveChain (per-item chained hashes)', () => {
  const project = { id: 'p1', projectCode: 'BID-2026-0518', name: '测试项目', stage: 'ARCHIVED' };
  const items = [
    { id: 'a1', name: '中标通知书', ownerRole: '系统', status: 'ARCHIVED' },
    { id: 'a2', name: '评审报告', ownerRole: '系统', status: 'ARCHIVED' },
    { id: 'a3', name: '合同文本', ownerRole: '系统', status: 'ARCHIVED' },
  ];

  it('返回每个 item 的独立哈希', () => {
    const chain = computeArchiveChain(project as any, items as any);
    expect(chain.size).toBe(3);
    expect(chain.get('a1')).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(chain.get('a2')).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(chain.get('a3')).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('每个 item 的哈希互不相同（链式递进）', () => {
    const chain = computeArchiveChain(project as any, items as any);
    const hashes = [...chain.values()];
    expect(new Set(hashes).size).toBe(3);
  });

  it('篡改中间项会破坏该项及所有后续项哈希（链式防篡改）', () => {
    const base = computeArchiveChain(project as any, items as any);
    const tampered = computeArchiveChain(project as any,
      [{ ...items[0], name: '篡改通知书' }, items[1], items[2]] as any);
    // 第一项被篡改 → 三项哈希全变
    expect(tampered.get('a1')).not.toBe(base.get('a1'));
    expect(tampered.get('a2')).not.toBe(base.get('a2'));
    expect(tampered.get('a3')).not.toBe(base.get('a3'));
  });

  it('仅篡改最后一项，前两项哈希不变（链的局部性）', () => {
    const base = computeArchiveChain(project as any, items as any);
    const tampered = computeArchiveChain(project as any,
      [items[0], items[1], { ...items[2], name: '篡改合同' }] as any);
    expect(tampered.get('a1')).toBe(base.get('a1'));
    expect(tampered.get('a2')).toBe(base.get('a2'));
    expect(tampered.get('a3')).not.toBe(base.get('a3'));
  });

  it('输入顺序不影响链（按 id 稳定排序）', () => {
    const asc = computeArchiveChain(project as any, items as any);
    const desc = computeArchiveChain(project as any, [items[2], items[1], items[0]] as any);
    expect(asc.get('a1')).toBe(desc.get('a1'));
    expect(asc.get('a2')).toBe(desc.get('a2'));
    expect(asc.get('a3')).toBe(desc.get('a3'));
  });

  it('项目元数据变化导致全链哈希变化', () => {
    const base = computeArchiveChain(project as any, items as any);
    const changed = computeArchiveChain({ ...project, name: '改名' } as any, items as any);
    expect(changed.get('a1')).not.toBe(base.get('a1'));
  });

  it('空 items 返回空 Map', () => {
    const chain = computeArchiveChain(project as any, [] as any);
    expect(chain.size).toBe(0);
  });
});

describe('computeArchiveRootDigest', () => {
  const project = { id: 'p1', projectCode: 'BID-2026-0518', name: '测试项目', stage: 'ARCHIVED' };
  const items = [
    { id: 'a1', name: '中标通知书', ownerRole: '系统', status: 'ARCHIVED' },
    { id: 'a2', name: '评审报告', ownerRole: '系统', status: 'ARCHIVED' },
  ];

  it('根哈希 = 链中最后一项的哈希', () => {
    const root = computeArchiveRootDigest(project as any, items as any);
    const chain = computeArchiveChain(project as any, items as any);
    expect(root).toBe(chain.get('a2'));
    expect(root).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('无 item 时返回创世哈希', () => {
    const root = computeArchiveRootDigest(project as any, [] as any);
    expect(root).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('根哈希随内容变化', () => {
    const base = computeArchiveRootDigest(project as any, items as any);
    const changed = computeArchiveRootDigest(project as any,
      [{ ...items[0], name: '篡改' }, items[1]] as any);
    expect(changed).not.toBe(base);
  });
});
