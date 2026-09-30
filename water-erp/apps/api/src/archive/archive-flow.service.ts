import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

/** 归档待办闭环：流程终结（中标通知书/合同上传）→ 通知归档责任人 → 导出完成后自动消（resolvedAt） */
export const ARCHIVE_TODO_TYPE = 'ARCHIVE_READY';

@Injectable()
export class ArchiveFlowService {
  private readonly logger = new Logger(ArchiveFlowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notification: NotificationService,
  ) {}

  /** 流程终结判定 + 通知（幂等：已有未消待办则跳过） */
  async onTerminalAttachmentUploaded(pmiId: string): Promise<void> {
    try {
      const item = await this.prisma.projectManagementItem.findUnique({
        where: { id: pmiId },
        select: {
          title: true, projectCode: true, id: true,
          archiveExportedAt: true,
          stages: { where: { stageKey: { in: ['AWARD_DECISION', 'CONTRACT'] } }, select: { stageKey: true, attachments: { select: { id: true } } } },
        },
      });
      if (!item || item.archiveExportedAt) return; // 已导出过，无需待办

      // 终结节点（§8.1）：定标（中标通知书）或合同 阶段已有件
      const terminal = item.stages.some((s) => s.attachments.length > 0);
      if (!terminal) return;

      const link = `/procurements?archivePmi=${pmiId}`; // 2026-09-30：归档页并入台账卡片（/archive 仅留重定向）
      // 幂等含旧链接存量（改链前生成的 pending），否则每个临期项目会重复插一条
      const pending = await this.prisma.notification.count({
        where: { type: ARCHIVE_TODO_TYPE, link: { in: [link, `/archive?pmi=${pmiId}`] }, resolvedAt: null },
      });
      if (pending > 0) return; // 幂等

      const dto = {
        type: ARCHIVE_TODO_TYPE,
        title: '项目流程终结，待归档',
        content: `「${item.title}」已到定标/合同节点（DA/T 103-2024 §8.1），请前往采购台账该项目卡片完成四性检测并导出归档信息包。`,
        link,
      };
      await this.notification.sendToRole('leader', dto); // 2026-09-26：业务通知不进 admin（admin 只收账号域）
    } catch (err) {
      this.logger.warn(`归档待派发失败（不阻塞上传）: ${err}`);
    }
  }

  /** 归档导出完成 → 消解该项目全部归档待办（H3：含 D2 临期/逾期督办，否则已归档项目通知永挂） */
  async resolveArchiveTodo(pmiId: string): Promise<void> {
    // 兼容一个迁移周期：历史 pending 通知的 link 仍是 /archive?pmi=（改链前生成），新旧都消解
    const links = [`/procurements?archivePmi=${pmiId}`, `/archive?pmi=${pmiId}`];
    try {
      for (const link of links) {
        await this.notification.resolveActionable(ARCHIVE_TODO_TYPE, link);
        await this.notification.resolveActionable('ARCHIVE_TRANSFER_DUE', link);
        await this.notification.resolveActionable('ARCHIVE_OVERDUE', link);
      }
    } catch (err) {
      this.logger.warn(`归档待办消解失败: ${err}`);
    }
  }
}
