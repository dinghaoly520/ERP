import { Module, forwardRef } from '@nestjs/common';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';
import { AuthModule } from '../auth/auth.module';
import { AiModule } from '../ai/ai.module';

@Module({
  // AiModule 亦 import 本模块（MobileBriefService 依赖 ProgressService，今日要报最堵阶段输入）
  // ——环引用两侧 forwardRef，否则启动期模块实例解析失败
  imports: [AuthModule, forwardRef(() => AiModule)],
  controllers: [ProgressController],
  providers: [ProgressService],
  exports: [ProgressService],
})
export class ProgressModule {}
