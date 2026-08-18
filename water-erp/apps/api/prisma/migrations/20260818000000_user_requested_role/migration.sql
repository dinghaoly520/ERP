-- 注册审批流：持久化用户申请的权限类型（management=管理权限 / office=办公权限）
-- 审批通过时按此字段映射正式角色（leader / staff）
ALTER TABLE "User" ADD COLUMN "requested_role" TEXT;
