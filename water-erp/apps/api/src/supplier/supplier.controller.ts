import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { SupplierService } from './supplier.service';
import { AuthGuard } from '../auth/auth.guard';
import { ProcurementGuard } from './procurement.guard';
import { OwnerGuard } from './owner.guard';
import { RegisterSupplierDto } from './dto/register-supplier.dto';
import { UpdateSupplierStatusDto } from './dto/update-supplier-status.dto';
import { CreateChangeRequestDto } from './dto/create-change-request.dto';
import { ApproveChangeDto } from './dto/approve-change.dto';
import { CreateQualificationDto } from './dto/create-qualification.dto';
import { CreateEvaluationDto } from './dto/create-evaluation.dto';
import { CreateClassificationDto, UpdateClassificationDto } from './dto/create-classification.dto';
import { PrismaService } from '../prisma/prisma.service';

@Controller('supplier')
export class SupplierController {
  constructor(
    private supplierService: SupplierService,
    private prisma: PrismaService,
  ) {}

  // 公开接口：供应商注册
  @Post('register')
  async register(@Body() dto: RegisterSupplierDto) {
    return this.supplierService.register(dto);
  }

  // 供应商查询注册状态（需登录）
  @Get('register/status')
  @UseGuards(AuthGuard)
  async getRegisterStatus(@Request() req: any) {
    return this.supplierService.getRegisterStatus(req.user.sub);
  }

  // 供应商库列表（采购中心权限）
  @Get('list')
  @UseGuards(AuthGuard)
  async list(
    @Query('status') status?: string,
    @Query('classificationId') classificationId?: string,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.supplierService.list({ status, classificationId, search, page, pageSize });
  }

  // 供应商详情
  @Get(':id')
  @UseGuards(AuthGuard)
  async get(@Param('id') id: string) {
    return this.supplierService.get(id);
  }

  // 审核通过（采购中心权限）
  @Post(':id/approve')
  @UseGuards(AuthGuard, ProcurementGuard)
  async approve(@Param('id') id: string) {
    return this.supplierService.approve(id);
  }

  // 审核不通过（采购中心权限）
  @Post(':id/reject')
  @UseGuards(AuthGuard, ProcurementGuard)
  async reject(@Param('id') id: string, @Body() dto: UpdateSupplierStatusDto) {
    return this.supplierService.reject(id, dto.reason);
  }

  // 退回补正（采购中心权限）
  @Post(':id/return')
  @UseGuards(AuthGuard, ProcurementGuard)
  async return(@Param('id') id: string, @Body() dto: UpdateSupplierStatusDto) {
    return this.supplierService.return(id, dto.reason);
  }

  // 更新状态（管理员权限）
  @Patch(':id/status')
  @UseGuards(AuthGuard)
  async updateStatus(
    @Param('id') id: string,
    @Query('status') status: 'DISABLED' | 'BLACKLIST',
    @Body() dto: UpdateSupplierStatusDto,
    @Request() req: any,
  ) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException({ error: '只有管理员可以调整供应商状态', code: 'FORBIDDEN' });
    }
    return this.supplierService.updateStatus(id, status, dto.reason);
  }

  // 变更记录列表
  @Get(':id/changes')
  @UseGuards(AuthGuard, OwnerGuard)
  async listChanges(@Param('id') id: string) {
    return this.supplierService.listChanges(id);
  }

  // 提交变更申请（供应商本人）
  @Post(':id/changes')
  @UseGuards(AuthGuard, OwnerGuard)
  async createChangeRequest(@Param('id') id: string, @Body() dto: CreateChangeRequestDto, @Request() req: any) {
    return this.supplierService.createChangeRequest(id, req.user.sub, dto);
  }

  // 审核变更（采购中心）
  @Post('changes/:changeId/approve')
  @UseGuards(AuthGuard, ProcurementGuard)
  async approveChange(@Param('changeId') changeId: string, @Request() req: any) {
    return this.supplierService.approveChange(changeId, req.user.sub);
  }

  // 拒绝变更（采购中心）
  @Post('changes/:changeId/reject')
  @UseGuards(AuthGuard, ProcurementGuard)
  async rejectChange(@Param('changeId') changeId: string, @Body() dto: ApproveChangeDto, @Request() req: any) {
    return this.supplierService.rejectChange(changeId, req.user.sub, dto.rejectReason ?? '');
  }

  // 资质材料列表
  @Get(':id/qualifications')
  @UseGuards(AuthGuard, OwnerGuard)
  async listQualifications(@Param('id') id: string) {
    return this.supplierService.listQualifications(id);
  }

  // 上传资质材料
  @Post(':id/qualifications')
  @UseGuards(AuthGuard, OwnerGuard)
  async addQualification(@Param('id') id: string, @Body() dto: CreateQualificationDto, @Request() req: any) {
    // 验证供应商所有权
    if (req.user.role === 'supplier') {
      const supplier = await this.prisma.supplier.findUnique({ where: { userId: req.user.sub } });
      if (!supplier || supplier.id !== id) {
        throw new ForbiddenException({ error: '只能上传自己的资质材料', code: 'FORBIDDEN' });
      }
    }
    return this.supplierService.addQualification(id, dto);
  }

  // 删除资质材料
  @Delete(':id/qualifications/:qid')
  @UseGuards(AuthGuard, OwnerGuard)
  async deleteQualification(@Param('id') id: string, @Param('qid') qid: string) {
    return this.supplierService.deleteQualification(id, qid);
  }

  // 评价记录列表
  @Get(':id/evaluations')
  @UseGuards(AuthGuard, ProcurementGuard)
  async listEvaluations(@Param('id') id: string) {
    return this.supplierService.listEvaluations(id);
  }

  // 发起评价（采购中心）
  @Post(':id/evaluations')
  @UseGuards(AuthGuard, ProcurementGuard)
  async createEvaluation(@Param('id') id: string, @Body() dto: CreateEvaluationDto, @Request() req: any) {
    return this.supplierService.createEvaluation(id, req.user.sub, dto);
  }

  // 评价统计
  @Get('evaluations/stats')
  @UseGuards(AuthGuard)
  async getEvaluationStats(@Request() req: any) {
    if (req.user.role !== 'procurement_staff' && req.user.role !== 'admin' && req.user.role !== 'leader') {
      throw new ForbiddenException({ error: '无权查看评价统计', code: 'FORBIDDEN' });
    }
    return this.supplierService.getEvaluationStats();
  }

  // 分类列表（管理员）
  @Get('classifications')
  @UseGuards(AuthGuard)
  async listClassifications(@Request() req: any) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException({ error: '只有管理员可以管理分类', code: 'FORBIDDEN' });
    }
    return this.supplierService.listClassifications();
  }

  // 创建分类（管理员）
  @Post('classifications')
  @UseGuards(AuthGuard)
  async createClassification(@Body() dto: CreateClassificationDto, @Request() req: any) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException({ error: '只有管理员可以创建分类', code: 'FORBIDDEN' });
    }
    return this.supplierService.createClassification(dto);
  }

  // 更新分类（管理员）
  @Patch('classifications/:id')
  @UseGuards(AuthGuard)
  async updateClassification(@Param('id') id: string, @Body() dto: UpdateClassificationDto, @Request() req: any) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException({ error: '只有管理员可以更新分类', code: 'FORBIDDEN' });
    }
    return this.supplierService.updateClassification(id, dto);
  }

  // 删除分类（管理员）
  @Delete('classifications/:id')
  @UseGuards(AuthGuard)
  async deleteClassification(@Param('id') id: string, @Request() req: any) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException({ error: '只有管理员可以删除分类', code: 'FORBIDDEN' });
    }
    return this.supplierService.deleteClassification(id);
  }
}