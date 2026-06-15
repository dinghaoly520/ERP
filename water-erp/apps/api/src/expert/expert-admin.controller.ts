import { Controller, Get, Post, Patch, Body, Param, Query, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { ExpertAdminService } from './expert-admin.service';
import { CreateExpertDto } from './dto/create-expert.dto';
import { ExtractPreviewDto } from './dto/extract-preview.dto';
import { ConfirmExtractionDto } from './dto/confirm-extraction.dto';
import { CreateExpertEvaluationDto } from './dto/create-expert-evaluation.dto';

@ApiTags('专家管理')
@ApiCookieAuth('token')
@Controller('expert-admin')

@Roles('admin', 'bid_host', 'procurement_staff')
export class ExpertAdminController {
  constructor(private expertAdminService: ExpertAdminService) {}

  @Get()
  @ApiOperation({ summary: '专家库列表' })
  listExperts(@Query('search') search?: string, @Query('specialty') specialty?: string) {
    return this.expertAdminService.listExperts(search, specialty);
  }

  @Get('specialties')
  @ApiOperation({ summary: '专家专业列表（去重）' })
  listSpecialties() {
    return this.expertAdminService.listSpecialties();
  }

  @Get('evaluations/stats')
  @ApiOperation({ summary: '专家评价统计' })
  getEvaluationStats() {
    return this.expertAdminService.getEvaluationStats();
  }

  @Post()
  @ApiOperation({ summary: '录入专家' })
  createExpert(@Body() dto: CreateExpertDto) {
    return this.expertAdminService.createExpert(dto);
  }

  @Post('extract')
  @ApiOperation({ summary: 'AI智能专家抽取（预览）' })
  previewExtraction(@Body() dto: ExtractPreviewDto) {
    return this.expertAdminService.previewExtraction(dto.projectId, dto);
  }

  @Post('extract/confirm')
  @ApiOperation({ summary: '确认专家抽取（建 BidExpert）' })
  confirmExtraction(@Body() dto: ConfirmExtractionDto) {
    return this.expertAdminService.confirmExtraction(dto.projectId, dto);
  }

  @Get('retire-candidates')
  @ApiOperation({ summary: '专家退库候选扫描（预警，不自动停用）' })
  reviewRetirementCandidates() {
    return this.expertAdminService.reviewRetirementCandidates();
  }

  // ── 动态 :id 路由 ──

  @Get(':id')
  @ApiOperation({ summary: '专家详情' })
  getExpert(@Param('id') id: string) {
    return this.expertAdminService.getExpert(id);
  }

  @Patch(':id/availability')
  @ApiOperation({ summary: '启用/停用专家' })
  setAvailability(@Param('id') id: string, @Body() body: { available: boolean }) {
    return this.expertAdminService.setAvailability(id, body.available);
  }

  @Patch(':id/profile')
  @ApiOperation({ summary: '更新专家资料' })
  updateProfile(@Param('id') id: string, @Body() dto: Partial<CreateExpertDto>) {
    return this.expertAdminService.updateProfile(id, dto);
  }

  @Get(':id/portrait')
  @ApiOperation({ summary: '专家画像' })
  getPortrait(@Param('id') id: string) {
    return this.expertAdminService.getExpertPortrait(id);
  }

  @Post(':id/retire')
  @ApiOperation({ summary: '人工确认专家退库' })
  confirmRetire(@Param('id') id: string, @Body() body: { reason: string }) {
    return this.expertAdminService.confirmRetire(id, body.reason);
  }

  @Post('evaluations')
  @ApiOperation({ summary: '发起专家履职评价' })
  createEvaluation(@Body() dto: CreateExpertEvaluationDto, @Request() req: any) {
    return this.expertAdminService.createEvaluation(req.user.sub, dto);
  }
}
