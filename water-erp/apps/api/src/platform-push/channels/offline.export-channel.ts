// apps/api/src/platform-push/channels/offline.export-channel.ts
// 离线导出通道（doc §二-3 双出口之「现役」路径）：按 383号文数据项粒度出结构化 JSON 文件包
// +SHA-256（A-153 exportVoucher 三件套泛化：storage.upload → fileAsset.create → 日志由 service
// 统一落，status=EXPORTED）。service 直调创建 FileAsset，不经 HTTP 上传类目白名单。
import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { PushChannelCode } from '../platform-push-payload';
import {
  PushChannel, PushChannelDispatchContext, PushChannelDispatchResult,
} from '../push-channel.interface';

@Injectable()
export class OfflineExportChannel implements PushChannel {
  private readonly logger = new Logger(OfflineExportChannel.name);

  readonly code: PushChannelCode = 'offline';
  readonly title = '离线导出（文件包）';
  readonly connected = true;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async dispatch(ctx: PushChannelDispatchContext): Promise<PushChannelDispatchResult> {
    const ts = Date.now();
    // 文件包 = voucher 同款结构（packageType/packageVersion/内容/日志摘要/exportedBy）
    const logs = await this.prisma.platformPushLog.findMany({
      where: { itemId: ctx.itemId }, orderBy: { createdAt: 'desc' }, take: 10,
    });
    const pkg = {
      packageType: 'PLATFORM_PUSH_PACKAGE',
      packageVersion: 1,
      itemId: ctx.itemId,
      itemType: ctx.itemType,
      title: ctx.title,
      envelope: ctx.envelope,
      pushLogSummary: logs.map((l) => ({
        channel: l.channel, status: l.status, attemptNo: l.attemptNo, createdAt: l.createdAt,
      })),
      exportedAt: new Date().toISOString(),
      exportedBy: ctx.actorId,
    };

    const buffer = Buffer.from(JSON.stringify(pkg, null, 2), 'utf8');
    const objectKey = `platform-push/${ctx.projectId ?? 'global'}/${ctx.itemType}-${ts}.json`;
    await this.storage.upload(objectKey, buffer, 'application/json');
    const asset = await this.prisma.fileAsset.create({
      data: {
        key: objectKey,
        originalName: `平台数据推送包-${ctx.projectCode ?? ctx.itemId}.json`,
        mimeType: 'application/json',
        size: buffer.length,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        category: 'platform_push_package',
        uploaderId: ctx.actorId,
      },
    });
    this.logger.log(`离线导出完成 ${ctx.itemId} → FileAsset ${asset.id}（${objectKey}）`);
    return { ok: true, packetAssetId: asset.id, responseSnippet: objectKey };
  }
}
