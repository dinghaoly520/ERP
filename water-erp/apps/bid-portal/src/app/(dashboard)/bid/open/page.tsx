'use client';

import { OpeningHall } from '@/components/opening-hall';

/** 兼容入口：开标大厅现作为项目工作区 /bid/project/[id] 的 open tab；
 * /bid/open?id= 直达链接继续可用（Task 18 加重定向）。 */
export default function BidOpenPage() {
  return <OpeningHall />;
}
