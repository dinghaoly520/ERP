-- 供应商撤销申请（2026-11-25 spec）：撤回壳状态 + 撤回次数列
ALTER TYPE "SupplierStatus" ADD VALUE 'WITHDRAWN';
ALTER TABLE "Supplier" ADD COLUMN "withdrawCount" INTEGER NOT NULL DEFAULT 0;
