/* =================================================================
   trust-store 单测 — 信任锚目录加载（临时目录 + 夹具复制）
   ================================================================= */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TrustStore } from './trust-store';
import { parseCertificate } from './x509-cert';

const FIXTURES = path.resolve(__dirname, '../../../../test/fixtures/ca-chain');
const read = (f: string) => fs.readFileSync(path.join(FIXTURES, f));
const load = (name: string) => parseCertificate(read(`${name}.der`));

const leaf = load('leaf');
const wrongLeaf = load('wrong-leaf');

function tempDirWith(files: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trust-store-'));
  for (const f of files) fs.copyFileSync(path.join(FIXTURES, f), path.join(dir, f));
  return dir;
}

describe('TrustStore.load', () => {
  it('root+inter 目录：anchors=[root 自签]，intermediates=[inter]，leaf 链验证通过', () => {
    const store = TrustStore.load(tempDirWith(['root.pem', 'inter.pem']));
    expect(store.isEmpty).toBe(false);
    expect(store.anchors.map((c) => c.cn)).toEqual(['蜀水云采测试根CA']);
    expect(store.intermediates.map((c) => c.cn)).toEqual(['蜀水云采测试中间CA']);
    const r = store.verifyChain(leaf);
    expect(r.ok).toBe(true);
  });

  it('空目录 → isEmpty=true（调用方据此跳过链闸）', () => {
    const store = TrustStore.load(tempDirWith([]));
    expect(store.isEmpty).toBe(true);
  });

  it('目录不存在 → 同空目录语义，不抛错', () => {
    const store = TrustStore.load(path.join(os.tmpdir(), 'trust-store-not-exist'));
    expect(store.isEmpty).toBe(true);
  });

  it('错根目录：wrong-leaf 通过、正链 leaf 不通过', () => {
    const store = TrustStore.load(tempDirWith(['wrong-root.pem']));
    expect(store.verifyChain(wrongLeaf).ok).toBe(true);
    expect(store.verifyChain(leaf).ok).toBe(false);
  });

  it('单文件多证书（root+inter 拼一个 PEM）→ 全部加载', () => {
    const dir = tempDirWith([]);
    fs.writeFileSync(
      path.join(dir, 'bundle.pem'),
      read('root.pem') + '\n' + read('inter.pem'),
    );
    const store = TrustStore.load(dir);
    expect(store.anchors.length).toBe(1);
    expect(store.intermediates.length).toBe(1);
  });

  it('DER 文件（.der）也识别', () => {
    const store = TrustStore.load(tempDirWith(['root.der']));
    expect(store.anchors.length).toBe(1);
  });
});
