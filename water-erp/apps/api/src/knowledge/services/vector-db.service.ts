import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

/**
 * 向量检索专用 pg 连接池。
 * 目标库选择（回退链）：
 *   1. VECTOR_DATABASE_URL —— sidecar 形态（金仓主库 + pgvector sidecar）
 *   2. DIRECT_URL          —— 纯 PG 形态直连主库（绕开 pgbouncer：
 *                             node-postgres 参数化查询走扩展协议，与 transaction 池不兼容）
 *   3. DATABASE_URL        —— 最后兜底
 */
@Injectable()
export class VectorDbService implements OnModuleDestroy {
  private readonly logger = new Logger(VectorDbService.name);
  private pool: Pool | null = null;

  readonly connectionString: string;
  readonly sourceLabel: string;

  constructor(config: ConfigService) {
    const explicit = config.get<string>('VECTOR_DATABASE_URL');
    const direct = config.get<string>('DIRECT_URL');
    const primary = config.get<string>('DATABASE_URL');
    if (explicit) {
      this.connectionString = explicit;
      this.sourceLabel = 'VECTOR_DATABASE_URL(sidecar)';
    } else if (direct) {
      this.connectionString = direct;
      this.sourceLabel = 'DIRECT_URL(主库直连)';
    } else {
      this.connectionString = primary ?? '';
      this.sourceLabel = 'DATABASE_URL';
    }
  }

  getPool(): Pool {
    if (!this.pool) {
      this.pool = new Pool({ connectionString: this.connectionString, max: 5 });
      this.logger.log(
        `Vector DB → ${this.describeTarget()} [${this.sourceLabel}]`,
      );
    }
    return this.pool;
  }

  /** 日志脱敏：只输出 host:port/db，绝不含密码 */
  describeTarget(): string {
    try {
      const u = new URL(this.connectionString);
      return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
    } catch {
      return '(unparsable)';
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}
