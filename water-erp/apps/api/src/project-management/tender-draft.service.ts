import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  CreateTenderDraftVersionDto,
  SaveTenderDraftDto,
} from './dto/tender-draft.dto';

/**
 * 采购文件编写·项目草稿跨设备同步（2026-09-09）。
 *
 * 背景：草稿此前仅存浏览器 localStorage（tender-write:project-drafts:v1:<projectId>），
 * 按设备隔离——换一台电脑登录同账号看不到另一台写的内容。现在服务器为准
 * （每项目一行 ProjectTenderDraft，last-write-wins），localStorage 降级为离线缓存；
 * 「保存当前」的历史版本进 ProjectTenderDraftVersion（每项目保留最近 20 条）。
 *
 * 越权由控制器类级 PmiOwnershipGuard 统一拦截（非创建人 403、admin 全量）。
 */
@Injectable()
export class TenderDraftService {
  private static readonly MAX_VERSIONS = 20;

  constructor(private readonly prisma: PrismaService) {}

  /** 读取当前草稿；无记录返回 null（前端回落 localStorage 并回传完成首次上云迁移）。 */
  async getDraft(projectId: string) {
    const item = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('项目不存在');

    const draft = await this.prisma.projectTenderDraft.findUnique({
      where: { projectId },
    });
    if (!draft) return null;
    return {
      drafts: draft.drafts as Record<string, unknown>,
      updatedAt: draft.updatedAt,
      updatedById: draft.updatedById,
    };
  }

  /** 保存（upsert）当前草稿——编辑期前端 debounce 推送，同一账号多设备 last-write-wins。 */
  async saveDraft(projectId: string, dto: SaveTenderDraftDto, user: AuthenticatedUser | undefined) {
    await this.assertProjectExists(projectId);

    return this.prisma.projectTenderDraft.upsert({
      where: { projectId },
      update: { drafts: dto.drafts as Prisma.InputJsonValue, updatedById: user?.sub ?? null },
      create: {
        projectId,
        drafts: dto.drafts as Prisma.InputJsonValue,
        createdById: user?.sub ?? null,
        updatedById: user?.sub ?? null,
      },
      select: { projectId: true, updatedAt: true },
    });
  }

  /** 一键清除：删除当前草稿与全部历史版本（前端随即写入空草稿）。 */
  async clearDraft(projectId: string) {
    await this.assertProjectExists(projectId);
    await this.prisma.$transaction([
      this.prisma.projectTenderDraftVersion.deleteMany({ where: { projectId } }),
      this.prisma.projectTenderDraft.deleteMany({ where: { projectId } }),
    ]);
    return { cleared: true };
  }

  /** 历史版本列表（新→旧，含草稿全文供恢复）。 */
  async listVersions(projectId: string) {
    await this.assertProjectExists(projectId);
    const versions = await this.prisma.projectTenderDraftVersion.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: TenderDraftService.MAX_VERSIONS,
    });
    return versions.map((v) => ({
      id: v.id,
      label: v.label,
      timestamp: v.createdAt,
      drafts: v.drafts as Record<string, unknown>,
    }));
  }

  /** 新增一个历史版本并裁剪到上限。 */
  async addVersion(projectId: string, dto: CreateTenderDraftVersionDto) {
    await this.assertProjectExists(projectId);
    const now = new Date();
    const label =
      dto.label?.trim() ||
      `${now.toLocaleDateString('zh-CN')} ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;

    const created = await this.prisma.projectTenderDraftVersion.create({
      data: {
        projectId,
        label,
        drafts: dto.drafts as Prisma.InputJsonValue,
      },
      select: { id: true, label: true, createdAt: true },
    });

    // 只保留最近 MAX_VERSIONS 条：找出需淘汰的旧版本并删除
    const overflow = await this.prisma.projectTenderDraftVersion.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      skip: TenderDraftService.MAX_VERSIONS,
      select: { id: true },
    });
    if (overflow.length > 0) {
      await this.prisma.projectTenderDraftVersion.deleteMany({
        where: { id: { in: overflow.map((v) => v.id) } },
      });
    }

    return created;
  }

  /** 清空历史版本（保留当前草稿）。 */
  async clearVersions(projectId: string) {
    await this.assertProjectExists(projectId);
    await this.prisma.projectTenderDraftVersion.deleteMany({ where: { projectId } });
    return { cleared: true };
  }

  private async assertProjectExists(projectId: string) {
    const item = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('项目不存在');
  }
}
