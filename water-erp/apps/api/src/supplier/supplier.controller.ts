import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards, Request, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SupplierService } from './supplier.service';
import { AuthGuard } from '../auth/auth.guard';
import { ProcurementGuard } from './procurement.guard';
import { OwnerGuard } from './owner.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { RegisterSupplierDto } from './dto/register-supplier.dto';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { RegisterTemporarySupplierDto } from './dto/register-temporary-supplier.dto';
import { UpdateSupplierStatusDto } from './dto/update-supplier-status.dto';
import { CreateChangeRequestDto } from './dto/create-change-request.dto';
import { ApproveChangeDto } from './dto/approve-change.dto';
import { CreateQualificationDto } from './dto/create-qualification.dto';
import { CreateEvaluationDto } from './dto/create-evaluation.dto';
import { CreateClassificationDto, UpdateClassificationDto } from './dto/create-classification.dto';
import { NotifySuppliersDto } from './dto/notify-suppliers.dto';
import { NegotiationConfigDto } from './dto/negotiation-config.dto';
import { SetClassificationsDto } from './dto/set-classifications.dto';
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

  @Post('register/temporary')
  @Public()
  @ApiOperation({ summary: '临时供应商注册（凭邀请码）' })
  async registerTemporary(@Body() dto: RegisterTemporarySupplierDto) {
    return this.supplierService.registerTemporary(dto);
  }

  // ── 临时供应商邀请码（采购端管理）──
  @Post('invitations')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '生成临时供应商邀请码（30/180/360 天）' })
  async createInvitation(@Body() dto: CreateInvitationDto, @Request() req: any) {
    return this.supplierService.createInvitation(dto, req.user.sub);
  }

  @Get('invitations')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '邀请码列表' })
  async listInvitations(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
  ) {
    return this.supplierService.listInvitations({
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
      status: status || undefined,
    });
  }

  @Post('invitations/:id/revoke')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '作废邀请码' })
  async revokeInvitation(@Param('id') id: string, @Request() req: any) {
    return this.supplierService.revokeInvitation(id, req.user.sub);
  }

  @Get('invitations/verify')
  @Public()
  @ApiOperation({ summary: '公开校验邀请码（临时注册前）' })
  async verifyInvitation(@Query('code') code?: string) {
    if (!code) throw new BadRequestException('请提供邀请码');
    return this.supplierService.verifyInvitationCode(code);
  }

  @Get('register/status')
  @ApiOperation({ summary: '查询供应商注册状态' })
  async getRegisterStatus(@Request() req: any) {
    return this.supplierService.getRegisterStatus(req.user.sub);
  }

  // 公开（无需登录）：注册后、审批前，供应商凭统一社会信用代码查询审核进度。
  // 仅回传 name/status/rejectReason，不泄漏敏感字段；按信用代码精确匹配，不可枚举。
  @Get('register/status/public')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // P1-28：防信用代码枚举爬取
  @ApiOperation({ summary: '凭信用代码公开查询注册审核进度' })
  async getRegisterStatusPublic(@Query('creditCode') creditCode?: string) {
    const code = (creditCode ?? '').trim();
    if (!code) throw new BadRequestException({ error: '请提供统一社会信用代码', code: 'MISSING_CREDIT_CODE' });
    return this.supplierService.getRegisterStatusByCreditCode(code);
  }

  @Get('stats')
  @ApiOperation({ summary: '供应商统计数据（Dashboard用）' })
  async getStats() {
    return this.supplierService.getStats();
  }

  // ── 业务标签：词表（选取/邀请页多选） + 全量回填（规则引擎，写 tags）──
  @Get('tag-vocabulary')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '业务标签词表（按频次降序，供选取/邀请页标签多选）' })
  async getTagVocabulary(@Query('limit') limit?: string) {
    return this.supplierService.getTagVocabulary(limit ? Number(limit) : undefined);
  }

  @Post('backfill-tags')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '业务标签全量回填（规则引擎；默认仅填空标签，force=true 全量重算）' })
  async backfillTags(@Query('force') force?: string, @Request() req?: any) {
    return this.supplierService.backfillBusinessTags({ force: force === 'true', userId: req?.user?.sub });
  }

  @Get('list')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff', 'supplier') // 补角色白名单：杜绝 bid_expert/mall 拖全库+PII；supplier 由 service 的 scopeUserId 收敛到本企业
  @ApiOperation({ summary: '供应商库列表（supplier 角色仅见本企业，杜绝枚举他企与主联系人 PII）' })
  async list(
    @Request() req: any,
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
    @Query('isTemporary') isTemporary?: string,
  ) {
    // #18 status 枚举校验：非法值会让 Prisma/raw cast 抛 500；支持 `exclude:A,B` 形式。
    if (status) {
      const VALID = new Set(['PENDING', 'RETURNED', 'APPROVED', 'REJECTED', 'DISABLED', 'BLACKLIST']);
      const vals = status.startsWith('exclude:') ? status.slice('exclude:'.length).split(',') : [status];
      if (vals.some(v => !VALID.has(v))) {
        throw new BadRequestException({ error: 'status 取值非法', code: 'INVALID_STATUS' });
      }
    }
    return this.supplierService.list({
      status, classificationId, search, page, pageSize, sort,
      enterpriseTypes: enterpriseTypes ? enterpriseTypes.split(',').filter(Boolean) : undefined,
      dateFrom, dateTo, evalLevel, qualificationStatus,
      // 临时供应商筛选：仅 'true' 视为真，其余（'false'/缺省）均不加该过滤，避免误判。
      isTemporary: isTemporary === 'true' ? true : undefined,
      scopeUserId: req?.user?.role === 'supplier' ? req.user.sub : undefined,
    });
  }

  // ─── 静态路由（必须在动态 :id 路由之前，否则会被吞掉）───

  @Public()
  @Get('bigscreen')
  @ApiOperation({ summary: '大屏供应商统计（公开，仅计数；详细须鉴权）' })
  async getBigscreenStats() {
    return this.supplierService.getBigscreenStats();
  }

  @Get('bigscreen/detail')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff') // P0-15：评价分布/分类计数/绩效趋势属经营敏感数据，须鉴权
  @ApiOperation({ summary: '大屏供应商统计（详细，需采购侧鉴权）' })
  async getBigscreenDetail() {
    return this.supplierService.getBigscreenDetail();
  }

  @Get('evaluations/stats')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '评价统计' })
  async getEvaluationStats() {
    return this.supplierService.getEvaluationStats();
  }

  @Get('classifications')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '分类列表' })
  async listClassifications() {
    return this.supplierService.listClassifications();
  }

  @Post('classifications')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '创建分类' })
  async createClassification(@Body() dto: CreateClassificationDto) {
    return this.supplierService.createClassification(dto);
  }

  @Patch('classifications/:id')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '更新分类' })
  async updateClassification(@Param('id') id: string, @Body() dto: UpdateClassificationDto) {
    return this.supplierService.updateClassification(id, dto);
  }

  @Delete('classifications/:id')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff')
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
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '设置供应商的分类标签（替换全部，仅采购侧角色）' })
  async setSupplierClassifications(
    @Param('id') id: string,
    @Body() dto: SetClassificationsDto,
  ) {
    return this.supplierService.setSupplierClassifications(id, dto.classificationIds);
  }

  @Post('notify')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '向指定供应商发送通知（站内+短信）' })
  async notifySuppliers(
    @Body() dto: NotifySuppliersDto,
  ) {
    return this.supplierService.notifySuppliers(dto.supplierIds, dto.channels, { type: dto.type, title: dto.title, content: dto.content, link: dto.link });
  }

  @Post('negotiation-config')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '谈判采购配置下发（时间/附件/下载方式 → Redis，供应商端读取）' })
  async sendNegotiationConfig(@Body() dto: NegotiationConfigDto) {
    return this.supplierService.sendNegotiationConfig(dto);
  }

  @Get('negotiation-config/:projectId')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: '供应商端读取谈判采购配置' })
  async getNegotiationConfig(@Param('projectId') projectId: string) {
    return this.supplierService.getNegotiationConfig(projectId);
  }

  @Get('eliminate-candidates')
  @UseGuards(ProcurementGuard)
  @ApiOperation({ summary: '供应商淘汰候选扫描（预警，不自动停用）' })
  async reviewEliminationCandidates() {
    return this.supplierService.reviewEliminationCandidates();
  }

  @Get('qualification-alerts')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '资质到期预警看板（含当前用户「已处理」标记）' })
  async getQualificationAlerts(@Request() req: any) {
    return this.supplierService.getQualificationAlerts(req.user?.sub);
  }

  @Post('qualification-alerts/:qid/ack')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '标记资质预警为已处理（入库，替代 sessionStorage）' })
  async acknowledgeQualificationAlert(@Param('qid') qid: string, @Request() req: any) {
    return this.supplierService.acknowledgeQualificationAlert(qid, req.user?.sub);
  }

  @Get('favorites/list')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '获取当前用户收藏列表' })
  async getFavorites(@Request() req: any) {
    return this.supplierService.getFavorites(req.user?.sub);
  }

  @Get('recent-activities')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '近期动态' })
  async getRecentActivities(@Query('limit') limit?: number) {
    return this.supplierService.getRecentActivities(limit ?? 15);
  }

  @Get('evaluations/dimension-stats')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '评价五维度统计' })
  async getDimensionStats() {
    return this.supplierService.getEvaluationDimensionStats();
  }

  @Get('enterprise-type-distribution')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '企业类型分布（后端聚合，供看板）' })
  async getEnterpriseTypeDistribution() {
    return this.supplierService.getEnterpriseTypeDistribution();
  }

  // ─── 动态路由 ───

  @Get(':id')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff', 'supplier') // 补角色白名单；supplier 归属校验在方法体内
  @ApiOperation({ summary: '供应商详情（supplier 角色仅见本企业，防跨企枚举与联系人 PII 泄露）' })
  async get(@Param('id') id: string, @Request() req: any) {
    const detail = await this.supplierService.get(id);
    // get() 用 include 返回关联 user，供应商归属 userId 在 detail.user.id（标量 userId 不在 select 顶层）。
    if (req?.user?.role === 'supplier' && detail?.user?.id && detail.user.id !== req.user.sub) {
      throw new ForbiddenException({ error: '只能查看本企业详情', code: 'FORBIDDEN' });
    }
    return detail;
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
  @UseGuards(ProcurementGuard) // P1：与 restore 对齐，统一由 ProcurementGuard 收口角色
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '更新供应商状态（停用/黑名单）' })
  async updateStatus(
    @Param('id') id: string,
    @Query('status') status: 'DISABLED' | 'BLACKLIST',
    @Body() dto: UpdateSupplierStatusDto,
    @Request() req: any,
  ) {
    // 运行时枚举校验：@Query 无 class-validator 校验，非法值会让 Prisma 抛 500。
    if (status !== 'DISABLED' && status !== 'BLACKLIST') {
      throw new BadRequestException({ error: 'status 仅可为 DISABLED 或 BLACKLIST', code: 'INVALID_STATUS' });
    }
    return this.supplierService.updateStatus(id, status, dto.reason, req.user?.sub);
  }

  @Post(':id/restore')
  @UseGuards(ProcurementGuard)
  @ApiOperation({ summary: '恢复/解禁供应商（停用或黑名单 → 已入库；黑名单解禁须填理由）' })
  async restoreStatus(@Param('id') id: string, @Body() body: { reason?: string }, @Request() req: any) {
    return this.supplierService.restoreStatus(id, req.user?.sub, body?.reason);
  }

  @Post(':id/reactivate')
  @UseGuards(ProcurementGuard)
  @ApiOperation({ summary: '复活被拒绝的供应商（REJECTED → PENDING）' })
  async reactivate(@Param('id') id: string, @Request() req: any) {
    return this.supplierService.reactivate(id, req.user?.sub);
  }

  @Post(':id/resubmit')
  @UseGuards(AuthGuard)
  @Roles('supplier') // P1-16：供应商补正后重新提交（RETURNED → PENDING）；归属校验在 service 内
  @ApiOperation({ summary: '供应商补正后重新提交（RETURNED → PENDING）' })
  async resubmit(@Param('id') id: string, @Body() body: { note?: string }, @Request() req: any) {
    return this.supplierService.resubmit(id, req.user.sub, body?.note);
  }

  @Get(':id/changes')
  @UseGuards(AuthGuard, OwnerGuard)
  @Roles('admin', 'leader', 'staff', 'supplier') // P0-3：杜绝 bid_expert/mall 越权读他企变更（含 oldValue/newValue PII）
  @ApiOperation({ summary: '变更记录列表' })
  async listChanges(@Param('id') id: string) {
    return this.supplierService.listChanges(id);
  }

  @Post(':id/changes')
  @UseGuards(AuthGuard, OwnerGuard)
  @Roles('admin', 'leader', 'staff', 'supplier')
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
  @UseGuards(AuthGuard, OwnerGuard)
  @Roles('admin', 'leader', 'staff', 'supplier') // P0-3：资质记录含 fileUrl（身份证/营业执照），杜绝跨角色读取
  @ApiOperation({ summary: '资质材料列表' })
  async listQualifications(@Param('id') id: string) {
    return this.supplierService.listQualifications(id);
  }

  @Post(':id/qualifications')
  @UseGuards(AuthGuard, OwnerGuard)
  @Roles('admin', 'leader', 'staff', 'supplier')
  @ApiOperation({ summary: '上传资质材料（supplier 仅本企业；他角色须采购侧）' })
  async addQualification(@Param('id') id: string, @Body() dto: CreateQualificationDto, @Request() req: any) {
    if (req.user.role === 'supplier') {
      const supplier = await this.prisma.supplier.findUnique({ where: { userId: req.user.sub } });
      if (!supplier || supplier.id !== id) {
        // 抛真实 403，而非 HTTP200+body403，使前端拦截器能统一捕获。
        throw new ForbiddenException({ error: '只能上传自己的资质材料', code: 'FORBIDDEN' });
      }
    }
    return this.supplierService.addQualification(id, dto);
  }

  @Delete(':id/qualifications/:qid')
  @UseGuards(AuthGuard, OwnerGuard)
  @Roles('admin', 'leader', 'staff', 'supplier')
  @ApiOperation({ summary: '删除资质材料（supplier 仅本企业；他角色须采购侧）' })
  async deleteQualification(@Param('id') id: string, @Param('qid') qid: string) {
    return this.supplierService.deleteQualification(id, qid);
  }

  @Get(':id/evaluations')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff') // 补角色白名单，防 bid_expert/mall 读他企评价
  @ApiOperation({ summary: '评价记录列表' })
  async listEvaluations(@Param('id') id: string) {
    return this.supplierService.listEvaluations(id);
  }

  @Post(':id/evaluations')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '发起评价（采购侧角色；supplier 角色禁止评价，杜绝自评刷分）' })
  async createEvaluation(@Param('id') id: string, @Body() dto: CreateEvaluationDto, @Request() req: any) {
    return this.supplierService.createEvaluation(id, req.user.sub, dto, req.user.role);
  }

  @Get(':id/portrait')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff') // 补角色白名单，防跨角色读他企画像
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

  @Patch(':id/tags')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '管理员修改供应商业务标签（直接生效，不走变更审批）' })
  async updateTags(@Param('id') id: string, @Body() body: { tags: string[] }, @Request() req: any) {
    return this.supplierService.updateTags(id, body.tags, req.user?.sub);
  }

  @Post(':id/favorite')
  @UseGuards(AuthGuard)
  @Roles('admin', 'leader', 'staff')
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
