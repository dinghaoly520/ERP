import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { SupplierService } from './supplier.service';
import { AuthGuard } from '../auth/auth.guard';
import { ProcurementGuard } from './procurement.guard';
import { OwnerGuard } from './owner.guard';
import { Roles } from '../common/decorators/roles.decorator';
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
  @ApiOperation({ summary: '供应商注册' })
  async register(@Body() dto: RegisterSupplierDto) {
    return this.supplierService.register(dto);
  }

  @Get('register/status')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: '查询供应商注册状态' })
  async getRegisterStatus(@Request() req: any) {
    return this.supplierService.getRegisterStatus(req.user.sub);
  }

  @Get('list')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: '供应商库列表' })
  async list(
    @Query('status') status?: string,
    @Query('classificationId') classificationId?: string,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.supplierService.list({ status, classificationId, search, page, pageSize });
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: '供应商详情' })
  async get(@Param('id') id: string) {
    return this.supplierService.get(id);
  }

  @Post(':id/approve')
  @UseGuards(AuthGuard, ProcurementGuard)
  @ApiOperation({ summary: '审核通过' })
  async approve(@Param('id') id: string) {
    return this.supplierService.approve(id);
  }

  @Post(':id/reject')
  @UseGuards(AuthGuard, ProcurementGuard)
  @ApiOperation({ summary: '审核不通过' })
  async reject(@Param('id') id: string, @Body() dto: UpdateSupplierStatusDto) {
    return this.supplierService.reject(id, dto.reason);
  }

  @Post(':id/return')
  @UseGuards(AuthGuard, ProcurementGuard)
  @ApiOperation({ summary: '退回补正' })
  async return(@Param('id') id: string, @Body() dto: UpdateSupplierStatusDto) {
    return this.supplierService.return(id, dto.reason);
  }

  @Patch(':id/status')
  @UseGuards(AuthGuard)
  @Roles('admin')
  @ApiOperation({ summary: '更新供应商状态（停用/黑名单）' })
  async updateStatus(
    @Param('id') id: string,
    @Query('status') status: 'DISABLED' | 'BLACKLIST',
    @Body() dto: UpdateSupplierStatusDto,
  ) {
    return this.supplierService.updateStatus(id, status, dto.reason);
  }

  @Get(':id/changes')
  @UseGuards(AuthGuard, OwnerGuard)
  @ApiOperation({ summary: '变更记录列表' })
  async listChanges(@Param('id') id: string) {
    return this.supplierService.listChanges(id);
  }

  @Post(':id/changes')
  @UseGuards(AuthGuard, OwnerGuard)
  @ApiOperation({ summary: '提交变更申请' })
  async createChangeRequest(@Param('id') id: string, @Body() dto: CreateChangeRequestDto, @Request() req: any) {
    return this.supplierService.createChangeRequest(id, req.user.sub, dto);
  }

  @Post('changes/:changeId/approve')
  @UseGuards(AuthGuard, ProcurementGuard)
  @ApiOperation({ summary: '审核变更通过' })
  async approveChange(@Param('changeId') changeId: string, @Request() req: any) {
    return this.supplierService.approveChange(changeId, req.user.sub);
  }

  @Post('changes/:changeId/reject')
  @UseGuards(AuthGuard, ProcurementGuard)
  @ApiOperation({ summary: '拒绝变更' })
  async rejectChange(@Param('changeId') changeId: string, @Body() dto: ApproveChangeDto, @Request() req: any) {
    return this.supplierService.rejectChange(changeId, req.user.sub, dto.rejectReason ?? '');
  }

  @Get(':id/qualifications')
  @UseGuards(AuthGuard, OwnerGuard)
  @ApiOperation({ summary: '资质材料列表' })
  async listQualifications(@Param('id') id: string) {
    return this.supplierService.listQualifications(id);
  }

  @Post(':id/qualifications')
  @UseGuards(AuthGuard, OwnerGuard)
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
  @UseGuards(AuthGuard, OwnerGuard)
  @ApiOperation({ summary: '删除资质材料' })
  async deleteQualification(@Param('id') id: string, @Param('qid') qid: string) {
    return this.supplierService.deleteQualification(id, qid);
  }

  @Get(':id/evaluations')
  @UseGuards(AuthGuard, ProcurementGuard)
  @ApiOperation({ summary: '评价记录列表' })
  async listEvaluations(@Param('id') id: string) {
    return this.supplierService.listEvaluations(id);
  }

  @Post(':id/evaluations')
  @UseGuards(AuthGuard, ProcurementGuard)
  @ApiOperation({ summary: '发起评价' })
  async createEvaluation(@Param('id') id: string, @Body() dto: CreateEvaluationDto, @Request() req: any) {
    return this.supplierService.createEvaluation(id, req.user.sub, dto);
  }

  @Get('evaluations/stats')
  @UseGuards(AuthGuard)
  @Roles('admin', 'procurement_staff', 'leader')
  @ApiOperation({ summary: '评价统计' })
  async getEvaluationStats() {
    return this.supplierService.getEvaluationStats();
  }

  @Get('classifications')
  @UseGuards(AuthGuard)
  @Roles('admin')
  @ApiOperation({ summary: '分类列表' })
  async listClassifications() {
    return this.supplierService.listClassifications();
  }

  @Post('classifications')
  @UseGuards(AuthGuard)
  @Roles('admin')
  @ApiOperation({ summary: '创建分类' })
  async createClassification(@Body() dto: CreateClassificationDto) {
    return this.supplierService.createClassification(dto);
  }

  @Patch('classifications/:id')
  @UseGuards(AuthGuard)
  @Roles('admin')
  @ApiOperation({ summary: '更新分类' })
  async updateClassification(@Param('id') id: string, @Body() dto: UpdateClassificationDto) {
    return this.supplierService.updateClassification(id, dto);
  }

  @Delete('classifications/:id')
  @UseGuards(AuthGuard)
  @Roles('admin')
  @ApiOperation({ summary: '删除分类' })
  async deleteClassification(@Param('id') id: string) {
    return this.supplierService.deleteClassification(id);
  }
}
