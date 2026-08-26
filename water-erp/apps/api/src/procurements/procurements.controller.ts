import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Query,
  Param,
  Body,
  ForbiddenException,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ProcurementsService } from './procurements.service';
import { CreateProcurementRoundDto } from './dto/create-procurement-round.dto';
import { UpdateProcurementRoundDto } from './dto/update-procurement-round.dto';
import { QueryProcurementsDto } from './dto/query-procurements.dto';
import { CompanyScopeService } from '../company/company-scope';
import { canViewGlobalBusinessData } from '../auth/auth-scope';

@Controller('procurements')
export class ProcurementsController {
  constructor(
    private readonly procurementsService: ProcurementsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  @Get()
  @Roles('leader', 'admin')
  async findAll(
    @Query() query: QueryProcurementsDto,
    @Query('companyId') companyId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!canViewGlobalBusinessData(user.role)) {
      throw new ForbiddenException('普通账号无法查看采购台账。');
    }
    const scope = await this.companyScope.resolveScope(user, companyId);
    return this.procurementsService.findAll(query, user, this.companyScope.filter(scope));
  }

  @Get('stats')
  @Roles('leader', 'admin')
  async getStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('companyId') companyId?: string, // 仅 admin 生效：切换查看单公司
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    if (!canViewGlobalBusinessData(user?.role ?? '')) {
      throw new ForbiddenException('普通账号无法查看采购台账。');
    }
    const scope = await this.companyScope.resolveScope(user, companyId);
    return this.procurementsService.getStats(startDate, endDate, user, this.companyScope.filter(scope));
  }

  @Get('methods')
  @Roles('leader', 'admin', 'bid_host', 'staff')
  getMethods() {
    return this.procurementsService.getProcurementMethods();
  }

  @Get(':id')
  @Roles('leader', 'admin', 'bid_host', 'staff')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const scope = await this.companyScope.resolveScope(user);
    return this.procurementsService.findOne(id, user, this.companyScope.filter(scope));
  }

  @Post()
  @Roles('leader', 'admin', 'bid_host', 'staff')
  async create(
    @Body() createDto: CreateProcurementRoundDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const stamp = await this.companyScope.stampFor(user);
    return this.procurementsService.create(createDto, user.sub, stamp);
  }

  @Put(':id')
  @Roles('leader', 'admin', 'bid_host', 'staff')
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateProcurementRoundDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const scope = await this.companyScope.resolveScope(user);
    return this.procurementsService.update(id, updateDto, user, this.companyScope.filter(scope));
  }

  @Post(':id/recycle')
  @Roles('leader', 'admin', 'bid_host', 'staff')
  async moveToRecycleBin(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const scope = await this.companyScope.resolveScope(user);
    return this.procurementsService.moveToRecycleBin(id, user, this.companyScope.filter(scope));
  }

  @Post(':id/restore')
  @Roles('leader', 'admin', 'bid_host', 'staff')
  async restoreFromRecycleBin(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const scope = await this.companyScope.resolveScope(user);
    return this.procurementsService.restoreFromRecycleBin(id, user, this.companyScope.filter(scope));
  }

  @Delete(':id')
  @Roles('leader', 'admin', 'bid_host', 'staff')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const scope = await this.companyScope.resolveScope(user);
    return this.procurementsService.remove(id, user, this.companyScope.filter(scope));
  }
}
