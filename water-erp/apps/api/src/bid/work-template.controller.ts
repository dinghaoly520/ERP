import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { WorkTemplateService } from './work-template.service';

/** W8（CTS A-115/A-147）：开标记录/评标模板维护（staff/leader/admin） */
@ApiTags('模板管理')
@Controller('work-templates')
@Roles('staff', 'leader', 'admin')
export class WorkTemplateController {
  constructor(private readonly svc: WorkTemplateService) {}

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

  /** A-115：删除模板（生效中禁删——监管导出正在使用） */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
