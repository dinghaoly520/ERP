import { Controller, Get, Post, Body, Param, Query, Request } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { ContractService } from './contract.service';
import { CompanyScopeService } from '../company/company-scope';

/**
 * C2/C3（GB/T 43711 7.5.4/7.6）：合同订立·履行·验收——采购人侧（:3005 项目管理详情合同 tab）。
 * 附件走既有 /upload（category=contract_document），此处只收 fileAssetId 引用。
 */
@ApiTags('采购合同')
@Roles('admin', 'leader', 'staff', 'bid_host')
@Controller('contracts')
export class ContractController {
  constructor(
    private contractService: ContractService,
    private companyScope: CompanyScopeService,
  ) {}

  private async resolveCompanyFilter(req: any, requestedCompanyId?: string) {
    const scope = await this.companyScope.resolveScope(req.user, requestedCompanyId);
    return this.companyScope.filter(scope);
  }

  private async resolveActor(req: any) {
    const companyFilter = await this.resolveCompanyFilter(req);
    return {
      userId: req.user.sub,
      username: req.user.username,
      ...companyFilter,
    };
  }

  @Get()
  @ApiOperation({ summary: '合同列表（按状态/关键词）' })
  async list(
    @Request() req: any,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('companyId') companyId?: string,
  ) {
    const companyFilter = await this.resolveCompanyFilter(req, companyId);
    return this.contractService.list({ status, q, ...companyFilter });
  }

  @Get('by-project')
  @ApiOperation({ summary: '按项目管理项/项目编号取合同（详情合同 tab）' })
  async byProject(
    @Request() req: any,
    @Query('projectManagementItemId') projectManagementItemId?: string,
    @Query('projectCode') projectCode?: string,
    @Query('companyId') companyId?: string,
  ) {
    const companyFilter = await this.resolveCompanyFilter(req, companyId);
    return this.contractService.listByProject({ projectManagementItemId, projectCode, ...companyFilter });
  }

  @Post()
  @ApiOperation({ summary: '创建合同（草拟）' })
  async create(@Request() req: any, @Body() dto: any) {
    const stamp = await this.companyScope.stampFor(req.user);
    return this.contractService.create(dto, { companyId: stamp.companyId, companyName: stamp.companyName });
  }

  @Get(':id')
  @ApiOperation({ summary: '合同详情（含履行台账）' })
  async get(@Param('id') id: string, @Request() req: any) {
    return this.contractService.get(id, await this.resolveCompanyFilter(req));
  }

  @Post(':id/consistency')
  @ApiOperation({ summary: '一致性校验（7.5.4.3：合同 vs 成交记录）' })
  async consistency(@Param('id') id: string, @Request() req: any) {
    return this.contractService.runConsistency(id, await this.resolveCompanyFilter(req));
  }

  @Post(':id/submit-review')
  @ApiOperation({ summary: '提交内审（草拟→内审）' })
  async submitReview(@Param('id') id: string, @Request() req: any) {
    return this.contractService.submitReview(id, await this.resolveActor(req));
  }

  @Post(':id/review')
  @ApiOperation({ summary: '内审结论（通过→待登记签署；驳回→回草拟）' })
  async review(@Param('id') id: string, @Body() dto: { approved: boolean; note?: string }, @Request() req: any) {
    return this.contractService.review(id, dto, await this.resolveActor(req));
  }

  @Post(':id/sign')
  @ApiOperation({ summary: '登记签署（前置：一致性校验通过）' })
  async sign(
    @Param('id') id: string,
    @Body() dto: { signedAssetId?: string; signedAt?: string },
    @Request() req: any,
  ) {
    return this.contractService.sign(id, dto, await this.resolveActor(req));
  }

  @Post(':id/contract-notice')
  @ApiOperation({ summary: '发布合同公告（7.5.4.5，幂等）' })
  async contractNotice(@Param('id') id: string, @Request() req: any) {
    return this.contractService.publishContractNotice(id, await this.resolveCompanyFilter(req));
  }

  @Post(':id/draft-docx')
  @ApiOperation({ summary: '生成合同文本草稿 DOCX（keyTerms → docx）' })
  async draftDocx(@Param('id') id: string, @Request() req: any) {
    return this.contractService.generateDraftDocx(id, req.user.sub, await this.resolveCompanyFilter(req));
  }

  // ── C3 履行与验收 ──

  @Post(':id/fulfillments')
  @ApiOperation({ summary: '登记履行节点（交付/付款/验收）' })
  async addFulfillment(@Param('id') id: string, @Body() dto: any, @Request() req: any) {
    return this.contractService.addFulfillment(id, dto, await this.resolveActor(req));
  }

  @Post(':id/fulfillments/:fid')
  @ApiOperation({ summary: '更新履行节点（完成/异常/凭证）' })
  async updateFulfillment(
    @Param('id') id: string,
    @Param('fid') fid: string,
    @Body() dto: any,
    @Request() req: any,
  ) {
    return this.contractService.updateFulfillment(
      id,
      fid,
      dto,
      await this.resolveActor(req),
    );
  }

  @Post(':id/accept')
  @ApiOperation({ summary: '验收办结（→accepted + 履行结果公告 7.6.2.2）' })
  async accept(
    @Param('id') id: string,
    @Body() dto: { note?: string; proofAssetId?: string; publishNotice?: boolean },
    @Request() req: any,
  ) {
    return this.contractService.accept(id, dto, await this.resolveActor(req));
  }

  @Post(':id/terminate')
  @ApiOperation({ summary: '终止合同（理由必填）' })
  async terminate(@Param('id') id: string, @Body() dto: { reason: string }, @Request() req: any) {
    return this.contractService.terminate(id, dto.reason, await this.resolveActor(req));
  }
}
