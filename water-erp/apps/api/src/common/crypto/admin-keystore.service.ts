import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';

/* =================================================================
   AdminKeyService — 管理方加密证书 keystore（双信封 v2 外层 K_admin 持有方）

   - generate()：SM2 密钥对 → 事务内先 updateMany 旧 active→false 再 create
     新行（active:true）→ 私钥落盘 ADMIN_KEYSTORE_DIR/<cert.id>（0600）。
     公钥只入库、私钥只落盘；旧证行保留（active=false）且私钥文件不动，
     轮转后仍可按 id 读旧私钥解历史信封。
   - bootstrap：BidModule onModuleInit 调 ensureBootstrap()，无 active 证书时
     自动生成并 logger.warn（幂等——已有 active 不重复生成）。
   ================================================================= */

const sm2 = require('sm-crypto').sm2;

export const ADMIN_CERT_DN = 'CN=蜀水云采-管理方加密证书';

/**
 * 私钥目录：env ADMIN_KEYSTORE_DIR 优先；默认 <api 包根>/.data/admin-keystore。
 * 本文件位于 <api>/{src|dist}/common/crypto（src 与 dist 同深度），
 * ../../../ 恒回到 <api> 包根——与 .gitignore 的 apps/api/.data/ 对齐，勿改成 ../../。
 */
function keystoreDir(): string {
  return process.env.ADMIN_KEYSTORE_DIR ?? path.join(__dirname, '../../../.data/admin-keystore');
}

@Injectable()
export class AdminKeyService {
  private readonly logger = new Logger(AdminKeyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 当前 active 证书（无则 null）。返回类型由 Prisma delegate 推断。 */
  getActiveCert() {
    return this.prisma.adminEncryptionCert.findFirst({ where: { active: true } });
  }

  /**
   * 生成新证书并置 active（轮转）：事务内旧 active 全部置 false → create 新行；
   * 出事务后私钥写 keystore 文件（0600）。
   */
  async generate() {
    const kp = sm2.generateKeyPairHex();
    const cert = await this.prisma.$transaction(async (tx) => {
      await tx.adminEncryptionCert.updateMany({ where: { active: true }, data: { active: false } });
      return tx.adminEncryptionCert.create({
        data: { publicKey: kp.publicKey, certDn: ADMIN_CERT_DN, active: true },
      });
    });
    const dir = keystoreDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, cert.id);
    try {
      fs.writeFileSync(file, kp.privateKey, { mode: 0o600 });
      fs.chmodSync(file, 0o600); // 既有文件重写时也强制收口（umask 之外再兜一层）
    } catch (e) {
      // 写盘失败（ENOSPC/EACCES）→ 回滚该行 active:false，避免库内 active 证书只有公钥无私钥
      // 且 ensureBootstrap 不自愈（active 存在即跳过）。原样 rethrow 让调用方感知生成失败。
      await this.prisma.adminEncryptionCert.updateMany({ where: { id: cert.id }, data: { active: false } });
      throw e;
    }
    return cert;
  }

  /**
   * 按 cert.id 读私钥（hex）。文件不存在（未 bootstrap/已清理/轮转归档清理）抛错。
   * id 含路径片段时按不存在处理，拒绝目录穿越（id 来自库内 cuid，正常不含）。
   */
  async readPrivateKey(adminCertId: string): Promise<string> {
    if (!adminCertId || /[/\\]|\.\./.test(adminCertId)) {
      throw new Error('管理方私钥不存在: ' + adminCertId);
    }
    const file = path.join(keystoreDir(), adminCertId);
    if (!fs.existsSync(file)) throw new Error('管理方私钥不存在: ' + adminCertId);
    return fs.readFileSync(file, 'utf8');
  }

  /** 无 active 证书时自动生成（幂等）。 */
  async ensureBootstrap(): Promise<void> {
    const active = await this.getActiveCert();
    if (active) return;
    this.logger.warn('未发现 active 管理方加密证书——自动生成 bootstrap 证书（CN=蜀水云采-管理方加密证书）');
    await this.generate();
  }
}
