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
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';

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

    // 暂存 24h（v3-staging/ 前缀 + createdAt 可计算过期；未投递残留由 MinIO 级清理脚本处理——
    // category=bid_document 受删除端点硬保护，不走删除端点清理）
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);

    // C1（评审修复）：密文真实落 MinIO——开标 decryptOuterOneV3 以 asset.key 读取本对象；
    // 先写对象后落库（DB 失败至多留 v3-staging/ 孤儿对象，前缀可扫）
    const objectKey = `v3-staging/${projectId}/${supplier.id}/${Date.now()}-${outerSha256.slice(0, 8)}.outer`;
    try {
      await minioClient.putObject(MINIO_BUCKET, objectKey, file.buffer, file.buffer.length, {
        'Content-Type': 'application/octet-stream',
      });
    } catch (err) {
      throw new BadRequestException({ error: '密文存储失败，请重试', code: 'STORAGE_FAILED' });
    }

    // 暂存记录落库（key=MinIO 对象键——decryptOuterOneV3 读取锚点）
    const asset = await this.prisma.fileAsset.create({
      data: {
        key: objectKey,
        originalName: file.originalname,
        mimeType: 'application/octet-stream',
        size: outerBytes,
        sha256: outerSha256,
        category: 'bid_document',
        uploaderId: userId,
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
