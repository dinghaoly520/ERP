import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { VisitorService } from './visitor.service';
import { CreateVisitorRegistrationDto } from './dto/create-visitor-registration.dto';

@ApiTags('visitor')
@Controller('visitor')
export class VisitorController {
  constructor(private readonly visitorService: VisitorService) {}

  /** 匿名端点：表单提交 → 通知访问单位归属公司 staff；限流 5 次/分钟防刷 */
  @Post('registrations')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: '供应商来访接待登记（通知对应公司 staff）' })
  register(@Body() dto: CreateVisitorRegistrationDto) {
    return this.visitorService.register(dto);
  }
}
