import { Controller, Get, Put, Delete, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AUTHENTICATED_ROLES } from '../auth/auth-scope';
import { Roles } from '../common/decorators/roles.decorator';
import { DraftService } from './draft.service';

/** 用户向导草稿（跨设备续作）：供应商邀请等向导的进行中状态按账号持久化。 */
@ApiTags('用户草稿')
@Controller('drafts')
@Roles(...AUTHENTICATED_ROLES)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class DraftController {
  constructor(private readonly draft: DraftService) {}

  @Get(':key')
  @ApiOperation({ summary: '读取草稿（无草稿返回 null）' })
  async get(@Param('key') key: string, @CurrentUser() user: AuthenticatedUser) {
    return this.draft.get(user.sub, key);
  }

  @Put(':key')
  @ApiOperation({ summary: '保存草稿（覆盖式，登录账号维度）' })
  async put(@Param('key') key: string, @Body() body: { payload?: unknown }, @CurrentUser() user: AuthenticatedUser) {
    return this.draft.put(user.sub, key, body?.payload ?? null);
  }

  @Delete(':key')
  @ApiOperation({ summary: '删除草稿（向导完成/重置时清理）' })
  async remove(@Param('key') key: string, @CurrentUser() user: AuthenticatedUser) {
    return this.draft.remove(user.sub, key);
  }
}
