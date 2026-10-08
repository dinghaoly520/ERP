import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const s = await p.supplier.findFirst({ where: { name: '测试待审核供应商甲' }, select: { id: true, userId: true } });
if (s) {
    await p.supplier.delete({ where: { id: s.id } });
    if (s.userId)
        await p.user.delete({ where: { id: s.userId } }).catch(() => { });
    console.log('测试数据已清理');
}
await p.$disconnect();
//# sourceMappingURL=q.mjs.map