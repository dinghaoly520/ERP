/** 一次性回填（2026-09-14）：存量供应商账号 vault=supplier@2026 + 归属勘测设计。ts run 后可删。 */
import { PrismaClient } from '@prisma/client';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const p = new PrismaClient();
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const m = env.match(/PASSWORD_VIEW_SECRET=(\S+)/);
if (!m) throw new Error('PASSWORD_VIEW_SECRET 不在 .env');
const key = createHash('sha256').update(m[1]).digest();
const enc = (plain: string) => {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${data.toString('base64')}`;
};

const main = async () => {
  const company = await p.company.findUnique({ where: { name: '四川水发勘测设计研究有限公司' } });
  if (!company) throw new Error('勘测设计公司不在主数据');
  const vault = enc('supplier@2026');
  const users = await p.user.findMany({ where: { role: 'supplier' }, select: { id: true } });
  for (const u of users) {
    await p.user.update({ where: { id: u.id }, data: { passwordVault: vault } });
    await p.supplier.updateMany({ where: { userId: u.id }, data: { companyId: company.id, companyName: company.name } });
  }
  console.log(`回填完成：${users.length} 个供应商账号（vault + 归属 ${company.name}）`);
  await p.$disconnect();
};
main().catch((e) => { console.error(e); process.exit(1); });
