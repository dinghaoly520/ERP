import { StageComplianceConfigService } from './stage-compliance-config.service';

/** C4 阶段合规规则配置化：DB 覆盖层 + 内置表回退 */
describe('StageComplianceConfigService（C4）', () => {
  const builtinCheckpoint = { name: '需求明确性', dimension: '需求论证', criteria: '内置判据', regulationRef: '内置依据' };

  const mk = (rows: any[] = []) => ({
    stageComplianceRule: {
      // 模拟 DB 层 where 过滤（enabled/stageKey）
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(rows.filter(r =>
          (where?.stageKey === undefined || r.stageKey === where.stageKey)
          && (where?.enabled === undefined || r.enabled === where.enabled),
        )),
      ),
      upsert: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 'r1' }),
      findUnique: jest.fn().mockResolvedValue({ id: 'r1', stageKey: 'TENDER_DOCUMENT', name: 'x' }),
    },
  });

  it('DB 有 enabled 行 → 用 DB 规则（source=db）', async () => {
    const prisma = mk([
      { stageKey: 'TENDER_DOCUMENT', name: 'DB规则', dimension: 'd', criteria: 'c', regulationRef: 'r', enabled: true, sortOrder: 2 },
      { stageKey: 'TENDER_DOCUMENT', name: '停用规则', dimension: 'd', criteria: 'c', regulationRef: 'r', enabled: false, sortOrder: 1 },
    ]);
    const { checkpoints, source } = await new StageComplianceConfigService(prisma as any).getRules('TENDER_DOCUMENT');
    expect(source).toBe('db');
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]).toMatchObject({ name: 'DB规则' });
  });

  it('DB 空 → 回退内置表（source=builtin，字段齐全）', async () => {
    const prisma = mk([]);
    const { checkpoints, source } = await new StageComplianceConfigService(prisma as any).getRules('PROCUREMENT_DEMAND');
    expect(source).toBe('builtin');
    expect(checkpoints.length).toBeGreaterThan(3);
    expect(checkpoints[0]).toMatchObject({ name: expect.any(String), dimension: expect.any(String), criteria: expect.any(String), regulationRef: expect.any(String) });
  });

  it('未知 stageKey → 空数组不抛错', async () => {
    const { checkpoints, source } = await new StageComplianceConfigService(mk() as any).getRules('NOPE');
    expect(source).toBe('builtin');
    expect(checkpoints).toHaveLength(0);
  });

  it('initFromBuiltin 按内置表逐项幂等 upsert', async () => {
    const prisma = mk();
    const r = await new StageComplianceConfigService(prisma as any).initFromBuiltin('PROCUREMENT_DEMAND');
    expect(r.imported).toBeGreaterThan(0);
    expect(prisma.stageComplianceRule.upsert).toHaveBeenCalledTimes(r.imported);
    expect(prisma.stageComplianceRule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { stageKey_name: { stageKey: 'PROCUREMENT_DEMAND', name: expect.any(String) } } }),
    );
  });

  it('update：跨阶段规则仍按 id 更新（仅改传入字段）', async () => {
    const prisma = mk();
    await new StageComplianceConfigService(prisma as any).update('r1', { enabled: false, criteria: '新判据' });
    expect(prisma.stageComplianceRule.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { enabled: false, criteria: '新判据' },
    });
  });
});
