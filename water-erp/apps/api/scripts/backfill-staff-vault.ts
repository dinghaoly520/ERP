/** 一次性回填（2026-09-14）：工作人员（INTERNAL_ROLES）vault = `<用户名>@2026`（seed 口令约定）。 */
import { PrismaClient } from '@prisma/client';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const p = new PrismaClient();
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const secret = env.match(/PASSWORD_VIEW_SECRET=(\S+)/)?.[1];
if (!secret) throw new Error('PASSWORD_VIEW_SECRET 不在 .env');
const key = createHash('sha256').update(secret).digest();
const enc = (plain: string) => {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${data.toString('base64')}`;
};

const main = async () => {
  const users = await p.user.findMany({
    where: { role: { in: ['admin', 'leader', 'staff', 'bid_host'] } },
    select: { id: true, username: true },
  });
  for (const u of users) {
    await p.user.update({ where: { id: u.id }, data: { passwordVault: enc(`${u.username}@2026`) } });
  }
  console.log(`回填完成：${users.length} 个工作人员账号`);
  await p.$disconnect();
};
main().catch((e) => { console.error(e); process.exit(1); });
