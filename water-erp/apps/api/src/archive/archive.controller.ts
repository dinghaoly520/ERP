import {
  Body, Controller, Get, Param, Patch, Post, Query, Res, BadRequestException, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ArchiveScopeService } from './archive-scope.service';
import { ArchiveCheckService } from './archive-check.service';
import { ArchiveExportService } from './archive-export.service';
import { ArchiveFlowService } from './archive-flow.service';

/**
 * 归档管理（DA/T 103-2024）：范围勾稽 / 四性检测 / ASIP 导出 / 卷台账。
 * 角色：:3005 采购中心（staff 可质检，leader/admin 可导出）。
 */
@ApiTags('归档管理')
@Controller('archive')
@Roles('admin', 'leader', 'staff')
export class ArchiveController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly scope: ArchiveScopeService,
    private readonly check: ArchiveCheckService,
    private readonly exporter: ArchiveExportService,
    private readonly flow: ArchiveFlowService,
  ) {}

  @Get('scope-items')
  @ApiOperation({ summary: '归档范围表（附录B 全量）' })
  async scopeItems() {
    await this.scope.ensureSeeded();
    return this.prisma.archiveScopeItem.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  /** 卷列表（A.2e 组合查询：状态/类型/时间） */
  @Get('items')
  @ApiOperation({ summary: '归档卷台账（PMI 一卷）' })
  async items(
    @Query('exported') exported?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.prisma.projectManagementItem.findMany({
      where: {
        ...(exported === 'yes' ? { archiveExportedAt: { not: null } } : {}),
        ...(exported === 'no' ? { archiveExportedAt: null } : {}),
        ...(status ? { status: status as never } : {}),
        ...(search ? { title: { contains: search } } : {}),
      },
      select: {
        id: true, title: true, projectCode: true, currentStage: true, status: true,
        requesterDepartment: true, awardedSupplier: true, createdAt: true,
        retentionPeriod: true, archiveExportedAt: true, archiveRegistrationKey: true,
        stages: { select: { stageKey: true, status: true, attachments: { select: { id: true } } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
  }

  @Get('items/:pmiId/snapshot')
  @ApiOperation({ summary: '归档范围勾稽快照（35 项逐项比对 + 元数据捕获）' })
  async snapshot(@Param('pmiId') pmiId: string) {
    return this.scope.snapshot(pmiId, { enrichMeta: true });
  }

  @Post('items/:pmiId/check')
  @ApiOperation({ summary: '运行四性检测（完整性/可用性/安全性）' })
  async runCheck(@Param('pmiId') pmiId: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.check.run(pmiId, user?.sub);
  }

  @Get('items/:pmiId/check-latest')
  @ApiOperation({ summary: '最近一次四性检测结果' })
  async checkLatest(@Param('pmiId') pmiId: string) {
    return this.check.latest(pmiId);
  }

  @Post('items/:pmiId/export-asip')
  @Roles('admin', 'leader')
  @ApiOperation({ summary: '导出归档信息包（ASIP，附录D 结构）' })
  async exportAsip(
    @Param('pmiId') pmiId: string,
    @Body() body: { retentionPeriod?: 'PERMANENT' | 'Y30' | 'Y10' } | undefined,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const result = await this.exporter.exportAsip(pmiId, user?.sub, body?.retentionPeriod);
    await this.flow.resolveArchiveTodo(pmiId);
    return result;
  }

  @Get('items/:pmiId/package')
  @ApiOperation({ summary: '下载已导出的归档信息包' })
  async download(@Param('pmiId') pmiId: string, @Res() res: Response) {
    const { buffer, fileName } = await this.exporter.downloadPackage(pmiId);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(buffer);
  }

  @Patch('items/:pmiId/retention')
  @Roles('admin', 'leader')
  @ApiOperation({ summary: '划定保管期限（§9.3 永久/30年/10年）' })
  async setRetention(@Param('pmiId') pmiId: string, @Body() body: { retentionPeriod: 'PERMANENT' | 'Y30' | 'Y10' }) {
    if (!body?.retentionPeriod || !['PERMANENT', 'Y30', 'Y10'].includes(body.retentionPeriod)) {
      throw new BadRequestException({ error: '保管期限必须是 PERMANENT/Y30/Y10', code: 'INVALID_RETENTION' });
    }
    return this.prisma.projectManagementItem.update({
      where: { id: pmiId },
      data: { retentionPeriod: body.retentionPeriod },
      select: { id: true, retentionPeriod: true },
    });
  }

  @Post('items/:pmiId/unmark')
  @Roles('admin', 'leader')
  @ApiOperation({ summary: '取消文件级已归档标记（A.2d 重新归档）' })
  async unmark(@Param('pmiId') pmiId: string) {
    const r = await this.prisma.archiveMetadata.updateMany({
      where: { attachment: { projectManagementItemId: pmiId }, archivedAt: { not: null } },
      data: { archivedAt: null },
    });
    return { unmarked: r.count };
  }

  // ── S2 归档审计视图（A.1g：归档过程操作跟踪）──
  @Get('items/:pmiId/audit')
  @ApiOperation({ summary: '该卷的归档相关操作日志（快照/检测/导出/登记）' })
  async audit(@Param('pmiId') pmiId: string) {
    return this.prisma.operationLog.findMany({
      where: { path: { contains: `/archive/items/${pmiId}` } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        createdAt: true, username: true, role: true, method: true,
        path: true, statusCode: true, durationMs: true, error: true,
      },
    });
  }

  // ── D3 纸电关联（A.1h）：登记表打印→签章→扫描回传，与 ASIP 包同卷互链 ──
  @Post('items/:pmiId/registration-scan')
  @Roles('admin', 'leader', 'staff')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }))
  @ApiOperation({ summary: '上传移交接收登记表扫描件（双方签章后回传）' })
  async uploadRegistration(
    @Param('pmiId') pmiId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException({ error: '请选择登记表扫描件', code: 'FILE_REQUIRED' });
    const item = await this.prisma.projectManagementItem.findUnique({ where: { id: pmiId }, select: { projectCode: true } });
    if (!item) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    const objectKey = `archive-registration/${pmiId}/${Date.now()}-${file.originalname.replace(/[^\w.\-一-龥]/g, '_')}`;
    await this.storage.upload(objectKey, file.buffer, file.mimetype);
    await this.prisma.projectManagementItem.update({
      where: { id: pmiId },
      data: { archiveRegistrationKey: objectKey },
    });
    return { objectKey, fileName: file.originalname, size: file.size, uploadedBy: user?.username ?? null };
  }

  @Get('items/:pmiId/registration')
  @ApiOperation({ summary: '下载移交接收登记表扫描件' })
  async downloadRegistration(@Param('pmiId') pmiId: string, @Res() res: Response) {
    const item = await this.prisma.projectManagementItem.findUnique({
      where: { id: pmiId },
      select: { archiveRegistrationKey: true, projectCode: true },
    });
    if (!item?.archiveRegistrationKey) {
      throw new BadRequestException({ error: '该项目尚未回传登记表扫描件', code: 'NO_REGISTRATION' });
    }
    const buffer = await this.storage.download(item.archiveRegistrationKey);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`移交接收登记表-${item.projectCode ?? pmiId}`)}`);
    res.send(buffer);
  }
}
