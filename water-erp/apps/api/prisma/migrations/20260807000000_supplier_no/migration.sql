-- 供应商编号 supplierNo：SUP-000001（6 位递增数字）
-- 用 PG 序列 supplier_no_seq 保证原子唯一，并发注册安全。

-- 1. 新增列（先允许 NULL，回填后再设 NOT NULL）
ALTER TABLE "Supplier" ADD COLUMN "supplierNo" TEXT;

-- 2. 按 createdAt 顺序回填现有供应商
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt") AS rn
  FROM "Supplier"
)
UPDATE "Supplier" s
SET "supplierNo" = 'SUP-' || lpad(r.rn::text, 6, '0')
FROM ranked r
WHERE r.id = s.id;

-- 3. 设 NOT NULL + 唯一约束
ALTER TABLE "Supplier" ALTER COLUMN "supplierNo" SET NOT NULL;
CREATE UNIQUE INDEX "Supplier_supplierNo_key" ON "Supplier"("supplierNo");

-- 4. 创建序列，起点设为当前供应商数（nextval 首次返回 count+1）
--    setval(..., true) 让下一个 nextval 返回 count+1（已用掉 count）
CREATE SEQUENCE IF NOT EXISTS supplier_no_seq;
SELECT setval('supplier_no_seq', GREATEST((SELECT COUNT(*) FROM "Supplier"), 1), true);
