import { computeArchiveDigest } from './bid-archive.digest';

describe('computeArchiveDigest', () => {
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
