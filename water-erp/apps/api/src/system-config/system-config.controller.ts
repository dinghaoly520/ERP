import { Controller, Get, Put, Body, Inject, Request } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { OcrService } from '../local-ai/ocr.service';
import { QUEUE_NAMES } from '../ai-bid-analysis/queues/queue.module';
import { SystemConfigService } from './system-config.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { UpdateConfigDto } from './dto/update-config.dto';

@ApiTags('系统配置')
@Controller('system-config')
export class SystemConfigController {
  constructor(
    private configService: SystemConfigService,
    private prisma: PrismaService,
    @Inject('REDIS_CLIENT') private redis: { ping(): Promise<string> },
    private storage: StorageService,
    private ocr: OcrService,
    @InjectQueue(QUEUE_NAMES.TENDER_PROCESSING) private tenderQueue: Queue,
    @InjectQueue(QUEUE_NAMES.BIDDER_PROCESSING) private bidderQueue: Queue,
  ) {}

  /** D6（CTS 4.7~4.11 自我声明支撑）：组件探活 + 24h 接口指标 + AI 队列深度 */
  @Get('health')
  @Roles('admin', 'leader')
  @ApiOperation({ summary: '系统健康：DB/Redis/MinIO/OCR 探活 + 接口 P95/错误率 + 队列深度' })
  async health() {
    const probe = async (fn: () => Promise<unknown>) => {
      const t0 = Date.now();
      try { await fn(); return { ok: true, latencyMs: Date.now() - t0 }; }
      catch (e) { return { ok: false, latencyMs: Date.now() - t0, error: (e as Error).message }; }
    };
    const [db, redis, minio, ocr] = await Promise.all([
      probe(() => this.prisma.$queryRaw`SELECT 1`),
      probe(() => this.redis.ping()),
      probe(() => this.storage.ensureBucket()),
      probe(() => this.ocr.isAvailable()),
    ]);
    const [api24h, tenderCounts, bidderCounts] = await Promise.all([
      this.prisma.$queryRaw<Array<{ total: number; errors: number; p95ms: number }>>`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE "statusCode" >= 400)::int AS errors,
               COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs"), 0)::int AS p95ms
        FROM "OperationLog" WHERE "createdAt" > now() - interval '24 hours'`,
      this.tenderQueue.getJobCounts('waiting', 'active', 'failed').catch(() => null),
      this.bidderQueue.getJobCounts('waiting', 'active', 'failed').catch(() => null),
    ]);
    const agg = api24h[0] ?? { total: 0, errors: 0, p95ms: 0 };
    return {
      checkedAt: new Date().toISOString(),
      components: { db, redis, minio, ocr: { ...ocr, label: 'OCR(:8100)' } },
      api24h: {
        ...agg,
        errorRate: agg.total > 0 ? Math.round((agg.errors / agg.total) * 10000) / 100 : 0,
      },
      queues: {
        tenderProcessing: tenderCounts,
        bidderProcessing: bidderCounts,
      },
    };
  }

  /** D6：30 天自声明数据包（性能/可靠性佐证，CTS 认证自我声明材料） */
  @Get('health/self-assessment')
  @Roles('admin')
  @ApiOperation({ summary: '30 天性能/可靠性自声明数据包（JSON 下载）' })
  async selfAssessment() {
    const agg30d = await this.prisma.$queryRaw<Array<{ total: number; errors: number; p95ms: number; p99ms: number; avgms: number }>>`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE "statusCode" >= 400)::int AS errors,
             COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs"), 0)::int AS p95ms,
             COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY "durationMs"), 0)::int AS p99ms,
             COALESCE(AVG("durationMs"), 0)::int AS avgms
      FROM "OperationLog" WHERE "createdAt" > now() - interval '30 days'`;
    const a = agg30d[0] ?? { total: 0, errors: 0, p95ms: 0, p99ms: 0, avgms: 0 };
    return {
      生成依据: 'CTS-EBS01-2016 4.7 性能 / 4.9 可靠性 —— 交易平台自我声明佐证数据',
      统计窗口: '近 30 天（OperationLog 全量请求）',
      请求总数: a.total,
      错误数: a.errors,
      错误率: a.total > 0 ? `${Math.round((a.errors / a.total) * 10000) / 100}%` : '0%',
      平均耗时ms: a.avgms,
      P95耗时ms: a.p95ms,
      P99耗时ms: a.p99ms,
      运行环境: {
        nodeVersion: process.version,
        platform: `${process.platform}/${process.arch}`,
        env: process.env.NODE_ENV ?? 'development',
      },
      生成时间: new Date().toISOString(),
    };
  }

  // 澄清说明文案：供应商端公开读取（非敏感信息，与公告 public 端点一致）
  @Get('clarification-notice')
  @Public()
  @ApiOperation({ summary: '澄清说明文案（公开）' })
  async getClarificationNotice() {
    const row = await this.configService.get('supplier_clarification_notice');
    return { value: row?.value ?? '' };
  }

  // 编辑发布澄清说明文案：仅采购管理方
  @Put('clarification-notice')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '编辑发布澄清说明文案' })
  async updateClarificationNotice(@Body() dto: UpdateConfigDto, @Request() req: any) {
    return this.configService.set('supplier_clarification_notice', dto.value, req.user?.sub);
  }
}
