import { NullRevocationChecker } from './revocation';

describe('NullRevocationChecker（阶段1 占位）', () => {
  it('check 恒返回未吊销', async () => {
    const r = await new NullRevocationChecker().check(null as any);
    expect(r).toEqual({ revoked: false });
  });
});
