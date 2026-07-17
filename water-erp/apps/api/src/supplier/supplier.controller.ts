import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { SupplierService } from './supplier.service';
import { AuthGuard } from '../auth/auth.guard';
import { ProcurementGuard } from './procurement.guard';
import { OwnerGuard } from './owner.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { RegisterSupplierDto } from './dto/register-supplier.dto';
import { UpdateSupplierStatusDto } from './dto/update-supplier-status.dto';
import { CreateChangeRequestDto } from './dto/create-change-request.dto';
import { ApproveChangeDto } from './dto/approve-change.dto';
import { CreateQualificationDto } from './dto/create-qualification.dto';
import { CreateEvaluationDto } from './dto/create-evaluation.dto';
import { CreateClassificationDto, UpdateClassificationDto } from './dto/create-classification.dto';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('供应商管理')
@ApiCookieAuth('token')
@Controller('supplier')
export class SupplierController {
  constructor(
    private supplierService: SupplierService,
    private prisma: PrismaService,
  ) {}

  @Post('register')
  @Public()
  @ApiOperation({ summary: '供应商注册' })
  async register(@Body() dto: RegisterSupplierDto) {
    return this.supplierService.register(dto);
  }

  @Get('register/status')
  @ApiOperation({ summary: '查询供应商注册状态' })
  async getRegisterStatus(@Request() req: any) {
    return this.supplierService.getRegisterStatus(req.user.sub);
  }

  @Get('stats')
  @ApiOperation({ summary: '供应商统计数据（Dashboard用）' })
  async getStats() {
    return this.supplierService.getStats();
  }

  @Get('list')
  @ApiOperation({ summary: '供应商库列表' })
  async list(
    @Query('status') status?: string,
    @Query('classificationId') classificationId?: string,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('sort') sort?: 'completeness' | 'createdAt',
    @Query('enterpriseTypes') enterpriseTypes?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('evalLevel') evalLevel?: string,
    @Query('qualificationStatus') qualificationStatus?: string,
  ) {
    return this.supplierService.list({
      status, classificationId, search, page, pageSize, sort,
      enterpriseTypes: enterpriseTypes ? enterpriseTypes.split(',').filter(Boolean) : undefined,
      dateFrom, dateTo, evalLevel, qualificationStatus,
    });
  }

  // ─── 静态路由（必须在动态 :id 路由之前，否则会被吞掉）───

  @Public()
  @Get('bigscreen')
  @ApiOperation({ summary: '大屏供应商统计（公开）' })
  async getBigscreenStats() {
    return this.supplierService.getBigscreenStats();
  }

  @Get('evaluations/stats')
  @UseGuards(AuthGuard)
  @Roles('admin', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '评价统计' })
  async getEvaluationStats() {
    return this.supplierService.getEvaluationStats();
  }

  @Get('classifications')
  @UseGuards(AuthGuard)
  @Roles('admin', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '分类列表' })
  async listClassifications() {
    return this.supplierService.listClassifications();
  }

  @Post('classifications')
  @UseGuards(AuthGuard)
  @Roles('admin', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '创建分类' })
  async createClassification(@Body() dto: CreateClassificationDto) {
    return this.supplierService.createClassification(dto);
  }

  @Patch('classifications/:id')
  @UseGuards(AuthGuard)
  @Roles('admin', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '更新分类' })
  async updateClassification(@Param('id') id: string, @Body() dto: UpdateClassificationDto) {
    return this.supplierService.updateClassification(id, dto);
  }

  @Delete('classifications/:id')
  @UseGuards(AuthGuard)
  @Roles('admin', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '删除分类' })
  async deleteClassification(@Param('id') id: string) {
    return this.supplierService.deleteClassification(id);
  }

  // ─── 供应商多分类标签 ───
  @Get(':id/classifications')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: '获取供应商的分类标签列表' })
  async getSupplierClassifications(@Param('id') id: string) {
    return this.supplierService.getSupplierClassifications(id);
  }

  @Put(':id/classifications')
  @UseGuards(AuthGuard)
  @Roles('admin', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '设置供应商的分类标签（替换全部）' })
  async setSupplierClassifications(
    @Param('id') id: string,
    @Body() dto: { classificationIds: string[] },
  ) {
    return this.supplierService.setSupplierClassifications(id, dto.classificationIds);
  }

  @Post('notify')
  @UseGuards(AuthGuard)
  @Roles('admin', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '向指定供应商发送通知（站内+短信）' })
  async notifySuppliers(
    @Body() dto: { supplierIds: string[]; channels: string[]; type: string; title: string; content: string },
  ) {
    return this.supplierService.notifySuppliers(dto.supplierIds, dto.channels, { type: dto.type, title: dto.title, content: dto.content });
  }

  @Get('eliminate-candidates')
  @UseGuards(ProcurementGuard)
  @ApiOperation({ summary: '供应商淘汰候选扫描（预警，不自动停用）' })
  async reviewEliminationCandidates() {
    return this.supplierService.reviewEliminationCandidates();
  }

  @Get('qualification-alerts')
  @UseGuards(AuthGuard)
  @Roles('admin', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '资质到期预警看板' })
  async getQualificationAlerts() {
    return this.supplierService.getQualificationAlerts();
  }

  @Get('favorites/list')
  @UseGuards(AuthGuard)
  @Roles('admin', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '获取当前用户收藏列表' })
  async getFavorites(@Request() req: any) {
    return this.supplierService.getFavorites(req.user?.sub);
  }

  @Get('recent-activities')
  @UseGuards(AuthGuard)
  @Roles('admin', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '近期动态' })
  async getRecentActivities(@Query('limit') limit?: number) {
    return this.supplierService.getRecentActivities(limit ?? 15);
  }

  @Get('evaluations/dimension-stats')
  @UseGuards(AuthGuard)
  @Roles('admin', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '评价五维度统计' })
  async getDimensionStats() {
    return this.supplierService.getEvaluationDimensionStats();
  }

  // ─── 动态路由 ───

  @Get(':id')
  @ApiOperation({ summary: '供应商详情' })
  async get(@Param('id') id: string) {
    return this.supplierService.get(id);
  }

  @Post(':id/approve')
  @UseGuards(ProcurementGuard)
  @ApiOperation({ summary: '审核通过' })
  async approve(@Param('id') id: string, @Request() req: any) {
    return this.supplierService.approve(id, req.user?.sub);
  }

  @Post(':id/reject')
  @UseGuards(ProcurementGuard)
  @ApiOperation({ summary: '审核不通过' })
  async reject(@Param('id') id: string, @Body() dto: UpdateSupplierStatusDto, @Request() req: any) {
    return this.supplierService.reject(id, dto.reason, req.user?.sub);
  }

  @Post(':id/return')
  @UseGuards(ProcurementGuard)
  @ApiOperation({ summary: '退回补正' })
  async return(@Param('id') id: string, @Body() dto: UpdateSupplierStatusDto, @Request() req: any) {
    return this.supplierService.return(id, dto.reason, req.user?.sub);
  }

  @Patch(':id/status')
  @Roles('admin', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '更新供应商状态（停用/黑名单）' })
  async updateStatus(
    @Param('id') id: string,
    @Query('status') status: 'DISABLED' | 'BLACKLIST',
    @Body() dto: UpdateSupplierStatusDto,
    @Request() req: any,
  ) {
    return this.supplierService.updateStatus(id, status, dto.reason, req.user?.sub);
  }

  @Get(':id/changes')
  @UseGuards(OwnerGuard)
  @ApiOperation({ summary: '变更记录列表' })
  async listChanges(@Param('id') id: string) {
    return this.supplierService.listChanges(id);
  }

  @Post(':id/changes')
  @UseGuards(OwnerGuard)
  @ApiOperation({ summary: '提交变更申请' })
  async createChangeRequest(@Param('id') id: string, @Body() dto: CreateChangeRequestDto, @Request() req: any) {
    return this.supplierService.createChangeRequest(id, req.user.sub, dto);
  }

  @Post('changes/:changeId/approve')
  @UseGuards(ProcurementGuard)
  @ApiOperation({ summary: '审核变更通过' })
  async approveChange(@Param('changeId') changeId: string, @Request() req: any) {
    return this.supplierService.approveChange(changeId, req.user.sub);
  }

  @Post('changes/:changeId/reject')
  @UseGuards(ProcurementGuard)
  @ApiOperation({ summary: '拒绝变更' })
  async rejectChange(@Param('changeId') changeId: string, @Body() dto: ApproveChangeDto, @Request() req: any) {
    return this.supplierService.rejectChange(changeId, req.user.sub, dto.rejectReason ?? '');
  }

  @Get(':id/qualifications')
  @UseGuards(OwnerGuard)
  @ApiOperation({ summary: '资质材料列表' })
  async listQualifications(@Param('id') id: string) {
    return this.supplierService.listQualifications(id);
  }

  @Post(':id/qualifications')
  @UseGuards(OwnerGuard)
  @ApiOperation({ summary: '上传资质材料' })
  async addQualification(@Param('id') id: string, @Body() dto: CreateQualificationDto, @Request() req: any) {
    if (req.user.role === 'supplier') {
      const supplier = await this.prisma.supplier.findUnique({ where: { userId: req.user.sub } });
      if (!supplier || supplier.id !== id) {
        return { statusCode: 403, code: 'FORBIDDEN', error: '只能上传自己的资质材料' };
      }
    }
    return this.supplierService.addQualification(id, dto);
  }

  @Delete(':id/qualifications/:qid')
  @UseGuards(OwnerGuard)
  @ApiOperation({ summary: '删除资质材料' })
  async deleteQualification(@Param('id') id: string, @Param('qid') qid: string) {
    return this.supplierService.deleteQualification(id, qid);
  }

  @Get(':id/evaluations')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: '评价记录列表' })
  async listEvaluations(@Param('id') id: string) {
    return this.supplierService.listEvaluations(id);
  }

  @Post(':id/evaluations')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: '发起评价（任何登录用户均可评价，系统记录评价人）' })
  async createEvaluation(@Param('id') id: string, @Body() dto: CreateEvaluationDto, @Request() req: any) {
    return this.supplierService.createEvaluation(id, req.user.sub, dto);
  }

  @Get(':id/portrait')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: '供应商画像' })
  async getPortrait(@Param('id') id: string) {
    return this.supplierService.getSupplierPortrait(id);
  }

  @Post(':id/eliminate')
  @UseGuards(ProcurementGuard)
  @ApiOperation({ summary: '人工确认供应商淘汰' })
  async confirmEliminate(@Param('id') id: string, @Body() body: { reason: string }, @Request() req: any) {
    return this.supplierService.confirmEliminate(id, body.reason, req.user?.sub);
  }

  @Get(':id/timeline')
  @UseGuards(ProcurementGuard)
  @ApiOperation({ summary: '供应商生命周期时间线' })
  async getTimeline(@Param('id') id: string) {
    return this.supplierService.getSupplierTimeline(id);
  }

  @Post(':id/favorite')
  @UseGuards(AuthGuard)
  @Roles('admin', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '切换供应商收藏' })
  async toggleFavorite(@Param('id') id: string, @Request() req: any) {
    return this.supplierService.toggleFavorite(id, req.user?.sub);
  }

  @Get(':id/communications')
  @UseGuards(ProcurementGuard)
  @ApiOperation({ summary: '供应商沟通记录' })
  async getCommunications(@Param('id') id: string) {
    return this.supplierService.getSupplierCommunications(id);
  }

  @Get(':id/documents')
  @UseGuards(ProcurementGuard)
  @ApiOperation({ summary: '供应商文件档案列表' })
  async listDocuments(@Param('id') id: string) {
    return this.supplierService.listDocuments(id);
  }

  @Post(':id/documents')
  @UseGuards(ProcurementGuard)
  @ApiOperation({ summary: '上传供应商文件' })
  async uploadDocument(@Param('id') id: string, @Body() body: { type: string; name: string; fileUrl: string; fileSize?: number; note?: string }, @Request() req: any) {
    return this.supplierService.uploadDocument(id, body, req.user?.sub);
  }

  @Delete(':id/documents/:docId')
  @UseGuards(ProcurementGuard)
  @ApiOperation({ summary: '删除供应商文件' })
  async deleteDocument(@Param('docId') docId: string) {
    return this.supplierService.deleteDocument(docId);
  }
}
