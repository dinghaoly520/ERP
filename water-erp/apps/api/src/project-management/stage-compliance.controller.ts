import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { StageComplianceConfigService } from './stage-compliance-config.service';
import { STAGE_COMPLIANCE_RULES } from './stage-compliance-rules';

/** C4 阶段合规规则维护（:3005「合规规则」页数据源；leader/admin） */
@ApiTags('阶段合规规则')
@Controller('stage-compliance')
@Roles('leader', 'admin')
export class StageComplianceController {
  constructor(private readonly config: StageComplianceConfigService) {}

  @Get('stages')
  @ApiOperation({ summary: '可配置阶段清单（内置表全部 stageKey）' })
  stages() {
    // 复用内置表键序，避免额外依赖
    return Object.keys(STAGE_COMPLIANCE_RULES);
  }

  @Get('rules')
  @ApiOperation({ summary: '某阶段规则（含停用；DB 空则返回内置快照 source=builtin）' })
  rules(@Query('stageKey') stageKey: string) {
    return this.config.listForStage(stageKey);
  }

  @Post('init')
  @ApiOperation({ summary: '从内置表初始化 DB 覆盖层（幂等，不动已存在项）' })
  init(@Query('stageKey') stageKey?: string) {
    return this.config.initFromBuiltin(stageKey);
  }

  @Patch('rules/:id')
  @ApiOperation({ summary: '修改规则（判据/依据/维度/启停）' })
  update(@Param('id') id: string, @Body() body: { dimension?: string; criteria?: string; regulationRef?: string; enabled?: boolean }) {
    return this.config.update(id, body);
  }
}
