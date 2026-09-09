// apps/api/src/platform-push/platform-push.controller.ts
// 五端点（doc §四）——全部 @Roles('staff','leader','admin')：人工确认制的操作面
// （RolesGuard 默认拒绝：无 @Roles/@Public/@AnyRole 的路由 403 NO_ROLE_CONFIGURED）。
import { Body, Controller, Get, Post, Query, Req, Request } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { PlatformPushService } from './platform-push.service';
import {
  DispatchPushDto, ExportPushDto, PendingQueryDto, PreviewPushDto,
} from './dto/platform-push.dto';

@Controller('platform-push')
export class PlatformPushController {
  constructor(private readonly svc: PlatformPushService) {}

  /** 待推清单（按 383号文十类聚合项目公告/合同/全局处罚行，含映射完整度与历史推送态） */
  @Get('pending')
  @Roles('staff', 'leader', 'admin')
  pending(@Query() query: PendingQueryDto) {
    return this.svc.pending(query);
  }

  /** 预览：中间信封（脱敏后）+ 逐项 payloadHash——人工确认制第一步 */
  @Post('preview')
  @Roles('staff', 'leader', 'admin')
  preview(@Body() dto: PreviewPushDto) {
    return this.svc.preview(dto);
  }

  /** 确认推送：body 必带 preview 的 payloadHash（防预览后数据漂移）；stub 通道 501 引导离线导出 */
  @Post('dispatch')
  @Roles('staff', 'leader', 'admin')
  dispatch(@Body() dto: DispatchPushDto, @Req() req: any) {
    return this.svc.dispatch(dto, req.user?.sub);
  }

  /** 离线导出（现役主出口）：offline 通道 → 文件包+SHA-256+FileAsset（platform_push_package） */
  @Post('export')
  @Roles('staff', 'leader', 'admin')
  export(@Body() dto: ExportPushDto, @Request() req: any) {
    return this.svc.exportItems(dto, req.user?.sub);
  }

  /** 推送台账（projectId 可选：传则按项目过滤，缺省全量含全局处罚行） */
  @Get('status')
  @Roles('staff', 'leader', 'admin')
  status(@Query('projectId') projectId?: string) {
    return this.svc.status(projectId);
  }
}
