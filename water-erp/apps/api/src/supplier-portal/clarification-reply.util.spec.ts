// apps/api/src/supplier-portal/clarification-reply.util.spec.ts
import { buildClarificationReplyCanonical } from './clarification-reply.util';
import { SignatureService } from '../common/crypto/signature.service';

describe('A-143 澄清答复 canonical + SM2 验签', () => {
  const sig = new SignatureService();
  const base = {
    clarificationId: 'clar1',
    projectId: 'p1',
    supplierId: 'sup1',
    reply: '针对该问题答复如下：报价含税，交付期 30 天。',
    certSn: 'SN-TEST-001',
  };

  it('附件顺序无关：不同上传顺序得到同一 canonical', () => {
    const a = buildClarificationReplyCanonical({
      ...base,
      attachments: [
        { fileAssetId: 'f1', sha256: 'h1' },
        { fileAssetId: 'f2', sha256: 'h2' },
      ],
    });
    const b = buildClarificationReplyCanonical({
      ...base,
      attachments: [
        { fileAssetId: 'f2', sha256: 'h2' },
        { fileAssetId: 'f1', sha256: 'h1' },
      ],
    });
    expect(a).toBe(b);
    expect(a).toContain('clar1');
    expect(a).toContain('SN-TEST-001');
  });

  it('SM2 签名→验签闭环（正例）', () => {
    const kp = sig.generateKeyPair();
    const payload = buildClarificationReplyCanonical({ ...base, attachments: [] });
    const signature = sig.sign(payload, kp.privateKey);
    expect(sig.verify(payload, signature, kp.publicKey)).toBe(true);
  });

  it('篡改答复文本验签失败', () => {
    const kp = sig.generateKeyPair();
    const payload = buildClarificationReplyCanonical({ ...base, attachments: [] });
    const signature = sig.sign(payload, kp.privateKey);
    const tampered = buildClarificationReplyCanonical({ ...base, reply: '篡改后的答复', attachments: [] });
    expect(sig.verify(tampered, signature, kp.publicKey)).toBe(false);
  });

  it('附件指纹进入签名域：换 sha256 验签失败', () => {
    const kp = sig.generateKeyPair();
    const payload = buildClarificationReplyCanonical({
      ...base,
      attachments: [{ fileAssetId: 'f1', sha256: 'h1' }],
    });
    const signature = sig.sign(payload, kp.privateKey);
    const swapped = buildClarificationReplyCanonical({
      ...base,
      attachments: [{ fileAssetId: 'f1', sha256: 'ATTACK' }],
    });
    expect(sig.verify(swapped, signature, kp.publicKey)).toBe(false);
  });

  it('换密钥验签失败', () => {
    const kp = sig.generateKeyPair();
    const other = sig.generateKeyPair();
    const payload = buildClarificationReplyCanonical({ ...base, attachments: [] });
    const signature = sig.sign(payload, kp.privateKey);
    expect(sig.verify(payload, signature, other.publicKey)).toBe(false);
  });
});
