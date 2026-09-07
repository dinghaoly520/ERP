import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

/**
 * §5.5 归因/重置通知（F1d 抽取）——自 bid.service.ts 私有方法提为纯函数
 * （仅 this.prisma/this.notificationService → 前两参，其余逐字）。
 * BidDecryptService（adjudicateDecryptFault）/ BidService（attributePendingDualSuppliers §5.5 惰性归因）
 * 两域共用，勿在单侧内联复制。
 *
 * §5.5 归因/重置通知（fire-and-forget，复用既有站内信通道）：文案按归因分流并告知权利。
 * BIDDER → 视为撤销，保证金依招标文件规定处理；PLATFORM → 视为撤回 + 赔偿请求权（办法第31条）；
 * RESET_PENDING → 重置解密机会提示（T13 硬前置：DANGER 后重试路径）。
 */
export async function notifySupplierDecryptAttribution(
  prisma: PrismaService,
  notificationService: NotificationService,
  supplierId: string,
  supplierName: string,
  projectId: string,
  kind: 'BIDDER' | 'PLATFORM' | 'RESET_PENDING',
) {
  const MESSAGES = {
    BIDDER: { title: '投标文件解密未完成通知', content: '因投标人原因未完成解密，视为撤销投标文件，保证金依招标文件规定处理。' },
    PLATFORM: { title: '投标文件解密未完成通知', content: '因平台原因未完成解密，视为撤回投标文件，你有权要求责任方赔偿直接损失。' },
    RESET_PENDING: { title: '解密机会已重置', content: '开标主持人已重置您的解密机会，请重新解密。' },
  } as const;
  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { userId: true },
    });
    if (supplier?.userId) {
      await notificationService.sendToUser(supplier.userId, ['in_app'], {
        type: 'BID_DECRYPT_ADJUDGED',
        title: `${MESSAGES[kind].title}：${supplierName}`,
        content: MESSAGES[kind].content,
        link: `/my-bids/${projectId}/opening-hall`,
      });
    }
  } catch {
    /* 通知失败不阻塞裁决 */
  }
}
