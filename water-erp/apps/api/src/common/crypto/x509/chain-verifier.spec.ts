/* =================================================================
   chain-verifier 单测 — 五用例：合法链 / 根不在锚 / 时间窗 / 非 CA 签发 / tbs 篡改
   ================================================================= */
import * as fs from 'fs';
import * as path from 'path';
import { parseCertificate } from './x509-cert';
import { verifyChain } from './chain-verifier';

const FIXTURES = path.resolve(__dirname, '../../../../test/fixtures/ca-chain');
const load = (name: string) => parseCertificate(fs.readFileSync(path.join(FIXTURES, `${name}.der`)));

const leaf = load('leaf');
const inter = load('inter');
const root = load('root');
const wrongRoot = load('wrong-root');
const wrongLeaf = load('wrong-leaf');
const badChild = load('bad-child');

describe('verifyChain — 路径构建与验证', () => {
  it('合法链：leaf→inter→root → CHAIN_OK，返回完整链', () => {
    const r = verifyChain(leaf, [inter, root]);
    expect(r.ok).toBe(true);
    expect(r.code).toBe('CHAIN_OK');
    expect(r.chain.map((c) => c.cn)).toEqual([
      '四川水发建设有限公司',
      '蜀水云采测试中间CA',
      '蜀水云采测试根CA',
    ]);
  });

  it('根不在锚内（错根替换）→ NO_PATH_TO_TRUSTED_ROOT', () => {
    const r = verifyChain(leaf, [inter, wrongRoot]);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('NO_PATH_TO_TRUSTED_ROOT');
  });

  it('错链叶子对正锚 → NO_PATH_TO_TRUSTED_ROOT', () => {
    const r = verifyChain(wrongLeaf, [inter, root]);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('NO_PATH_TO_TRUSTED_ROOT');
  });

  it('时间窗：atTime 晚于 notAfter → EXPIRED；早于 notBefore → NOT_YET_VALID', () => {
    const future = new Date(leaf.notAfter.getTime() + 3600_000);
    expect(verifyChain(leaf, [inter, root], future).code).toBe('EXPIRED');
    const past = new Date(leaf.notBefore.getTime() - 3600_000);
    expect(verifyChain(leaf, [inter, root], past).code).toBe('NOT_YET_VALID');
  });

  it('非 CA 证书作为签发者（bad-child←leaf）→ NOT_CA', () => {
    const r = verifyChain(badChild, [leaf, inter, root]);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('NOT_CA');
  });

  it('tbs 篡改（DN 匹配但验签失败）→ BAD_SIGNATURE（区别于无路径）', () => {
    const raw = Buffer.from(leaf.raw);
    const idx = raw.indexOf(Buffer.from('四川水发建设有限公司', 'utf8'));
    raw[idx] ^= 0x01;
    const tampered = parseCertificate(raw);
    const r = verifyChain(tampered, [inter, root]);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('BAD_SIGNATURE');
  });

  it('深度超限（MAX_CHAIN_DEPTH 以下合法链不受影响）', () => {
    // 现夹具链深度 3（含根），默认上限内；此处仅验证上限常量语义不误伤
    const r = verifyChain(leaf, [inter, root]);
    expect(r.chain.length).toBeLessThanOrEqual(4);
  });
});
