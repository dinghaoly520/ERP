import type { AiBidder as AppAiBidder } from "@/lib/types/ai-bid-analysis";

export type AiBidder = AppAiBidder;

function parsePriceInTenThousandYuan(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const text = value.trim().replace(/,/g, "");
  const match = text.match(/\d+(?:\.\d+)?/);
  if (!match) return null;

  const amount = Number(match[0]);
  if (!Number.isFinite(amount)) return null;

  return text.includes("元") && !text.includes("万") ? amount / 10000 : amount;
}

/**
 * 从 bidder 中提取报价（万元），兼容多种数据来源：
 * 1. keyInfo.quotePrice（LLM 提取的标准字段）
 * 2. extractedInfo.commercial.price（备用字段）
 * 3. extractedInfo.keyInfo.quotePrice（嵌套结构）
 */
function extractBidderPrice(bidder: AiBidder): number | null {
  // 优先从 keyInfo 取
  const keyInfo = bidder.keyInfo as Record<string, unknown> | null;
  if (keyInfo) {
    const price = parsePriceInTenThousandYuan(keyInfo.quotePrice);
    if (price !== null) return price;
  }

  // 备用：从 extractedInfo 取
  const extractedInfo = bidder.extractedInfo as Record<string, unknown> | null;
  if (extractedInfo) {
    // extractedInfo.commercial.price
    const commercial = extractedInfo.commercial as Record<string, unknown> | null;
    if (commercial) {
      const price = parsePriceInTenThousandYuan(commercial.price);
      if (price !== null) return price;
    }

    // extractedInfo.keyInfo.quotePrice
    const nestedKeyInfo = extractedInfo.keyInfo as Record<string, unknown> | null;
    if (nestedKeyInfo) {
      const price = parsePriceInTenThousandYuan(nestedKeyInfo.quotePrice);
      if (price !== null) return price;
    }
  }

  return null;
}

export function buildPriceComparisonData(bidders: AiBidder[]) {
  return bidders
    .map((bidder) => ({ name: bidder.name, price: extractBidderPrice(bidder) }))
    .filter((item): item is { name: string; price: number } => item.price !== null)
    .sort((a, b) => a.price - b.price);
}
