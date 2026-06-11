import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { BidService } from './bid.service';
import { AuthGuard } from '../auth/auth.guard';
import { CreateBidProjectDto } from './dto/create-bid-project.dto';
import { UpdateBidProjectDto } from './dto/update-bid-project.dto';
import { SubmitBidDto } from './dto/submit-bid.dto';
import { CreateScoreDto } from './dto/create-score.dto';
import { CreateClarificationDto } from './dto/create-clarification.dto';

@ApiTags('开评标管理')
@ApiCookieAuth('token')
@Controller('bid')
@UseGuards(AuthGuard)
export class BidController {
  constructor(private bidService: BidService) {}

  @Get('projects')
  @ApiOperation({ summary: '项目列表' })
  listProjects() { return this.bidService.listProjects(); }

  @Post('projects')
  @ApiOperation({ summary: '创建项目' })
  createProject(@Body() dto: CreateBidProjectDto) { return this.bidService.createProject(dto); }

  @Get('projects/:id')
  @ApiOperation({ summary: '项目详情' })
  getProject(@Param('id') id: string) { return this.bidService.getProject(id); }

  @Patch('projects/:id')
  @ApiOperation({ summary: '更新项目' })
  updateProject(@Param('id') id: string, @Body() dto: UpdateBidProjectDto) { return this.bidService.updateProject(id, dto); }

  @Get('projects/:id/suppliers')
  @ApiOperation({ summary: '投标供应商列表' })
  listSuppliers(@Param('id') id: string) { return this.bidService.listSuppliers(id); }

  @Post('projects/:id/suppliers')
  @ApiOperation({ summary: '提交投标' })
  submitBid(@Param('id') id: string, @Body() dto: SubmitBidDto) { return this.bidService.submitBid(id, dto); }

  @Post('projects/:id/open')
  @ApiOperation({ summary: '启动开标' })
  startOpening(@Param('id') id: string) { return this.bidService.startOpening(id); }

  @Post('projects/:id/decrypt/:supplierId')
  @ApiOperation({ summary: '解密供应商投标' })
  decryptSupplier(@Param('id') id: string, @Param('supplierId') supplierId: string) { return this.bidService.decryptSupplier(id, supplierId); }

  @Get('projects/:id/opening-records')
  @ApiOperation({ summary: '开标记录' })
  listOpeningRecords(@Param('id') id: string) { return this.bidService.listOpeningRecords(id); }

  @Get('projects/:id/experts')
  @ApiOperation({ summary: '评标专家列表' })
  listExperts(@Param('id') id: string) { return this.bidService.listExperts(id); }

  @Post('projects/:id/scores')
  @ApiOperation({ summary: '提交评分' })
  submitScore(@Param('id') id: string, @Body() dto: CreateScoreDto) { return this.bidService.submitScore(id, dto); }

  @Get('projects/:id/scores')
  @ApiOperation({ summary: '评分列表' })
  listScores(@Param('id') id: string) { return this.bidService.listScores(id); }

  @Get('projects/:id/clarifications')
  @ApiOperation({ summary: '澄清记录' })
  listClarifications(@Param('id') id: string) { return this.bidService.listClarifications(id); }

  @Post('projects/:id/clarifications')
  @ApiOperation({ summary: '发起澄清' })
  createClarification(@Param('id') id: string, @Body() dto: CreateClarificationDto) { return this.bidService.createClarification(id, dto); }

  @Get('projects/:id/supervision-logs')
  @ApiOperation({ summary: '监督日志' })
  listSupervisionLogs(@Param('id') id: string) { return this.bidService.listSupervisionLogs(id); }

  @Get('projects/:id/archives')
  @ApiOperation({ summary: '归档资料' })
  listArchives(@Param('id') id: string) { return this.bidService.listArchives(id); }

  @Post('projects/:id/archive-all')
  @ApiOperation({ summary: '一键归档' })
  archiveAll(@Param('id') id: string) { return this.bidService.archiveAll(id); }
}
