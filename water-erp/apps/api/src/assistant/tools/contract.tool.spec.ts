import { ContractTool } from './contract.tool';

/** 2026-11-04 数据广度补齐：合同履约（定标之后此前全盲区）。dev 库合同 0 行——
 *  工具按 schema 真实字段实现，空态优雅。 */
function makeTool() {
  const prisma: any = {
    contract: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { prisma, tool: new ContractTool(prisma) };
}

const LEADER = { user: { sub: 'u-1', role: 'leader', companyId: 'co-1' } };

it('list：状态中文反查枚举键（LLM 传「已签约」）', async () => {
  const { prisma, tool } = makeTool();
  await tool.execute({ action: 'list', status: '已签约' }, LEADER);
  expect(prisma.contract.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ status: 'signed' }) }),
  );
});

it('list：未知状态友好报错列出可用值', async () => {
  const { tool } = makeTool();
  const r = await tool.execute({ action: 'list', status: ' bogus ' }, LEADER);
  expect(r.success).toBe(false);
  expect(String((r as { error?: string }).error)).toContain('可用');
});

it('list：空表 → 优雅空态卡（非报错）', async () => {
  const { tool } = makeTool();
  const r = await tool.execute({ action: 'list' }, LEADER);
  const card = (r.cards as Array<Record<string, unknown>>)[0];
  expect(card.type).toBe('metric');
  expect((card.metrics as Array<{ value: string }>)[0].value).toBe('暂无匹配合同');
});

it('signing_soon：紧急度分档（已超期/剩N天）', async () => {
  const { prisma, tool } = makeTool();
  const past = new Date(Date.now() - 2 * 86400000);
  const soon = new Date(Date.now() + 2 * 86400000);
  prisma.contract.findMany.mockResolvedValue([
    { contractCode: 'HT-001', supplierName: '甲公司', signDeadline: past, status: 'approved_for_signing' },
    { contractCode: 'HT-002', supplierName: '乙公司', signDeadline: soon, status: 'drafting' },
  ]);
  const r = await tool.execute({ action: 'signing_soon' }, LEADER);
  const rows = ((r.cards as Array<Record<string, unknown>>)[0].rows as Array<Record<string, unknown>>);
  expect(rows[0].urgency).toBe('已超期 2 天');
  expect(rows[1].urgency).toBe('剩 2 天');
});
