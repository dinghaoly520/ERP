import { checkEliminationRatio } from './framework-agreement';

describe('checkEliminationRatio（GB/T 43711 D.2.6）', () => {
  it('开放式资格审查不适用', () => {
    const r = checkEliminationRatio({ entryMode: 'open', rounds: 0, participants: [], entered: 5 });
    expect(r.passed).toBe(true);
  });

  it('一次竞争：10 参与 5 入围（淘汰 50%）→ 通过', () => {
    const r = checkEliminationRatio({ entryMode: 'closed', rounds: 1, participants: [10], entered: 5 });
    expect(r.passed).toBe(true);
  });

  it('一次竞争：10 参与 7 入围（淘汰 30%<50%）→ 不通过', () => {
    const r = checkEliminationRatio({ entryMode: 'closed', rounds: 1, participants: [10], entered: 7 });
    expect(r.passed).toBe(false);
    expect(r.detail).toContain('50%');
  });

  it('两次竞争：10 参与 6 入围（淘汰 40%≥30%）→ 通过', () => {
    const r = checkEliminationRatio({ entryMode: 'closed', rounds: 2, participants: [10, 8], entered: 6 });
    expect(r.passed).toBe(true);
  });

  it('参与数为 0 → 不通过', () => {
    const r = checkEliminationRatio({ entryMode: 'closed', rounds: 1, participants: [0], entered: 1 });
    expect(r.passed).toBe(false);
  });
});
