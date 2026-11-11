-- 供应商多公司归属退库轨（2026-11-10）：申请退库走该公司三级审批
-- LEAVE_PENDING=退库审批中（提交即暂停该公司库内权益）；WITHDRAWN=已退库（可重新申请加入，原行复用）
-- AlterEnum（PG 不能在事务内 ADD VALUE——db execute 每句自动提交，安全）
ALTER TYPE "SupplierLinkStatus" ADD VALUE 'LEAVE_PENDING';
ALTER TYPE "SupplierLinkStatus" ADD VALUE 'WITHDRAWN';
