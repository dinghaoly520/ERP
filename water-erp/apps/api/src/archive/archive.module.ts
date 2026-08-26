import { Module, OnModuleInit } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { ArchiveScopeService } from './archive-scope.service';
import { ArchiveCheckService } from './archive-check.service';
import { ArchiveExportService } from './archive-export.service';
import { ArchiveFlowService } from './archive-flow.service';
import { ApprovalTrailExporter } from './approval-trail.exporter';
import { ArchiveController } from './archive.controller';

@Module({
  imports: [NotificationModule],
  controllers: [ArchiveController],
  providers: [ArchiveScopeService, ArchiveCheckService, ArchiveExportService, ArchiveFlowService, ApprovalTrailExporter],
  exports: [ArchiveScopeService, ArchiveFlowService],
})
export class ArchiveModule implements OnModuleInit {
  constructor(private readonly scope: ArchiveScopeService) {}
  async onModuleInit() {
    await this.scope.ensureSeeded().catch(() => undefined); // 播种失败不阻断启动（首请求时重试）
  }
}
