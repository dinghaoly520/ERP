// One-shot script: recalculate PRICE scores for existing bidder results
// Fixes bug where concurrent bidder processing resulted in all PRICE=0
// + fixes comparative scoring NaN corruption of categoryTotals

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // yndjm-proj-01 project
  const bidders = await prisma.aiBidderResult.findMany({
    where: {
      task: { projectId: 'yndjm-proj-01' },
      status: 'COMPLETED',
    },
    select: {
      id: true,
      keyInfo: true,
      scoreItems: true,
      categoryTotals: true,
    },
  });

  console.log(`Found ${bidders.length} bidders`);

  // Collect all prices
  const allPrices: number[] = [];
  for (const b of bidders) {
    const price = (b.keyInfo as any)?.quotePrice;
    if (typeof price === 'number' && price > 0) {
      allPrices.push(price);
    }
    console.log(`  ${b.id}: quotePrice=${price}, PRICE categoryTotal=${JSON.stringify((b.categoryTotals as any)?.PRICE)}`);
  }

  if (allPrices.length < 2) {
    console.log(`Only ${allPrices.length} prices, cannot recalculate`);
    await prisma.$disconnect();
    return;
  }

  const benchmark = allPrices.reduce((a, b) => a + b, 0) / allPrices.length;
  console.log(`\nBenchmark price: ${benchmark.toFixed(4)}万元`);

  for (const bidder of bidders) {
    const price = (bidder.keyInfo as any)?.quotePrice as number | undefined;
    if (price == null) continue;

    const scoreItems = (bidder.scoreItems ?? []) as any[];
    const categoryTotals = (bidder.categoryTotals ?? {}) as Record<string, { score: number; max: number }>;

    // Recalculate PRICE score
    const newItems = scoreItems.map((item: any) => {
      if (item.category !== 'PRICE') return item;
      const maxScore = Number(item.maxScore ?? 30);
      const deviation = (price - benchmark) / benchmark;
      const ratio = Math.max(0, 1 - Math.abs(deviation) * 2);
      const newScore = Math.round(maxScore * ratio * 10) / 10;
      return {
        ...item,
        score: newScore,
        reason: `报价 ${price}万元，基准价 ${benchmark.toFixed(2)}万元，偏离 ${(deviation * 100).toFixed(1)}%`,
        evidence: '公式计算（基准价法，全量报价重算）',
        confidence: 0.95,
      };
    });

    // Recalculate categoryTotals from scoreItems (fix NaN corruption too)
    const newTotals: Record<string, { score: number; max: number }> = {};
    for (const item of newItems) {
      const cat = item.category;
      if (!newTotals[cat]) newTotals[cat] = { score: 0, max: 0 };
      const itemScore = typeof item.score === 'number' && !isNaN(item.score) ? item.score : 0;
      newTotals[cat].score = Math.round((newTotals[cat].score + itemScore) * 10) / 10;
      newTotals[cat].max += Number(item.maxScore ?? 0);
    }

    const newTotal = Math.round(
      Object.values(newTotals).reduce((a, c: any) => a + (c?.score ?? 0), 0) * 10
    ) / 10;

    await prisma.aiBidderResult.update({
      where: { id: bidder.id },
      data: {
        scoreItems: newItems as any,
        categoryTotals: newTotals as any,
        totalScore: newTotal,
      },
    });

    console.log(`\n${bidder.id} (price=${price}):`);
    console.log(`  PRICE: ${newItems.find((i: any) => i.category === 'PRICE')?.score}/${newTotals.PRICE?.max}`);
    console.log(`  TECHNICAL: ${newTotals.TECHNICAL?.score ?? 'N/A'}/${newTotals.TECHNICAL?.max ?? 'N/A'}`);
    console.log(`  BUSINESS: ${newTotals.BUSINESS?.score ?? 'N/A'}/${newTotals.BUSINESS?.max ?? 'N/A'}`);
    console.log(`  Total: ${newTotal}`);
  }

  await prisma.$disconnect();
  console.log('\nDone!');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
