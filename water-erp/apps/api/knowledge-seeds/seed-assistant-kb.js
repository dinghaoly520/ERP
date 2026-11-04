"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const API = process.env.API_ORIGIN ?? 'http://localhost:4001/api';
const KB_NAME = '系统操作指引';
const USER = process.env.KB_SEED_USER ?? 'Swhi-CGZX-admin';
const PASS = process.env.KB_SEED_PASS ?? 'Swhi-CGZX-admin@2026';
async function main() {
    const loginRes = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Portal': 'web' },
        body: JSON.stringify({ username: USER, password: PASS }),
    });
    if (!loginRes.ok)
        throw new Error(`登录失败（${loginRes.status}）——检查 KB_SEED_USER/KB_SEED_PASS`);
    const setCookie = loginRes.headers.get('set-cookie') ?? '';
    const token = /token_web=([^;]+)/.exec(setCookie)?.[1];
    if (!token)
        throw new Error('登录响应无 token_web cookie');
    const cookie = `token_web=${token}`;
    const { PrismaClient } = await Promise.resolve().then(() => require('@prisma/client'));
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
        if (!createRes.ok)
            throw new Error(`建库失败（${createRes.status}）: ${await createRes.text()}`);
        kb = await createRes.json();
        console.log(`已创建共享库「${KB_NAME}」(${kb.id})`);
    }
    const detailRes = await fetch(`${API}/knowledge/${kb.id}`, { headers: { 'X-Portal': 'web', cookie } });
    const detail = await detailRes.json();
    const existing = new Set((detail.files ?? []).map((f) => f.fileName));
    const dir = __dirname;
    const files = (await (0, promises_1.readdir)(dir)).filter((f) => f.endsWith('.md')).sort();
    if (files.length === 0)
        throw new Error(`目录无 md 文件: ${dir}`);
    for (const name of files) {
        if (existing.has(name)) {
            console.log(`跳过（已存在）: ${name}`);
            continue;
        }
        const buf = await (0, promises_1.readFile)((0, node_path_1.join)(dir, name));
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
//# sourceMappingURL=seed-assistant-kb.js.map