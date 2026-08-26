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

  @Get()
  @ApiOperation({ summary: '合同列表（按状态/关键词）' })
  list(@Query('status') status?: string, @Query('q') q?: string) {
    return this.contractService.list({ status, q });
  }

  @Get('by-project')
  @ApiOperation({ summary: '按项目管理项/项目编号取合同（详情合同 tab）' })
  byProject(@Query('projectManagementItemId') projectManagementItemId?: string, @Query('projectCode') projectCode?: string) {
    return this.contractService.listByProject({ projectManagementItemId, projectCode });
  }

  @Post()
  @ApiOperation({ summary: '创建合同（草拟）' })
  async create(@Request() req: any, @Body() dto: any) {
    const stamp = await this.companyScope.stampFor(req.user);
    return this.contractService.create(dto, { companyId: stamp.companyId, companyName: stamp.companyName });
  }

  @Get(':id')
  @ApiOperation({ summary: '合同详情（含履行台账）' })
  get(@Param('id') id: string) {
    return this.contractService.get(id);
  }

  @Post(':id/consistency')
  @ApiOperation({ summary: '一致性校验（7.5.4.3：合同 vs 成交记录）' })
  consistency(@Param('id') id: string) {
    return this.contractService.runConsistency(id);
  }

  @Post(':id/submit-review')
  @ApiOperation({ summary: '提交内审（草拟→内审）' })
  submitReview(@Param('id') id: string, @Request() req: any) {
    return this.contractService.submitReview(id, { userId: req.user.sub, username: req.user.username });
  }

  @Post(':id/review')
  @ApiOperation({ summary: '内审结论（通过→已签署；驳回→回草拟）' })
  review(@Param('id') id: string, @Body() dto: { approved: boolean; note?: string }, @Request() req: any) {
    return this.contractService.review(id, dto, { userId: req.user.sub, username: req.user.username });
  }

  @Post(':id/sign')
  @ApiOperation({ summary: '登记签署（前置：一致性校验通过）' })
  sign(@Param('id') id: string, @Body() dto: { signedAssetId?: string; signedAt?: string }) {
    return this.contractService.sign(id, dto);
  }

  @Post(':id/contract-notice')
  @ApiOperation({ summary: '发布合同公告（7.5.4.5，幂等）' })
  contractNotice(@Param('id') id: string) {
    return this.contractService.publishContractNotice(id);
  }

  @Post(':id/draft-docx')
  @ApiOperation({ summary: '生成合同文本草稿 DOCX（keyTerms → docx）' })
  draftDocx(@Param('id') id: string, @Request() req: any) {
    return this.contractService.generateDraftDocx(id, req.user.sub);
  }

  // ── C3 履行与验收 ──

  @Post(':id/fulfillments')
  @ApiOperation({ summary: '登记履行节点（交付/付款/验收）' })
  async addFulfillment(@Param('id') id: string, @Body() dto: any) {
    await this.contractService.startPerforming(id);
    return this.contractService.addFulfillment(id, dto);
  }

  @Post(':id/fulfillments/:fid')
  @ApiOperation({ summary: '更新履行节点（完成/异常/凭证）' })
  updateFulfillment(@Param('id') id: string, @Param('fid') fid: string, @Body() dto: any) {
    return this.contractService.updateFulfillment(id, fid, dto);
  }

  @Post(':id/accept')
  @ApiOperation({ summary: '验收办结（→accepted + 履行结果公告 7.6.2.2）' })
  accept(@Param('id') id: string, @Body() dto: { note?: string; proofAssetId?: string; publishNotice?: boolean }) {
    return this.contractService.accept(id, dto);
  }

  @Post(':id/terminate')
  @ApiOperation({ summary: '终止合同（理由必填）' })
  terminate(@Param('id') id: string, @Body() dto: { reason: string }) {
    return this.contractService.terminate(id, dto.reason);
  }
}
