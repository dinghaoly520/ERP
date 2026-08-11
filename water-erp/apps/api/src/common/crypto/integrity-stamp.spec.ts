import { createIntegrityStamp, verifyIntegrityStamp } from './integrity-stamp';

describe('integrity stamp', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long';
  });

  it('签名 + 验证往返', () => {
    const stamp = createIntegrityStamp('user-1', 'SIGN_IN', 'project-1');
    expect(stamp).toHaveProperty('sig');
    expect(stamp).toHaveProperty('ts');
    expect(typeof stamp.sig).toBe('string');
    expect(typeof stamp.ts).toBe('string');
    expect(stamp.sig.length).toBeGreaterThan(0);
    expect(stamp.ts.length).toBeGreaterThan(0);
    expect(verifyIntegrityStamp(stamp, 'user-1', 'SIGN_IN', 'project-1')).toBe(true);
  });

  it('不同 user 验证失败', () => {
    const stamp = createIntegrityStamp('user-1', 'SIGN_IN', 'project-1');
    expect(verifyIntegrityStamp(stamp, 'user-2', 'SIGN_IN', 'project-1')).toBe(false);
  });

  it('不同 action 验证失败', () => {
    const stamp = createIntegrityStamp('user-1', 'SIGN_IN', 'project-1');
    expect(verifyIntegrityStamp(stamp, 'user-1', 'SUBMIT_SCORES', 'project-1')).toBe(false);
  });

  it('不同 resourceId 验证失败', () => {
    const stamp = createIntegrityStamp('user-1', 'SIGN_IN', 'project-1');
    expect(verifyIntegrityStamp(stamp, 'user-1', 'SIGN_IN', 'project-2')).toBe(false);
  });

  it('篡改 sig 验证失败', () => {
    const stamp = createIntegrityStamp('user-1', 'SIGN_IN', 'project-1');
    const tampered: typeof stamp = { ts: stamp.ts, sig: stamp.sig.replace(/[a-f]/g, '0') };
    expect(verifyIntegrityStamp(tampered, 'user-1', 'SIGN_IN', 'project-1')).toBe(false);
  });

  it('篡改 ts 验证失败', () => {
    const stamp = createIntegrityStamp('user-1', 'SIGN_IN', 'project-1');
    const tampered: typeof stamp = { ts: new Date(0).toISOString(), sig: stamp.sig };
    expect(verifyIntegrityStamp(tampered, 'user-1', 'SIGN_IN', 'project-1')).toBe(false);
  });
});
