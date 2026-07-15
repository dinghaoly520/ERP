import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { OperationLogService } from './operation-log.service';
import type { OperationLogQuery } from './operation-log.types';

@ApiTags('操作日志')
@Controller('operation-log')
@UseGuards(AuthGuard)
export class OperationLogController {
  constructor(private readonly service: OperationLogService) {}

  @Get()
  @Roles('admin', 'bid_host')
  @ApiOperation({ summary: '查询全部操作日志（admin/bid_host）' })
  async findAll(@Query() q: OperationLogQuery) {
    return this.service.findAll(this.normalize(q));
  }

  @Get('my')
  @ApiOperation({ summary: '查询当前用户的操作日志' })
  async findMine(@CurrentUser() user: AuthenticatedUser, @Query() q: OperationLogQuery) {
    return this.service.findMine(user.sub, this.normalize(q));
  }

  /** query 参数均为字符串，按需转 number；非数字/非有限值回退 undefined（服务层补默认值） */
  private normalize(q: OperationLogQuery): OperationLogQuery {
    const toNum = (v: unknown): number | undefined => {
      if (v === undefined || v === null || v === '') return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    return {
      ...q,
      limit: toNum(q.limit),
      offset: toNum(q.offset),
      statusCode: toNum(q.statusCode),
    };
  }
}
