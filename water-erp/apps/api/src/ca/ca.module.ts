/* =================================================================
   CaModule — SCCA CA 证书认证模块（NestJS 注册）
   ================================================================= */
import { Module } from '@nestjs/common';
import { SccaGatewayClient } from './scca-gateway.client';
import { CaVerificationService } from './ca-verification.service';
import { CaChallengeService } from './ca-challenge.service';
import { CaEvidenceService } from './ca-evidence.service';
import { CaOperationService } from './ca-operation.service';
import { CaAuthController } from './ca-auth.controller';
import { CaBindingController } from './ca-binding.controller';
import { CaBidOperationController } from './ca-bid-operation.controller';
import { EncryptedAssetController } from './encrypted-asset.controller';
import { CaEligibilityService } from './ca-eligibility.service';
import { AuthModule } from '../auth/auth.module';
import { JwtModule } from '@nestjs/jwt';
import { getJwtSecret } from '../common/jwt-secret.helper';
import { TrustStore } from '../common/crypto/x509/trust-store';
import * as fs from 'fs';
import * as path from 'path';

export interface CaEnvConfig {
  SCCA_GATEWAY_BASE_URL: string;
  SCCA_APP_ID: string;
  SCCA_APP_SECRET: string;
  TRUSTED_CA_DIR?: string;
  CA_LOGIN_ENABLED: boolean;
  CA_BINDING_ENABLED: boolean;
  CA_PILOT_SUBJECT_IDS: string[];
  CA_LEGACY_WRITE_ENABLED: boolean;
}

export function loadCaConfig(): CaEnvConfig {
  // 生产启动守卫（同 getJwtSecret 先例）：CA 登录开启但未配 Origin 白名单 → 拒绝启动。
  // 公网 origin 不在 dev 默认段（localhost/192.168）内，未配置=CA 登录对所有公网用户 403，
  // 宜启动期报错而非线上排障。2026-10-14 与 assertAllowedOrigin 生产 fail-closed 配套。
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.CA_LOGIN_ENABLED === 'true' &&
    !(process.env.CA_ALLOWED_ORIGINS ?? '').trim()
  ) {
    throw new Error(
      '生产环境 CA_LOGIN_ENABLED=true 时必须配置 CA_ALLOWED_ORIGINS（如 https://supplier.example.com，逗号分隔），' +
        '否则 CA 登录对公网用户全部 403。dev 默认放行段（localhost/192.168）不适用于生产。',
    );
  }
  const caDir = process.env.TRUSTED_CA_DIR ?? path.join(process.cwd(), '.data', 'trusted-ca');
  return {
    SCCA_GATEWAY_BASE_URL: process.env.SCCA_GATEWAY_BASE_URL ?? '',
    SCCA_APP_ID: process.env.SCCA_APP_ID ?? '',
    SCCA_APP_SECRET: process.env.SCCA_APP_SECRET ?? '',
    TRUSTED_CA_DIR: caDir,
    CA_LOGIN_ENABLED: process.env.CA_LOGIN_ENABLED === 'true',
    CA_BINDING_ENABLED: process.env.CA_BINDING_ENABLED === 'true',
    CA_PILOT_SUBJECT_IDS: (process.env.CA_PILOT_SUBJECT_IDS ?? '').split(',').filter(Boolean),
    CA_LEGACY_WRITE_ENABLED: process.env.CA_LEGACY_WRITE_ENABLED === 'true' || process.env.NODE_ENV !== 'production',
  };
}

@Module({
  imports: [AuthModule, JwtModule.register({ secret: getJwtSecret(), signOptions: { expiresIn: '7d' } })],
  controllers: [CaAuthController, CaBindingController, CaBidOperationController, EncryptedAssetController],
  providers: [
    {
      provide: SccaGatewayClient,
      useFactory: () => {
        const cfg = loadCaConfig();
        return new SccaGatewayClient({
          baseUrl: cfg.SCCA_GATEWAY_BASE_URL,
          appId: cfg.SCCA_APP_ID,
          appSecret: cfg.SCCA_APP_SECRET,
          timeoutMs: 15000,
        });
      },
    },
    {
      provide: 'TRUST_STORE',
      useFactory: () => {
        const cfg = loadCaConfig();
        const certs: Buffer[] = [];
        if (cfg.TRUSTED_CA_DIR && fs.existsSync(cfg.TRUSTED_CA_DIR)) {
          for (const f of fs.readdirSync(cfg.TRUSTED_CA_DIR)) {
            if (f.endsWith('.crt') || f.endsWith('.pem') || f.endsWith('.der')) {
              certs.push(fs.readFileSync(path.join(cfg.TRUSTED_CA_DIR, f)));
            }
          }
        }
        return TrustStore.load(cfg.TRUSTED_CA_DIR!);
      },
    },
    {
      provide: CaVerificationService,
      useFactory: (gw: SccaGatewayClient, ts: TrustStore) => new CaVerificationService(gw, ts as any),
      inject: [SccaGatewayClient, 'TRUST_STORE'],
    },
    CaChallengeService,
    CaEvidenceService,
    CaOperationService,
    CaEligibilityService,
  ],
  exports: [CaVerificationService, CaChallengeService, CaEvidenceService, CaOperationService,
    CaEligibilityService, SccaGatewayClient],
})
export class CaModule {}
