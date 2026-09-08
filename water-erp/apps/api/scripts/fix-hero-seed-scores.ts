// apps/api/scripts/fix-hero-seed-scores.ts
/**
 * UI审计 P0-2：英雄项目种子分数折算（百分制误录 → 权重分）+ 官方结果重算。
 * 用法：npx tsx scripts/fix-hero-seed-scores.ts [--write]（默认 --check 只打印 diff）
 * 规则：score > maxScore 的记录 → round(score * maxScore / 100)；
 *       通过性项（maxScore=0）与合法记录不动。
 * 结果重算：对齐 aggregate-supplier-scores 语义——averageScore=去1高1低均分，totalScore=全员合计。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const SEED = path.join(__dirname, '..', 'prisma', 'seed-data');
const HERO = 'cmqhero';
const write = process.argv.includes('--write');

type ScoreItem = { id: string; projectId: string; category: string; maxScore: number };
type ScoreRecord = { id: string; scoreItemId: string; supplierId: string; expertId: string; score: number | string; passed?: boolean | null };
type EvalResult = { id: string; projectId: string; supplierId: string; totalScore: number | string; averageScore: number | string; rank: number; disqualified?: boolean; recommended?: boolean };

const items = JSON.parse(fs.readFileSync(path.join(SEED, 'BidScoreItem.json'), 'utf8')) as ScoreItem[];
const records = JSON.parse(fs.readFileSync(path.join(SEED, 'BidScoreRecord.json'), 'utf8')) as ScoreRecord[];
const results = JSON.parse(fs.readFileSync(path.join(SEED, 'BidEvaluationResult.json'), 'utf8')) as EvalResult[];

const heroItems = items.filter(i => i.projectId?.startsWith(HERO));
const maxBy = new Map(heroItems.map(i => [i.id, Number(i.maxScore)]));
let changed = 0;

for (const r of records) {
  const max = maxBy.get(r.scoreItemId);
  if (max == null) continue;
  const s = Number(r.score);
  if (s > max) {
    const fixed = max > 0 ? Math.round((s * max) / 100) : 0;
    console.log(`[record] ${r.id} ${r.score} / ${max} -> ${fixed}`);
    r.score = fixed; changed++;
  }
}

// 重算官方结果：per-supplier per-expert totals → trimmed avg + sum
const bySupplier = new Map<string, Map<string, number>>();
for (const r of records) {
  if (!maxBy.has(r.scoreItemId)) continue;
  const m = bySupplier.get(r.supplierId) ?? new Map<string, number>();
  m.set(r.expertId, (m.get(r.expertId) ?? 0) + Number(r.score));
  bySupplier.set(r.supplierId, m);
}
const agg = [...bySupplier.entries()].map(([supplierId, experts]) => {
  const totals = [...experts.values()].sort((a, b) => a - b);
  const trimmed = totals.length >= 3 ? totals.slice(1, -1) : totals;
  const averageScore = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
  const totalScore = totals.reduce((a, b) => a + b, 0);
  return { supplierId, totalScore: Math.round(totalScore * 100) / 100, averageScore: Math.round(averageScore * 100) / 100 };
}).sort((a, b) => b.averageScore - a.averageScore || a.supplierId.localeCompare(b.supplierId));

for (const r of results) {
  if (!r.projectId?.startsWith(HERO)) continue;
  const hit = agg.findIndex(a => a.supplierId === r.supplierId);
  if (hit < 0) continue;
  console.log(`[result] ${r.id} total ${r.totalScore} -> ${agg[hit].totalScore}, avg ${r.averageScore} -> ${agg[hit].averageScore}, rank ${r.rank} -> ${hit + 1}`);
  r.totalScore = agg[hit].totalScore; r.averageScore = agg[hit].averageScore; r.rank = hit + 1;
}

if (!write) { console.log(`\n--check 模式：${changed} 条记录待折算；加 --write 落盘`); process.exit(0); }
fs.writeFileSync(path.join(SEED, 'BidScoreRecord.json'), JSON.stringify(records, null, 2) + '\n');
fs.writeFileSync(path.join(SEED, 'BidEvaluationResult.json'), JSON.stringify(results, null, 2) + '\n');
console.log(`\n已写回：${changed} 条折算 + 英雄官方结果重算`);
