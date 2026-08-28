// apps/api/src/supervision-push/supervision-push-payload.spec.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildPushEnvelope, envelopeFingerprint } from './supervision-push-payload';
import { PlatformSigningService } from './platform-signing.service';
import { SignatureService } from '../common/crypto/signature.service';

describe('A-153 推送信封 + 平台签名', () => {
  const input = {
    payloadType: 'EVALUATION_REPORT' as const,
    platformCode: 'SC-PSVP-TEST',
    generatedAt: '2026-08-28T10:00:00.000Z',
    project: { id: 'p1', projectCode: 'BID-TEST', name: '测试项目', procurementMethod: '公开招标' },
    body: { results: [{ supplierName: '甲', totalScore: '92.5', rank: 1 }] },
    attachments: [{ name: '评标签字包.pdf', category: 'bid_sign_packet', fileAssetId: 'fa1', sha256: 'h1' }],
  };

  it('同输入指纹稳定（确定性）', () => {
    const e1 = buildPushEnvelope(input);
    const e2 = buildPushEnvelope(input);
    expect(envelopeFingerprint(e1)).toBe(envelopeFingerprint(e2));
    expect(e1.packageType).toBe('SUPERVISION_PUSH');
    expect(e1.packageVersion).toBe(1);
  });

  it('generatedAt 变化 → 指纹变化', () => {
    const a = envelopeFingerprint(buildPushEnvelope(input));
    const b = envelopeFingerprint(buildPushEnvelope({ ...input, generatedAt: '2026-08-28T11:00:00.000Z' }));
    expect(a).not.toBe(b);
  });

  it('信封含 attachments 与 body 全量', () => {
    const e = buildPushEnvelope(input);
    expect(e.attachments).toHaveLength(1);
    expect((e.body as { results: unknown[] }).results).toHaveLength(1);
  });

  describe('PlatformSigningService（临时 keystore 目录）', () => {
    let svc: PlatformSigningService;
    let dir: string;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sup-push-'));
      process.env.SUPERVISION_KEYSTORE_DIR = dir;
      svc = new PlatformSigningService(new SignatureService());
    });

    afterAll(() => { delete process.env.SUPERVISION_KEYSTORE_DIR; });

    it('首次生成 + 幂等复用（同证书同公钥）', () => {
      const k1 = svc.ensureKey();
      expect(k1.publicKey).toMatch(/^04[0-9a-fA-F]{128}$/);
      expect(fs.existsSync(path.join(dir, 'platform-signing.json'))).toBe(true);
      const k2 = new PlatformSigningService(new SignatureService()).ensureKey();
      expect(k2.publicKey).toBe(k1.publicKey);
    });

    it('fingerprint 签名 → 用返回公钥可验', () => {
      const fp = envelopeFingerprint(buildPushEnvelope(input));
      const sig = svc.signFingerprint(fp);
      expect(new SignatureService().verify(fp, sig.value, sig.publicKey)).toBe(true);
      expect(sig.algorithm).toBe('SM2/SM3');
    });
  });
});
