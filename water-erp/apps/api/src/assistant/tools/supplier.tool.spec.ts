import { SupplierTool } from './supplier.tool';

/** 2026-11-04：首个 spec——detail 联系人 PII 明文出口须留审计痕（用户裁定
 *  「可以明文，若调用也需要留痕」）；list keyword 按名检索（此前按名提问查无此人）。 */
function makeTool() {
  const audit = { log: jest.fn().mockResolvedValue({}) };
  const prisma: any = {
    supplier: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockImplementation(({ by }: any) =>
        by[0] === 'status'
          ? Promise.resolve([
              { status: 'APPROVED', _count: 8 },
              { status: 'BLACKLIST', _count: 1 },
            ])
          : by[0] === 'industry'
            ? Promise.resolve([
                { industry: '专业技术服务业', _count: 6 },
                { industry: null, _count: 3 },
              ])
            : Promise.resolve([{ enterpriseType: '私营企业', _count: 5 }])),
    },
    procurementRound: { findMany: jest.fn().mockResolvedValue([{ awardedSupplierName: 'A' }, { awardedSupplierName: 'B' }]) },
  };
  return { prisma, audit, tool: new SupplierTool(prisma, audit as never) };
}

const LEADER = { user: { sub: 'u-1', role: 'leader', companyId: 'co-1' } };

it('detail：联系人 PII 明文出口 + AuditLog 留痕（谁经水叮当看了哪家）', async () => {
  const { prisma, audit, tool } = makeTool();
  prisma.supplier.findUnique.mockResolvedValue({
    id: 'sup-1',
    name: '重庆蜀通岩土工程有限公司',
    contacts: [{ name: '张三', phone: 'SM4::xxx', email: 'SM4::yyy', isPrimary: true }],
  });
  const r = await tool.execute({ action: 'detail', supplierId: 'sup-1' }, LEADER);
  expect(r.success).toBe(true);
  expect(audit.log).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: 'u-1',
      action: '水叮当明文查看供应商联系人',
      resourceType: 'supplier',
      resourceId: 'sup-1',
      details: expect.objectContaining({ via: 'assistant-supplier-detail' }),
    }),
  );
});

it('detail：留痕失败不阻断问答（best-effort）', async () => {
  const { prisma, audit, tool } = makeTool();
  prisma.supplier.findUnique.mockResolvedValue({
    id: 'sup-2', name: 'X', contacts: [{ name: '李四', phone: 'SM4::a', email: 'SM4::b' }],
  });
  audit.log.mockRejectedValue(new Error('审计库抖动'));
  const r = await tool.execute({ action: 'detail', supplierId: 'sup-2' }, LEADER);
  expect(r.success).toBe(true);
});

it('stats：多维度——概览/状态/行业/企业类型四卡（含风险与成交家数）', async () => {
  const { tool } = makeTool();
  const r = await tool.execute({ action: 'stats' }, LEADER);
  const cards = r.cards as Array<Record<string, unknown>>;
  expect(cards.map((c) => c.title)).toEqual([
    '供应商资源概览',
    '供应商状态分布',
    '行业分布（注册国民经济行业）',
    '企业类型分布',
  ]);
  const metrics = Object.fromEntries((cards[0].metrics as Array<{ label: string; value: string }>).map((m) => [m.label, m.value]));
  expect(metrics['已入库']).toBe('8');
  expect(metrics['风险（停用+黑名单）']).toBe('1');
  expect(metrics['有成交记录']).toBe('2');
  const industryRows = cards[2].rows as Array<Record<string, unknown>>;
  expect(industryRows[1]).toMatchObject({ industry: '未登记', count: 3 });
});

it('list：keyword 名称检索 + 出卡（此前裸 data 无卡、按名提问查无此人）', async () => {
  const { prisma, tool } = makeTool();
  prisma.supplier.findMany.mockResolvedValue([
    { id: 's1', name: '重庆蜀通岩土工程有限公司', status: 'APPROVED', enterpriseType: '有限公司', industry: '建筑业' },
  ]);
  const r = await tool.execute({ action: 'list', keyword: '蜀通' }, LEADER);
  expect(prisma.supplier.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ name: { contains: '蜀通' } }) }),
  );
  const card = (r.cards as Array<Record<string, unknown>>)[0];
  expect(card.title).toBe('供应商清单（1家）');
  expect((card.rows as Array<Record<string, string>>)[0].status).toBe('已入库');
});
