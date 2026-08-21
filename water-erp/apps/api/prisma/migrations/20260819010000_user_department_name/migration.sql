-- 注册审核历史需要留存申请时的部门文本（此前部门自由文本未持久化）
ALTER TABLE "User" ADD COLUMN "department_name" TEXT;
