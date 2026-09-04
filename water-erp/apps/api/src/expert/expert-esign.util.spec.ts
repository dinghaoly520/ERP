import { buildExpertEsignCanonical, stripExpertEsignature } from './expert-esign.util';

const baseInput = {
  purpose: 'report_esign' as const,
  projectId: 'proj-1',
  bidExpertId: 'exp-1',
  userId: 'user-1',
  expertName: '王建国',
  packetSha256: 'a'.repeat(64),
  packetGeneratedAt: '2026-09-02T08:00:00.000Z',
};

describe('buildExpertEsignCanonical（A-152 评标报告电子签名）', () => {
  it('键序稳定（canonicalJson 字母序），同输入恒等', () => {
    const out = buildExpertEsignCanonical(baseInput);
    expect(out).toBe(
      `{"bidExpertId":"exp-1","expertName":"王建国","packetGeneratedAt":"2026-09-02T08:00:00.000Z",` +
        `"packetSha256":"${'a'.repeat(64)}","projectId":"proj-1","purpose":"report_esign","userId":"user-1","v":1}`,
    );
    expect(buildExpertEsignCanonical(baseInput)).toBe(out); // 确定性
  });

  it('purpose 定值 report_esign 入串（验证期语义锚点）', () => {
    expect(buildExpertEsignCanonical(baseInput)).toContain('"purpose":"report_esign"');
  });

  it('绑入 packetSha256 / packetGeneratedAt（重生成换指纹即换载荷，旧签名失效）', () => {
    const out = buildExpertEsignCanonical({ ...baseInput, packetSha256: 'b'.repeat(64) });
    expect(out).toContain(`"packetSha256":"${'b'.repeat(64)}"`);
    const out2 = buildExpertEsignCanonical({ ...baseInput, packetGeneratedAt: '2026-09-03T00:00:00.000Z' });
    expect(out2).toContain('"packetGeneratedAt":"2026-09-03T00:00:00.000Z"');
    expect(out2).not.toBe(out);
  });

  it('键插入顺序无关——漂移输入同串（防手拼对象顺序抖动）', () => {
    const shuffled = {
      expertName: '王建国',
      packetGeneratedAt: baseInput.packetGeneratedAt,
      userId: 'user-1',
      packetSha256: baseInput.packetSha256,
      purpose: 'report_esign' as const,
      bidExpertId: 'exp-1',
      projectId: 'proj-1',
    };
    expect(buildExpertEsignCanonical(shuffled)).toBe(buildExpertEsignCanonical(baseInput));
  });
});

describe('stripExpertEsignature（回流包/本人视图剥壳）', () => {
  it('完整签名 → {algorithm, certSn, verifiedAt} 摘要（剥离 payload/signature 长串）', () => {
    const stripped = stripExpertEsignature({
      v: 1, payload: 'x'.repeat(200), signature: 'y'.repeat(200),
      algorithm: 'SM2/SM3', certSn: 'SN-1', verifiedAt: '2026-09-02T08:05:00.000Z',
    });
    expect(stripped).toEqual({ algorithm: 'SM2/SM3', certSn: 'SN-1', verifiedAt: '2026-09-02T08:05:00.000Z' });
  });

  it('null/非对象 → null', () => {
    expect(stripExpertEsignature(null)).toBeNull();
    expect(stripExpertEsignature(undefined)).toBeNull();
  });
});
