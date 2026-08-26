import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { STAGE_COMPLIANCE_RULES, type StageComplianceCheckpoint } from './stage-compliance-rules';

/**
 * C4 阶段合规规则配置化：DB 覆盖层。
 * - 某阶段存在 enabled 行 → 用 DB 规则（在线可改判据/停用单项）
 * - DB 无行 → 回退内置代码表（stage-compliance-rules.ts，零迁移兼容存量）
 * 内置表来自《采购管理办法（修订）》及国家/省级法规，初始化=按内置表幂等 upsert。
 */
@Injectable()
export class StageComplianceConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getRules(stageKey: string): Promise<{ checkpoints: StageComplianceCheckpoint[]; source: 'db' | 'builtin' }> {
    const rows = await this.prisma.stageComplianceRule.findMany({
      where: { stageKey, enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    if (rows.length > 0) {
      return {
        checkpoints: rows.map(r => ({
          name: r.name,
          dimension: r.dimension,
          criteria: r.criteria,
          regulationRef: r.regulationRef,
        })),
        source: 'db',
      };
    }
    return { checkpoints: STAGE_COMPLIANCE_RULES[stageKey] ?? [], source: 'builtin' };
  }

  /** 维护页：列出某阶段全部行（含停用），空则给内置快照供展示 */
  async listForStage(stageKey: string) {
    const rows = await this.prisma.stageComplianceRule.findMany({
      where: { stageKey },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    if (rows.length > 0) return { source: 'db' as const, rows };
    return {
      source: 'builtin' as const,
      rows: (STAGE_COMPLIANCE_RULES[stageKey] ?? []).map((c, i) => ({
        id: `builtin:${stageKey}:${i}`,
        stageKey,
        ...c,
        enabled: true,
        sortOrder: i,
      })),
    };
  }

  /** 从内置表初始化/补齐 DB 覆盖层（幂等 upsert，不动已存在同名项） */
  async initFromBuiltin(stageKey?: string) {
    const keys = stageKey ? [stageKey] : Object.keys(STAGE_COMPLIANCE_RULES);
    let imported = 0;
    for (const key of keys) {
      const checkpoints = STAGE_COMPLIANCE_RULES[key] ?? [];
      for (let i = 0; i < checkpoints.length; i++) {
        const c = checkpoints[i];
        await this.prisma.stageComplianceRule.upsert({
          where: { stageKey_name: { stageKey: key, name: c.name } },
          create: { stageKey: key, name: c.name, dimension: c.dimension, criteria: c.criteria, regulationRef: c.regulationRef, sortOrder: i },
          update: {}, // 已存在不改——保留人工修改
        });
        imported += 1;
      }
    }
    return { imported, stages: keys.length };
  }

  /** 在线修改：criteria/regulationRef/enabled/dimension */
  async update(id: string, patch: { dimension?: string; criteria?: string; regulationRef?: string; enabled?: boolean }) {
    if (id.startsWith('builtin:')) {
      throw new BadRequestException({ error: '内置规则未入库，请先「从内置初始化」再编辑', code: 'BUILTIN_NOT_IMPORTED' });
    }
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException({ error: '无可更新字段', code: 'EMPTY_PATCH' });
    }
    const exists = await this.prisma.stageComplianceRule.findUnique({ where: { id } });
    if (!exists) throw new BadRequestException({ error: '规则不存在', code: 'NOT_FOUND' });
    return this.prisma.stageComplianceRule.update({ where: { id }, data: patch });
  }
}
