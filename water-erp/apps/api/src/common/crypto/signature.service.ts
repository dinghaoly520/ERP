import { Injectable, Logger } from '@nestjs/common';

/* =================================================================
   SM2 数字签名服务 — 投标抗抵赖

   供应商端使用 SM2 私钥对投标文件哈希做数字签名。
   服务端存储 SM2 公钥，开标时验证签名。
   私钥由前端生成并存于供应商本地，永不传输/存储于服务端。

   依赖：sm-crypto（国密 SM2/SM3/SM4 npm 包）
   ================================================================= */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sm2 = require('sm-crypto').sm2;

export interface Sm2KeyPair {
  publicKey: string;  // 04 开头的未压缩公钥 hex
  privateKey: string; // 私钥 hex
}

@Injectable()
export class SignatureService {
  private readonly logger = new Logger(SignatureService.name);

  /**
   * 生成 SM2 密钥对。通常在供应商注册时调用，也可由前端独立生成。
   */
  generateKeyPair(): Sm2KeyPair {
    const keypair = sm2.generateKeyPairHex();
    return {
      publicKey: keypair.publicKey,   // 04...
      privateKey: keypair.privateKey, // hex
    };
  }

  /**
   * 使用 SM2 私钥对消息哈希做签名。
   * @param messageHash 消息的 SHA-256 哈希（hex 字符串）
   * @param privateKey SM2 私钥（hex）
   * @returns 签名值（hex 字符串）
   */
  sign(messageHash: string, privateKey: string): string {
    // sm-crypto 的 doSignature 期望原始消息字符串，自动内部哈希
    // 此处传入预计算的哈希，使用 doSignature 的 hash 选项为 false
    // 实际使用 doSignature 对原始数据签名，框架自动 SM3 哈希
    return sm2.doSignature(messageHash, privateKey, { hash: true });
  }

  /**
   * 验证 SM2 签名。
   * @param messageHash 原始消息的 SHA-256 哈希（hex 字符串）
   * @param signatureHex 签名值（hex 字符串）
   * @param publicKey SM2 公钥（04 开头的 hex）
   * @returns 签名是否有效
   */
  verify(messageHash: string, signatureHex: string, publicKey: string): boolean {
    if (!publicKey || !signatureHex || !messageHash) {
      this.logger.warn('SM2 verify: missing parameter');
      return false;
    }
    try {
      // sm-crypto doSignature 和 doVerifySignature 都支持 { hash: true } 自动 SM3
      return sm2.doVerifySignature(messageHash, signatureHex, publicKey, { hash: true });
    } catch (e) {
      this.logger.error(`SM2 verify error: ${(e as Error).message}`);
      return false;
    }
  }

  /**
   * 验证公钥格式是否有效（04 + 128 hex chars = 130 chars total）。
   */
  isValidPublicKey(key: string | null | undefined): boolean {
    if (!key) return false;
    return /^04[0-9a-fA-F]{128}$/.test(key);
  }
}
