import { Injectable } from '@nestjs/common';

/**
 * 采购方式入参归一（2026-11-04 台账工具翻新实测）：LLM 常给简称（「谈判」），
 * 且轮次表与 PMI 两套词汇并存（竞争性谈判 ↔ 谈判采购、询比 ↔ 询比采购）——
 * 精确/contains 都会单边 0 命中。归一成 OR-in 查询片段。
 */
const METHOD_ALIASES: Record<string, string[]> = {
  谈判: ['竞争性谈判', '谈判采购'],
  竞争性谈判: ['谈判采购'],
  谈判采购: ['竞争性谈判'],
  询比: ['询比采购'],
  询比采购: ['询比'],
  竞价: ['竞价采购'],
  招标: ['公开招标', '邀请招标'],
};

/** 方式过滤 where 片段：contains + 别名 OR-in（别名表无命中时只走 contains） */
export function methodFilter(method: string): { OR: Array<Record<string, unknown>> } {
  const aliases = METHOD_ALIASES[method] ?? [];
  return {
    OR: [
      { procurementMethod: { contains: method } },
      ...(aliases.length ? [{ procurementMethod: { in: aliases } }] : []),
    ],
  };
}
