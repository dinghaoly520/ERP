-- N1b: BidOpeningRecord 复合唯一（projectId, bidSupplierId）——解密/唱标并发双建记录的 DB 兜底。
-- bidSupplierId 可空，PG 唯一索引多 NULL 不冲突（存量已验证无重复对）。
CREATE UNIQUE INDEX "BidOpeningRecord_projectId_bidSupplierId_key" ON "BidOpeningRecord"("projectId","bidSupplierId");
