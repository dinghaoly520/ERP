/**
 * 水叮当「系统操作指引」共享知识库重建脚本（2026-11-04）。
 *
 * 背景：db:seed 是破坏性的（TRUNCATE 含 KnowledgeBase/DocumentChunk）——系统操作
 * 指引文档必须随仓库版本化（knowledge-seeds/*.md），seed 后跑本脚本重建。
 * 双层设计的库侧：内置骨架在 SYSTEM_KNOWLEDGE（防伪底线），详细分步操作在
 * 本库（RAG 按问检索）；库=共享（isShared）、域=assistant（水叮当专用域）。
 *
 * 用法（apps/api 下）：
 *   npx tsx scripts/seed-assistant-kb.ts            # 默认 admin 种子账号
 *   KB_SEED_USER=x KB_SEED_PASS=y npx tsx scripts/seed-assistant-kb.ts
 * 幂等：按文件名跳过已存在文件；库不存在则创建；已存在但 chunkCount=0 会重传。
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const API = process.env.API_ORIGIN ?? 'http://localhost:4001/api';
const KB_NAME = '系统操作指引';
const USER = process.env.KB_SEED_USER ?? 'Swhi-CGZX-admin';
const PASS = process.env.KB_SEED_PASS ?? 'Swhi-CGZX-admin@2026';

async function main() {
  // 1) 登录换 token
  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Portal': 'web' },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!loginRes.ok) throw new Error(`登录失败（${loginRes.status}）——检查 KB_SEED_USER/KB_SEED_PASS`);
  const setCookie = loginRes.headers.get('set-cookie') ?? '';
  const token = /token_web=([^;]+)/.exec(setCookie)?.[1];
  if (!token) throw new Error('登录响应无 token_web cookie');
  const cookie = `token_web=${token}`;

  // 2) 找/建共享库（域=assistant）——注意 /knowledge 列表端点硬编码只回审查域
  //    （tender_review，2026-11-03 域隔离），assistant 域库须经 Prisma 直查发现
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  let kb = await prisma.knowledgeBase.findFirst({ where: { name: KB_NAME, domain: 'assistant' } });
  await prisma.$disconnect();
  if (!kb) {
    const createRes = await fetch(`${API}/knowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Portal': 'web', cookie },
      body: JSON.stringify({
        name: KB_NAME,
        description: '各采购方式在系统中的实际操作步骤（从流程图册蒸馏）——回答操作类问题的事实源',
        isShared: true,
        domain: 'assistant',
      }),
    });
    if (!createRes.ok) throw new Error(`建库失败（${createRes.status}）: ${await createRes.text()}`);
    kb = await createRes.json();
    console.log(`已创建共享库「${KB_NAME}」(${kb.id})`);
  }

  // 3) 现有文件名集合（幂等跳过）
  const detailRes = await fetch(`${API}/knowledge/${kb.id}`, { headers: { 'X-Portal': 'web', cookie } });
  const detail = await detailRes.json();
  const existing = new Set<string>(
    (detail.files ?? []).map((f: { fileName: string }) => f.fileName),
  );

  // 4) 逐个上传 knowledge-seeds/*.md
  const dir = join(__dirname, '..', 'knowledge-seeds');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort();
  if (files.length === 0) throw new Error(`目录无 md 文件: ${dir}`);
  for (const name of files) {
    if (existing.has(name)) {
      console.log(`跳过（已存在）: ${name}`);
      continue;
    }
    const buf = await readFile(join(dir, name));
    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'text/markdown' }), name);
    const upRes = await fetch(`${API}/knowledge/${kb.id}/files`, {
      method: 'POST',
      headers: { 'X-Portal': 'web', cookie },
      body: form,
    });
    const raw = await upRes.text();
    if (!upRes.ok) {
      console.error(`上传失败 ${name}（${upRes.status}）: ${raw.slice(0, 200)}`);
      process.exitCode = 1;
      continue;
    }
    const m = /"chunkCount":(\d+)/.exec(raw);
    console.log(`已上传: ${name}（分块 ${m?.[1] ?? '?'}）`);
  }
  console.log('完成。');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
