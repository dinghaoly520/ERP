// apps/api/src/supervision-push/platform-signing.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { SignatureService } from '../common/crypto/signature.service';

interface PlatformSigningKeyFile {
  certDn: string;
  publicKey: string;
  privateKey: string;
  alg: string;
  createdAt: string;
}

/**
 * A-153：平台监督推送签名密钥——首次使用生成 SM2 密钥对，私钥落盘
 * apps/api/.data/supervision/platform-signing.json（ADMIN_KEYSTORE_DIR 平行惯例）。
 * ⚠️ 运维：该目录必须纳入备份（丢失 = 历史推送签名不可复现），spec §4.4。
 */
@Injectable()
export class PlatformSigningService {
  private readonly logger = new Logger(PlatformSigningService.name);
  private keyFile: PlatformSigningKeyFile | null = null;

  constructor(private readonly signature: SignatureService) {}

  private get keyPath(): string {
    const dir = process.env.SUPERVISION_KEYSTORE_DIR || path.resolve(process.cwd(), '.data/supervision');
    return path.join(dir, 'platform-signing.json');
  }

  /** 幂等加载/生成；公钥信息供公共服务平台侧注册验签 */
  ensureKey(): { certDn: string; publicKey: string; alg: string } {
    if (!this.keyFile) {
      if (fs.existsSync(this.keyPath)) {
        this.keyFile = JSON.parse(fs.readFileSync(this.keyPath, 'utf8')) as PlatformSigningKeyFile;
      } else {
        const kp = this.signature.generateKeyPair();
        this.keyFile = {
          certDn: 'CN=蜀水云采监督推送签名, O=四川水发集团, C=CN',
          publicKey: kp.publicKey,
          privateKey: kp.privateKey,
          alg: 'SM2',
          createdAt: new Date().toISOString(),
        };
        fs.mkdirSync(path.dirname(this.keyPath), { recursive: true });
        fs.writeFileSync(this.keyPath, JSON.stringify(this.keyFile, null, 2), { mode: 0o600 });
        this.logger.log(`平台监督推送签名密钥已生成：${this.keyPath}`);
      }
    }
    const { certDn, publicKey, alg } = this.keyFile;
    return { certDn, publicKey, alg };
  }

  /** 对信封指纹签名（私钥不出内存） */
  signFingerprint(fingerprint: string): { algorithm: string; value: string; certDn: string; publicKey: string } {
    const meta = this.ensureKey();
    const value = this.signature.sign(fingerprint, this.keyFile!.privateKey);
    return { algorithm: 'SM2/SM3', value, certDn: meta.certDn, publicKey: meta.publicKey };
  }
}
