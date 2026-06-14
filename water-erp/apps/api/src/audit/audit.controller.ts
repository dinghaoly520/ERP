import { Controller, Get, Request } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from './audit.service';

@ApiTags('操作审计')
@ApiCookieAuth('token')
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({ summary: '我的操作记录' })
  async list(@Request() req: any) {
    return this.auditService.list(req.user.sub);
  }
}
