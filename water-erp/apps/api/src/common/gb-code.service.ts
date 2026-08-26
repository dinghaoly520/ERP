import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildGbProjectCode, buildGbProcureCode, buildGbSectionCode } from '@water-erp/shared';

/**
 * A1（GB/T 43711 B.4）：国标组合码分配服务。
 * 平台参数存 SystemConfig key=gb_code_config（{industryCode, regionCode, platformSeq}），
 * 未配置时用默认占位（水利行业 511 / 四川 51 / 平台序列 0000）——对接公共服务平台拿到正式码后替换即可。
 * 序列分配：同平台同日按现有编码计数递增（轻量，无需独立序列表）。
 */
@Injectable()
export class GbCodeService {
  private static readonly CONFIG_KEY = 'gb_code_config';
  private static readonly DEFAULTS = { industryCode: '511', regionCode: '51', platformSeq: '0000' };

  constructor(private prisma: PrismaService) {}

  private async config() {
    const row = await this.prisma.systemConfig.findUnique({ where: { key: GbCodeService.CONFIG_KEY } });
    return { ...GbCodeService.DEFAULTS, ...((row?.value as any) ?? {}) };
  }

  private async nextSeq(model: 'pmi' | 'bid', field: 'gbProjectCode' | 'gbProcureCode', prefix: string): Promise<number> {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    const where = { [field]: { startsWith: prefix } } as any;
    const scoped = model === 'pmi'
      ? { ...where, createdAt: { gte: start, lte: end } }
      : where; // 21 位前缀含日期，无须再限日
    const count = model === 'pmi'
      ? await this.prisma.projectManagementItem.count({ where: scoped })
      : await this.prisma.bidProject.count({ where: scoped });
    return Math.min(count + 1, 999);
  }

  /** 分配项目编码（18 位）——PMI 建项时调用 */
  async allocateProjectCode(): Promise<string> {
    const cfg = await this.config();
    const now = new Date();
    const ymd = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const prefix = `${cfg.industryCode}${cfg.regionCode}${cfg.platformSeq}${ymd}`;
    const seq = await this.nextSeq('pmi', 'gbProjectCode', prefix);
    return buildGbProjectCode({ ...cfg, date: now, projectSeq: seq });
  }

  /** 分配采购项目编码（21 位）——BidProject 建项时调用；有 PMI 宿主则复用其 18 位码 */
  async allocateProcureCode(pmGbCode?: string | null): Promise<{ gbProcureCode: string; gbSectionCode: string }> {
    let base18 = pmGbCode ?? null;
    if (!base18) base18 = await this.allocateProjectCode();
    const seq = await this.nextSeq('bid', 'gbProcureCode', base18);
    const gbProcureCode = buildGbProcureCode(base18, seq);
    return { gbProcureCode, gbSectionCode: buildGbSectionCode(gbProcureCode, 1) };
  }
}
