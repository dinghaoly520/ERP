import { Controller, Get, Query, Param, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { OperationLogService } from './operation-log.service';
import type { OperationLogQuery } from './operation-log.types';

@ApiTags('操作日志')
@Controller('operation-log')
export class OperationLogController {
  constructor(private readonly service: OperationLogService) {}

  @Get()
  @Roles('admin', 'bid_host')
  @ApiOperation({ summary: '查询全部操作日志（admin/bid_host）' })
  async findAll(@Query() q: OperationLogQuery) {
    return this.service.findAll(this.normalize(q));
  }

  @Get('archive')
  @Roles('admin')
  @ApiOperation({ summary: '操作日志归档清单（P1-12 法定留存，admin）' })
  async listArchives() {
    return this.service.listArchives();
  }

  @Get('archive/verify/:month')
  @Roles('admin')
  @ApiOperation({ summary: '操作日志归档完整性验证（sha256 比对，admin）' })
  async verifyArchive(@Param('month') month: string) {
    if (!/^\d{4}_\d{2}$/.test(month)) {
      throw new BadRequestException({ error: '月份格式应为 YYYY_MM', code: 'INVALID_MONTH' });
    }
    try {
      return await this.service.verifyArchive(month);
    } catch (err) {
      if ((err as Error).message === 'ARCHIVE_NOT_FOUND') {
        throw new BadRequestException({ error: '该月无归档清单', code: 'ARCHIVE_NOT_FOUND' });
      }
      throw err;
    }
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
