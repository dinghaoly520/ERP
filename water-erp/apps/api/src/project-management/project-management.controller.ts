import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AnalyzeBudgetReferenceDto } from './dto/analyze-budget-reference.dto';
import { CompleteProjectDto } from './dto/complete-project.dto';
import { CreateProjectFromInitiationDto } from './dto/create-project-from-initiation.dto';
import { QueryProjectManagementDto } from './dto/query-project-management.dto';
import { UpdateExtractedInfoDto } from './dto/update-extracted-info.dto';
import { UpdateProjectStageDto } from './dto/update-project-stage.dto';
import { ProjectManagementService } from './project-management.service';
import { Roles } from '../common/decorators/roles.decorator';
import { UseGuards } from '@nestjs/common';
import { CompanyScopeService } from '../company/company-scope';
import { PmiOwnershipGuard } from './pmi-ownership.guard';

@Roles('leader', 'admin', 'staff')
@UseGuards(PmiOwnershipGuard) // 个人隔离：:id 端点仅创建人（admin 全量）可访问
@Controller('project-management')
export class ProjectManagementController {
  constructor(
    private readonly projectManagementService: ProjectManagementService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  @Get()
  list(
    @Query() query: QueryProjectManagementDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.projectManagementService.list(query, user);
  }

  @Get('project-attributions')
  getProjectAttributions() {
    return this.projectManagementService.getProjectAttributions();
  }

  @Post('extract-initiation')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 500 * 1024 * 1024 },
    }),
  )
  async extractInitiation(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('请上传立项 PDF 文件。');
    }

    return this.projectManagementService.extractInitiationFromUploadedFile(
      file,
      user?.sub,
    );
  }

  @Post('extract-demand')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 500 * 1024 * 1024 },
    }),
  )
  async extractDemand(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('请上传采购需求表 PDF 文件。');
    }

    return this.projectManagementService.extractDemandFromUploadedFile(
      file,
      user?.sub,
    );
  }

  @Post()
  async create(
    @Body() dto: CreateProjectFromInitiationDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    // 公司归属从登录人后端取（写时快照），不信任前端传入
    const stamp = await this.companyScope.stampFor(user);
    return this.projectManagementService.createFromInitiation(dto, stamp);
  }

  @Post('ai-identify-field')
  aiIdentifyField(@Body() dto: { fieldName: string; documentText: string; topK?: number }) {
    return this.projectManagementService.aiIdentifyField(dto);
  }

  @Post('analyze-budget-reference')
  analyzeBudgetReference(@Body() dto: AnalyzeBudgetReferenceDto) {
    return this.projectManagementService.analyzeBudgetReference(dto);
  }

  @Patch(':id/stages/:stageKey')
  updateStage(
    @Param('id') id: string,
    @Param('stageKey') stageKey: string,
    @Body() dto: UpdateProjectStageDto,
  ) {
    return this.projectManagementService.updateStage(id, stageKey, dto);
  }

  @Post(':id/stages/:stageKey/attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 500 * 1024 * 1024 },
    }),
  )
  uploadStageAttachment(
    @Param('id') id: string,
    @Param('stageKey') stageKey: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('请上传阶段文件。');
    }

    return this.projectManagementService.addStageAttachment(
      id,
      stageKey,
      file,
      user?.sub,
    );
  }

  @Post(':id/analyze')
  analyzeProject(
    @Param('id') id: string,
    @Query('stageKey') stageKey?: string,
    @Query('refresh') refresh?: string,
  ) {
    return this.projectManagementService.analyzeProject(id, stageKey, refresh === 'true');
  }

  @Post(':id/analyze-step')
  analyzeStep(
    @Param('id') id: string,
    @Query('stageKey') stageKey: string,
    @Query('refresh') refresh?: string,
  ) {
    return this.projectManagementService.analyzeStep(id, stageKey, refresh === 'true');
  }

  @Post(':id/parse-announcement-fields')
  parseAnnouncementFields(@Param('id') id: string) {
    return this.projectManagementService.parseAnnouncementFields(id);
  }

  /** 开标确认：获取（必要时创建）指定轮次的 BidProject */
  @Get(':id/bid-project')
  getBidProject(@Param('id') id: string, @Query('round') round?: string) {
    const roundNum = round != null && round !== '' ? Number(round) : undefined;
    return this.projectManagementService.ensureBidProject(id, Number.isNaN(roundNum as number) ? undefined : roundNum);
  }

  /** 流标后再次采购：按采购方式在定标后插入新一轮"采购文件→定标"阶段 */
  @Post(':id/extract-tender-fields')
  extractTenderFields(@Param('id') id: string, @Query('field') field?: string) {
    return this.projectManagementService.extractTenderFields(id, field);
  }

  /** 直接采购：读取项目各阶段文档，AI 推荐 3-5 家供应商供用户选择 */
  @Post(':id/recommend-suppliers')
  recommendSuppliersForProject(@Param('id') id: string) {
    return this.projectManagementService.recommendSuppliersForProject(id);
  }

  @Post(':id/optimize-initiation')
  optimizeInitiation(@Param('id') id: string) {
    return this.projectManagementService.optimizeInitiationFields(id);
  }

  @Post(':id/reproc')
  reproc(@Param('id') id: string) {
    return this.projectManagementService.reproc(id);
  }

  @Get('archive/:procurementRoundId')
  getArchiveDetail(@Param('procurementRoundId') procurementRoundId: string) {
    return this.projectManagementService.getArchiveDetail(procurementRoundId);
  }

  @Get('archive-file/:procurementRoundId/:stageKey/:fileIndex')
  async getArchiveFile(
    @Param('procurementRoundId') procurementRoundId: string,
    @Param('stageKey') stageKey: string,
    @Param('fileIndex') fileIndex: string,
    @Res() res: Response,
  ) {
    return this.projectManagementService.serveArchiveFile(
      procurementRoundId,
      stageKey,
      parseInt(fileIndex, 10),
      res,
    );
  }

  @Get(':id/summary')
  getProjectSummary(@Param('id') id: string) {
    return this.projectManagementService.getProjectSummary(id);
  }

  @Post(':id/refresh-summary')
  refreshProjectSummary(@Param('id') id: string) {
    return this.projectManagementService.refreshProjectAnalysis(id);
  }

  @Post(':id/audit-compliance')
  auditStageCompliance(
    @Param('id') id: string,
    @Query('stageKey') stageKey?: string,
    @Query('force') force?: string,
  ) {
    return this.projectManagementService.auditStageCompliance(id, stageKey, force === 'true');
  }

  @Post(':id/recycle')
  moveToRecycleBin(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.projectManagementService.moveToRecycleBin(id, user);
  }

  @Post(':id/restore')
  restoreFromRecycleBin(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.projectManagementService.restoreFromRecycleBin(id, user);
  }

  @Delete(':id')
  deletePermanently(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.projectManagementService.deletePermanently(id, user);
  }

  @Post(':id/complete')
  complete(
    @Param('id') id: string,
    @Body() dto: CompleteProjectDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.projectManagementService.completeProject(id, dto, user?.sub);
  }

  @Delete(':id/attachments/:attachmentId')
  deleteAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.projectManagementService.deleteAttachment(id, attachmentId);
  }

  @Patch(':id/extracted-info')
  updateExtractedInfo(
    @Param('id') id: string,
    @Body() dto: UpdateExtractedInfoDto,
  ) {
    return this.projectManagementService.updateExtractedInfo(id, dto);
  }

  /** 直接返回附件原始文件（供 iframe 查看模式展示 Word 文档） */
  @Get(':id/attachment-file/:attachmentId')
  async serveAttachmentFile(
    @Param('id') _id: string,
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
  ) {
    const data = await this.projectManagementService.getAttachmentFile(attachmentId);
    res.setHeader('Content-Type', data.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(data.fileName)}"`);
    res.send(data.buffer);
  }

  /** 获取 DOCX 附件中的段落列表（分段落结构化展示） */
  @Get(':id/attachment-paragraphs/:attachmentId')
  getAttachmentParagraphs(
    @Param('id') _id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.projectManagementService.getAttachmentParagraphs(attachmentId);
  }

  /** AI 辅助修改选中段落文本 */
  @Post(':id/attachment-ai-polish')
  aiPolishAttachmentSelection(
    @Param('id') projectId: string,
    @Body() dto: { text: string; instruction: string },
  ) {
    return this.projectManagementService.aiPolishAttachmentSelection(projectId, dto);
  }

  /** 保存修改后的段落并替换原文件（保留 Word 格式） */
  @Post(':id/save-paragraphs')
  saveAttachmentParagraphs(
    @Param('id') projectId: string,
    @Body() dto: { attachmentId: string; paragraphs: Array<{ index: number; text: string; rawRange?: { from: number; to: number } }> },
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.projectManagementService.saveAttachmentParagraphs(
      projectId,
      dto,
      user?.sub,
    );
  }

  /** 获取 DOCX 附件的完整 HTML（mammoth 转换，图片 base64 内嵌），用于全文档预览编辑。 */
  @Get(':id/attachment-html/:attachmentId')
  getAttachmentHtml(
    @Param('id') _id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.projectManagementService.getAttachmentHtml(attachmentId);
  }

  /** 将编辑后的 HTML 转回 DOCX 并保存替换原附件（patcher 路径需带 originalHash）。 */
  @Post(':id/save-attachment-html')
  saveAttachmentHtml(
    @Param('id') projectId: string,
    @Body() dto: { attachmentId: string; html: string; originalHash?: string },
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.projectManagementService.saveAttachmentHtml(
      projectId,
      dto,
      user?.sub,
    );
  }

  /** 列出某附件的历史版本（patcher 保存前的旧版本归档）。 */
  @Get(':id/attachment/:attachmentId/versions')
  listAttachmentVersions(@Param('attachmentId') attachmentId: string) {
    return this.projectManagementService.listAttachmentVersions(attachmentId);
  }

  /** 导入审阅版 DOCX，返回带标注的 HTML 用于双屏对比。 */
  @Post(':id/import-review-file')
  @UseInterceptors(FileInterceptor('file'))
  importReviewFile(
    @Param('id') _projectId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('请选择要导入的审阅文件');
    return this.projectManagementService.importReviewFile(file);
  }

  /** 获取项目附件中文件的纯文本内容，供编辑修改使用 */
  @Get(':id/attachment-text/:attachmentId')
  getAttachmentTextForEditing(
    @Param('id') _id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.projectManagementService.getAttachmentTextContent(attachmentId);
  }

  /** 用修改后的文本替换附件中的文件内容 */
  @Post(':id/replace-attachment-text')
  replaceAttachmentText(
    @Param('id') projectId: string,
    @Body() dto: { attachmentId: string; text: string; fileName: string },
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.projectManagementService.replaceAttachmentWithText(
      projectId,
      dto.attachmentId,
      dto.text,
      dto.fileName,
      user?.sub,
    );
  }
}
