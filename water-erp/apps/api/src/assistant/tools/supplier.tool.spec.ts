import { SupplierTool } from './supplier.tool';

/** 2026-11-04：首个 spec——detail 联系人 PII 明文出口须留审计痕（用户裁定
 *  「可以明文，若调用也需要留痕」）；list keyword 按名检索（此前按名提问查无此人）。 */
function makeTool() {
  const audit = { log: jest.fn().mockResolvedValue({}) };
  const prisma: any = {
    supplier: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
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
