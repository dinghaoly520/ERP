import * as crypto from 'crypto';
import { verifyIntegrity, classifyDecryptOutcome } from './bid-submission.crypto';

describe('verifyIntegrity', () => {
  const content = Buffer.from('bid-content');
  const sha = crypto.createHash('sha256').update(content).digest('hex');

  it('内容 SHA-256 与存储值一致 → true', () => {
    expect(verifyIntegrity(content, sha)).toBe(true);
  });
  it('内容被篡改 → false', () => {
    const tampered = Buffer.from('tampered');
    expect(verifyIntegrity(tampered, sha)).toBe(false);
  });
  it('存储 sha 缺失（legacy）→ null（跳过校验）', () => {
    expect(verifyIntegrity(content, '')).toBeNull();
    expect(verifyIntegrity(content, null as any)).toBeNull();
  });
});

describe('classifyDecryptOutcome', () => {
  it('无 sealedKey 且完整性 OK → SUCCESS (legacy)', () => {
    expect(classifyDecryptOutcome({ hasSealedKey: false, decryptOk: null, integrityOk: true }))
      .toBe('SUCCESS');
  });
  it('有 sealedKey 且解密成功且完整性 OK → SUCCESS', () => {
    expect(classifyDecryptOutcome({ hasSealedKey: true, decryptOk: true, integrityOk: true }))
      .toBe('SUCCESS');
  });
  it('有 sealedKey 但 AES 解密失败 → DANGER', () => {
    expect(classifyDecryptOutcome({ hasSealedKey: true, decryptOk: false, integrityOk: null }))
      .toBe('DANGER');
  });
  it('完整性校验不通过 → DANGER', () => {
    expect(classifyDecryptOutcome({ hasSealedKey: true, decryptOk: true, integrityOk: false }))
      .toBe('DANGER');
    expect(classifyDecryptOutcome({ hasSealedKey: false, decryptOk: null, integrityOk: false }))
      .toBe('DANGER');
  });
});
