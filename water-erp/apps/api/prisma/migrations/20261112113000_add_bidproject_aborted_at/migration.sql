-- #79 延伸：BidProject 流标时刻显式标记（ABORTED→ARCHIVED 后「已流标」身份不丢）
ALTER TABLE "BidProject" ADD COLUMN "abortedAt" TIMESTAMP(3);
