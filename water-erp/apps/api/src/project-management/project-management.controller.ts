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
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CompleteProjectDto } from './dto/complete-project.dto';
import { CreateProjectFromInitiationDto } from './dto/create-project-from-initiation.dto';
import { QueryProjectManagementDto } from './dto/query-project-management.dto';
import { UpdateExtractedInfoDto } from './dto/update-extracted-info.dto';
import { UpdateProjectStageDto } from './dto/update-project-stage.dto';
import { ProjectManagementService } from './project-management.service';

@UseGuards(AuthGuard)
@Controller('project-management')
export class ProjectManagementController {
  constructor(
    private readonly projectManagementService: ProjectManagementService,
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
  create(@Body() dto: CreateProjectFromInitiationDto) {
    return this.projectManagementService.createFromInitiation(dto);
  }

  @Post('ai-identify-field')
  aiIdentifyField(@Body() dto: { fieldName: string; documentText: string; topK?: number }) {
    return this.projectManagementService.aiIdentifyField(dto);
  }

  @Post('analyze-budget-reference')
  analyzeBudgetReference(@Body() dto: { procurementTitle: string; procurementCategory?: string; projectReason?: string; supplierRequirements?: string }) {
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
  ) {
    return this.projectManagementService.analyzeProject(id, stageKey);
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
}
