import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { WorkTemplateService } from './work-template.service';
import { BidOpeningRecordService } from './bid-opening-record.service';

/** W8（CTS A-115/A-147）：开标记录/评标模板维护（staff/leader/admin） */
@ApiTags('模板管理')
@Controller('work-templates')
@Roles('staff', 'leader', 'admin')
export class WorkTemplateController {
  constructor(
    private readonly svc: WorkTemplateService,
    private readonly openingRecords: BidOpeningRecordService,
  ) {}

  @Get(':kind')
  list(@Param('kind') kind: string) {
    return this.svc.listForKind(kind);
  }

  @Get(':kind/active')
  active(@Param('kind') kind: string) {
    return this.svc.activeForKind(kind);
  }

  @Post()
  create(@Body() body: { kind: string; name: string; content: object }, @CurrentUser('sub') userId?: string) {
    return this.svc.create(body.kind, body.name, body.content, userId);
  }

  @Post(':id/activate')
  activate(@Param('id') id: string) {
    return this.svc.activate(id);
  }

  /** A-115：修改模板（name/content；kind 不可改） */
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { name?: string; content?: object }) {
    return this.svc.update(id, body);
  }

  /** A-113：把开标记录模板的唱标字段配置应用到项目（写 BidProject.openingFieldConfig，
   *  与 PUT /bid/projects/:id/opening-field-config 复用同一写径/阶段闸——开标开始后 409 锁定） */
  @ApiOperation({ summary: 'A-113：开标记录模板的唱标字段配置应用到项目（开标开始后锁定）' })
  @Post(':id/apply/:projectId')
  async apply(@Param('id') id: string, @Param('projectId') projectId: string, @CurrentUser('sub') userId?: string) {
    const { fields, name } = await this.svc.getOpeningFieldsFromTemplate(id);
    return this.openingRecords.setOpeningFieldConfig(projectId, fields, userId, `模板「${name}」`);
  }

  /** A-115：删除模板（生效中禁删——监管导出正在使用） */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
