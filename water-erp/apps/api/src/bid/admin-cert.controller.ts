import { Controller, Get, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminKeyService } from '../common/crypto/admin-keystore.service';

/* =================================================================
   管理方加密证书端点（双信封 v2 外层 K_admin 的公钥分发 + 轮转）

   - GET  /api/bid/admin-cert         当前 active 证书（无则 null）
     —— 供应商门户加密上传前拉取（envelope.adminCertId 对齐 active.id）
   - POST /api/bid/admin-cert/generate 轮转：生成新证书置 active、旧证全部
     inactive（旧私钥文件保留，可解历史信封）。仅 admin。
   ================================================================= */

@ApiTags('开评标管理·管理方加密证书')
@ApiCookieAuth('token')
@Roles('admin', 'bid_host')
@Controller('bid/admin-cert')
export class AdminCertController {
  constructor(private readonly adminKey: AdminKeyService) {}

  @Get()
  @ApiOperation({ summary: '当前 active 管理方加密证书（id/publicKey/certDn/active/createdAt，无则 null）' })
  getActive() {
    return this.adminKey.getActiveCert();
  }

  @Post('generate')
  @Roles('admin')
  @ApiOperation({ summary: '生成新管理方加密证书并置 active（旧证全部转 inactive，历史信封仍可解）' })
  generate() {
    return this.adminKey.generate();
  }
}
