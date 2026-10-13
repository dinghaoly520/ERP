/* =================================================================
   encrypted-asset.controller — dual-v3 投标密文暂存端点
   阶段2 Task5（附录 §5.B）

   POST /supplier-portal/bid-submissions/:projectId/encrypted-assets
   Multer 单文件（C_outer 密文）→ 服务端实算 outerSha256 → 24h 暂存落库
   ================================================================= */
import { Controller, Post, Param, Req, UploadedFile, UseInterceptors, HttpCode, HttpStatus, BadRequestException, ForbiddenException, PayloadTooLargeException, Injectable, Optional } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../common/decorators/roles.decorator';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const MAX_OUTER_BYTES = 50 * 1024 * 1024 + 32; // 50MiB + 32B（两层 CBC padding）

@ApiTags('CA 投标密文暂存')
@Controller('supplier-portal/bid-submissions/:projectId/encrypted-assets')
export class EncryptedAssetController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @Roles('supplier')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_OUTER_BYTES, files: 1 } }))
  @ApiOperation({ summary: 'dual-v3 密文暂存——服务端实算哈希+24h 过期' })
  async uploadEncryptedAsset(
    @Param('projectId') projectId: string,
    @Req() req: Request,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException({ error: '缺少密文文件', code: 'NO_FILE' });

    const userId = (req as any).user?.sub;
    const supplier = await this.prisma.supplier.findUnique({ where: { userId } });
    if (!supplier) throw new ForbiddenException({ error: '供应商不存在', code: 'SUPPLIER_NOT_FOUND' });

    const outerSha256 = createHash('sha256').update(file.buffer).digest('hex');
    const outerBytes = file.buffer.length;
    if (outerBytes > MAX_OUTER_BYTES) {
      throw new PayloadTooLargeException({ error: `密文超限（${outerBytes}B > ${MAX_OUTER_BYTES}B）`, code: 'OUTER_TOO_LARGE' });
    }

    // 暂存 24h——由 scheduler 清理过期对象
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);

    // 写入暂存记录——此处简化为 FileAsset 落库（category 标识为投标密文暂存）
    const asset = await this.prisma.fileAsset.create({
      data: {
        key: `v3-staging/${projectId}/${supplier.id}/${Date.now()}-${outerSha256.slice(0, 8)}.outer`,
        displayName: file.originalname,
        mimeType: 'application/octet-stream',
        size: outerBytes,
        sha256: outerSha256,
        category: 'bid_document',
        uploadedById: userId,
        metadata: { format: 'dual-v3-outer', staging: true, expiresAt: expiresAt.toISOString() },
      } as any,
    });

    return {
      fileAssetId: asset.id,
      outerSha256,
      outerBytes,
      expiresAt: expiresAt.toISOString(),
    };
  }
}
