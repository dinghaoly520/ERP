/**
 * 定向装载评审专家库（2026-10-19）——与 prisma/seed.ts 1.45/1.5 段同源
 * （origin/main 5d0a7b64「feat(seed): 专家库固化 ExpertLibrary.json」）。
 *
 * 场景：main 与本地未提交工作分叉、pull 受阻时的过渡通道——只重建专家域，
 *       不动其余业务表；分支合并完成后，常规路径仍是 pnpm db:seed（全量）。
 * 口径（与 seed 完全一致）：
 *   - 用户名=姓名；口令=身份证号（缺失回退 expert@2026）；bcrypt cost 10 带缓存
 *   - 公司按 ExpertLibrary.company 直挂（SEED_COMPANIES 8 家 upsert，新 4 家 code=null）
 *   - 部门按名 find-or-create；entryStatus=ACTIVE（名单即批文）
 *   - PII（email/phone/idNumber）sealPii 国密密封落库
 *   - 清空列与 seed 1.45 相同（9 张显式清；BidScoreDelta 表未建勿加）
 * 用法：cd water-erp/apps/api && npx tsx scripts/import-expert-library.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashSync } from 'bcryptjs';
import { sealPii } from '../src/common/crypto/sm-field-crypto';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 未加载（应在 apps/api 下运行，读取 ./.env）');
if (!process.env.FIELD_ENC_SECRET) throw new Error('FIELD_ENC_SECRET 未加载——拒绝以 dev 固定钥密封 PII（孤儿密文风险）');

const prisma = new PrismaClient();
const dataDir = join(__dirname, '../prisma/seed-data');

const SEED_COMPANIES = [
  { id: 'co-swhi-sjy', name: '四川水发勘测设计研究有限公司', shortName: '设计院', code: 'SWHI' },
  { id: 'co-swhi-js', name: '四川水发建设有限公司', shortName: '建设', code: 'SFJS' },
  { id: 'co-swhi-tz', name: '四川水发投资有限公司', shortName: '投资', code: 'SFTZ' },
  { id: 'co-swdg-jt', name: '四川省水利发展集团有限公司', shortName: '集团本部', code: 'SWDG' },
  // 2026-10-19 专家拟入库名单涉及 4 家新单位（ExpertLibrary.json 归属目标）——code 留空：未定项目编号前缀
  { id: 'co-swhi-ny', name: '四川水发能源开发有限公司', shortName: '能源', code: null },
  { id: 'co-swhi-tzk', name: '四川省亭子口灌区建设开发有限公司', shortName: '亭子口', code: null },
  { id: 'co-swhi-xjb', name: '四川省向家坝灌区建设开发有限责任公司', shortName: '向家坝', code: null },
  { id: 'co-swhi-ydm', name: '引大济岷水资源开发有限公司', shortName: '引大', code: null },
] as const;

type LibraryEntry = {
  name: string; company: string; employer?: string | null; department?: string | null;
  specialty: string; title?: string | null; education?: string | null;
  phone?: string | null; idNumber?: string | null; email?: string | null;
};

async function main() {
  const library = JSON.parse(readFileSync(join(dataDir, 'ExpertLibrary.json'), 'utf-8')) as LibraryEntry[];
  console.log(`▶ ExpertLibrary.json ${library.length} 名`);

  for (const c of SEED_COMPANIES) {
    await prisma.company.upsert({ where: { name: c.name }, update: { shortName: c.shortName, code: c.code }, create: { ...c } });
  }
  const sjy = await prisma.company.findUniqueOrThrow({ where: { id: 'co-swhi-sjy' } });
  const companyByName = new Map((await prisma.company.findMany()).map((c) => [c.name, c.id]));

  // 清空旧专家域（与 seed 1.45 同列；此前已清过，此处幂等兜底）
  await prisma.$transaction([
    prisma.user.deleteMany({ where: { role: 'bid_expert' } }),
    prisma.expertProfile.deleteMany({}),
    prisma.expertEvaluation.deleteMany({}),
    prisma.bidExpert.deleteMany({}),
    prisma.expertMemo.deleteMany({}),
    prisma.bidScoreRecord.deleteMany({}),
    prisma.bidScoreRecordHistory.deleteMany({}),
    prisma.bidScorePointDecision.deleteMany({}),
    prisma.bidScoreReview.deleteMany({}),
  ]);

  const libPwHash = new Map<string, string>();
  const libHashOf = (pw: string) => {
    let h = libPwHash.get(pw);
    if (!h) { h = hashSync(pw, 10); libPwHash.set(pw, h); }
    return h;
  };
  const deptByName = new Map((await prisma.department.findMany({ select: { id: true, name: true } })).map((d) => [d.name, d.id]));
  let libCreated = 0;
  let libSkipped = 0;
  for (const e of library) {
    const companyId = companyByName.get(e.company);
    if (!companyId) {
      console.warn(`    ⚠ 专家「${e.name}」归属公司「${e.company}」不在主数据，跳过`);
      libSkipped++;
      continue;
    }
    let departmentId: string | undefined;
    if (e.department) {
      let deptId = deptByName.get(e.department);
      if (!deptId) {
        deptId = (await prisma.department.create({ data: { name: e.department! } })).id;
        deptByName.set(e.department, deptId);
      }
      departmentId = deptId;
    }
    await prisma.user.create({
      data: {
        username: e.name,
        displayName: e.name,
        role: 'bid_expert',
        isActive: true,
        email: e.email ? sealPii(e.email) : null,
        passwordHash: libHashOf(e.idNumber?.trim() || 'expert@2026'),
        companyId,
        company: e.company,
        departmentId,
        expertProfile: {
          create: {
            specialty: e.specialty,
            title: e.title ?? '',
            employer: e.company,
            phone: e.phone ? sealPii(e.phone) : null,
            idNumber: e.idNumber ? sealPii(e.idNumber) : null,
            education: e.education ?? null,
            availability: '可用',
            entryStatus: 'ACTIVE',
            ...(e.employer && e.employer !== e.company ? { notes: `原表工作单位：${e.employer}` } : {}),
          },
        },
      },
    });
    libCreated++;
  }
  console.log(`    专家库装载：ExpertLibrary.json ${library.length} 名 → 入库 ${libCreated}、跳过 ${libSkipped}（用户名=姓名，口令=身份证号）`);

  const expertBackfill = await prisma.user.updateMany({
    where: { role: 'bid_expert', companyId: null },
    data: { companyId: sjy.id, company: sjy.name },
  });
  console.log(`    专家归属兜底：${expertBackfill.count} 名 → 设计院本部`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
