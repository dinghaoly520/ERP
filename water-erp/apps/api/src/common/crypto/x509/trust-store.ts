/* =================================================================
   trust-store — 信任锚目录（TRUSTED_CA_DIR）加载与链验证门面

   目录约定：*.pem / *.crt / *.cer（PEM，单文件可含多证书）与 *.der。
   - 自签证书（issuer==subject）视为信任锚（根）
   - 其余（中间 CA）作为链构建候选
   - 目录缺失/为空 → 空库（调用方据此跳过链闸，mock 轨兼容）
   真实根证书到位（如四川CA 根 + 中间）后放入目录即生效，无需改代码。
   ================================================================= */
import * as fs from 'fs';
import * as path from 'path';
import { ChainVerifyResult, verifyChain } from './chain-verifier';
import { ParsedX509, parseCertificate, pemToDer } from './x509-cert';

const PEM_EXTS = new Set(['.pem', '.crt', '.cer']);

export class TrustStore {
  private constructor(readonly certs: ParsedX509[]) {}

  /** 自签证书（信任锚/根） */
  get anchors(): ParsedX509[] {
    return this.certs.filter((c) => c.issuerDn === c.subjectDn);
  }

  /** 非自签证书（中间 CA 等链构建候选） */
  get intermediates(): ParsedX509[] {
    return this.certs.filter((c) => c.issuerDn !== c.subjectDn);
  }

  get isEmpty(): boolean {
    return this.certs.length === 0;
  }

  verifyChain(leaf: ParsedX509, atTime: Date = new Date()): ChainVerifyResult {
    return verifyChain(leaf, this.certs, atTime);
  }

  /** 加载目录（缺失/无证书 → 空库；单个坏文件抛错——信任锚装错应显式失败，不静默跳过） */
  static load(dir: string): TrustStore {
    if (!fs.existsSync(dir)) return new TrustStore([]);
    const certs: ParsedX509[] = [];
    for (const name of fs.readdirSync(dir).sort()) {
      const ext = path.extname(name).toLowerCase();
      const full = path.join(dir, name);
      if (ext === '.der') {
        certs.push(parseCertificate(fs.readFileSync(full)));
        continue;
      }
      if (PEM_EXTS.has(ext)) {
        const pem = fs.readFileSync(full, 'utf8');
        const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
        if (blocks.length === 0) throw new Error(`信任锚文件无证书块：${full}`);
        for (const b of blocks) certs.push(parseCertificate(pemToDer(b)));
      }
    }
    return new TrustStore(certs);
  }
}
