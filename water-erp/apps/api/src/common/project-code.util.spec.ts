import { generateProjectCode, resolveHostedProjectCode } from './project-code.util';

/** 最小 Prisma 替身：编号生成只用到 company.findUnique / <table>.count / <table>.findUnique */
function makePrisma(overrides?: {
  companyCode?: string | null;
  todayCount?: number;
  takenCodes?: string[];
}) {
  const taken = new Set(overrides?.takenCodes ?? []);
  const prisma: any = {
    company: {
      findUnique: jest.fn().mockResolvedValue(
        overrides?.companyCode == null ? null : { code: overrides.companyCode },
      ),
    },
  };
  for (const table of ['bidProject', 'procurementProject', 'projectManagementItem']) {
    prisma[table] = {
      count: jest.fn().mockResolvedValue(overrides?.todayCount ?? 0),
      findUnique: jest.fn(({ where }: any) =>
        where?.projectCode && taken.has(where.projectCode) ? { id: 'dup' } : null,
      ),
    };
  }
  return prisma;
}

function todayYmd(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

describe('generateProjectCode（三段式统一编号空间，2026-10-19 用户裁定）', () => {
  it('无公司上下文 → SW 回退段：SW-JJ-YYYYMMDD01', async () => {
    const code = await generateProjectCode(makePrisma(), '竞价采购');
    expect(code).toBe(`SW-JJ-${todayYmd()}01`);
  });

  it('有公司上下文 → 公司编码段：SWHI-JJ-YYYYMMDD01', async () => {
    const code = await generateProjectCode(makePrisma({ companyCode: 'SWHI' }), '竞价采购', 'bidProject', { companyId: 'co-1' });
    expect(code).toBe(`SWHI-JJ-${todayYmd()}01`);
    // 公司编码经 Company.code 解析（trim + 大写）
    expect(code.startsWith('SWHI-')).toBe(true);
  });

  it('序号冲突顺延（01 被占 → 02）', async () => {
    const prisma = makePrisma({ companyCode: 'SWHI', takenCodes: [`SWHI-JJ-${todayYmd()}01`] });
    const code = await generateProjectCode(prisma, '竞价采购', 'bidProject', { companyId: 'co-1' });
    expect(code).toBe(`SWHI-JJ-${todayYmd()}02`);
  });

  it('procurementProject 表同规则（预算转询价单）', async () => {
    const code = await generateProjectCode(makePrisma({ companyCode: 'SWHI' }), '公开招标', 'procurementProject', { companyId: 'co-1' });
    expect(code).toBe(`SWHI-GK-${todayYmd()}01`);
  });
});

describe('resolveHostedProjectCode（PMI 宿主继承，多轮 -Rn 防唯一冲突）', () => {
  it('基础编号空闲 → 原样继承 PMI 业务编号', async () => {
    const code = await resolveHostedProjectCode(makePrisma(), { pmiCode: 'SWHI-JJ-2026101901' });
    expect(code).toBe('SWHI-JJ-2026101901');
  });

  it('基础编号已被首轮占用 → 第二轮得 -R2', async () => {
    const prisma = makePrisma({ takenCodes: ['SWHI-JJ-2026101901'] });
    const code = await resolveHostedProjectCode(prisma, { pmiCode: 'SWHI-JJ-2026101901' });
    expect(code).toBe('SWHI-JJ-2026101901-R2');
  });

  it('指定 preferredRound=3 且 -R3 空闲 → -R3（重招轮次直取）', async () => {
    const prisma = makePrisma({ takenCodes: ['SWHI-JJ-2026101901', 'SWHI-JJ-2026101901-R2'] });
    const code = await resolveHostedProjectCode(prisma, { pmiCode: 'SWHI-JJ-2026101901', preferredRound: 3 });
    expect(code).toBe('SWHI-JJ-2026101901-R3');
  });

  it('preferredRound 起点被占 → 顺延 -R(n+1)', async () => {
    const prisma = makePrisma({ takenCodes: ['SWHI-JJ-2026101901', 'SWHI-JJ-2026101901-R2'] });
    const code = await resolveHostedProjectCode(prisma, { pmiCode: 'SWHI-JJ-2026101901', preferredRound: 2 });
    expect(code).toBe('SWHI-JJ-2026101901-R3');
  });

  it('候选耗尽 → ConflictException（与序号耗尽同语义）', async () => {
    const taken = ['SWHI-JJ-2026101901'];
    for (let n = 2; n <= 201; n++) taken.push(`SWHI-JJ-2026101901-R${n}`);
    await expect(
      resolveHostedProjectCode(makePrisma({ takenCodes: taken }), { pmiCode: 'SWHI-JJ-2026101901' }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
