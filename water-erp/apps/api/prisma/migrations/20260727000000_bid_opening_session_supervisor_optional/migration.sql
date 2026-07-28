-- AlterTable
-- 监督人改为选填：法律未强制开标现场必须有具名监督人（招标投标法第35/36条、
-- 水利工程建设项目招标投标行政监督暂行规定第8条「可以派人」为裁量性），
-- 系统保留字段作为「监督人登记/线上监督责任人」，但不再强制。
ALTER TABLE "BidOpeningSession" ALTER COLUMN "supervisor" DROP NOT NULL;
