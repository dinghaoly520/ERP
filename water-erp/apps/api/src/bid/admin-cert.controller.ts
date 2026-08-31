import { Controller, Get, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminKeyService } from '../common/crypto/admin-keystore.service';

/* =================================================================
   管理方加密证书端点（双信封 v2 外层 K_admin 的公钥分发 + 轮转）

   - GET  /api/bid/admin-cert         当前 active 证书（无则 null）
     —— 管理端（:3005 系统管理·加密管理页）查看用。
     供应商门户取公钥走 supplier-portal 侧端点（@Roles('supplier')），不经此处。
   - POST /api/bid/admin-cert/generate 轮转：生成新证书置 active、旧证全部
     inactive（旧私钥文件保留，可解历史信封）。

   2026-08-28 收口：证书是平台级加密基础设施（全局单证、不分项目），读与轮转
   均 admin 独有——bid_host 原读权限随 :3007 只读视图下线已无消费方，一并收紧。
   ================================================================= */

@ApiTags('开评标管理·管理方加密证书')
@ApiCookieAuth('token')
@Roles('admin')
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
