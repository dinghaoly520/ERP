import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Query,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ProcurementsService } from './procurements.service';
import { CreateProcurementRoundDto } from './dto/create-procurement-round.dto';
import { UpdateProcurementRoundDto } from './dto/update-procurement-round.dto';
import { QueryProcurementsDto } from './dto/query-procurements.dto';

@UseGuards(AuthGuard)
@Controller('procurements')
export class ProcurementsController {
  constructor(private readonly procurementsService: ProcurementsService) {}

  @Get()
  findAll(@Query() query: QueryProcurementsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.procurementsService.findAll(query, user);
  }

  @Get('stats')
  getStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.procurementsService.getStats(startDate, endDate, user);
  }

  @Get('methods')
  getMethods() {
    return this.procurementsService.getProcurementMethods();
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.procurementsService.findOne(id, user);
  }

  @Post()
  @Roles('leader', 'admin', 'bid_host', 'staff')
  create(
    @Body() createDto: CreateProcurementRoundDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.procurementsService.create(createDto, user.sub);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() updateDto: UpdateProcurementRoundDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.procurementsService.update(id, updateDto, user);
  }

  @Post(':id/recycle')
  moveToRecycleBin(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.procurementsService.moveToRecycleBin(id, user);
  }

  @Post(':id/restore')
  restoreFromRecycleBin(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.procurementsService.restoreFromRecycleBin(id, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.procurementsService.remove(id, user);
  }
}
