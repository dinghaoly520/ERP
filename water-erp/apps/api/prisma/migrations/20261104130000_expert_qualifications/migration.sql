-- 专家执业资格单列（2026-11-04 职称标准化）：执业资格从职称列剥离进独立字段，
-- 职称列收敛为 15 项标准职称集（纯资格者职称置空）。
ALTER TABLE "ExpertProfile" ADD COLUMN "qualifications" TEXT;
