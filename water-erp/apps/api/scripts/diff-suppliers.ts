/* eslint-disable */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const p = new PrismaClient();

(async () => {
  const data: { name: string; creditCode: string | null }[] = JSON.parse(
    readFileSync(join(__dirname, 'suppliers_import.json'), 'utf-8'),
  );
  const jsonNames = new Map<string, string>(); // normalizedName -> name
  for (const s of data) jsonNames.set(s.name.trim().toLowerCase(), s.name);

  // DB normalizedNames for imported (non-demo) suppliers
  const demos = new Set(['四川川水建设工程有限公司', '成都华西物资供应有限公司']);
  const dbRows = await p.supplier.findMany({ select: { normalizedName: true, name: true } });
  const dbNames = new Set(dbRows.filter((r) => !demos.has(r.name)).map((r) => r.normalizedName));

  const missing: string[] = [];
  for (const [nname, name] of jsonNames) if (!dbNames.has(nname)) missing.push(name);
  console.log('JSON suppliers:', jsonNames.size, '| DB imported:', dbNames.size);
  console.log('Missing from DB (' + missing.length + '):');
  missing.forEach((m) => console.log('   -', m));

  // also: any DB imported name not in JSON?
  const extra = [...dbNames].filter((n) => !jsonNames.has(n));
  console.log('Extra in DB not in JSON:', extra.length);
})().finally(() => p.$disconnect());
