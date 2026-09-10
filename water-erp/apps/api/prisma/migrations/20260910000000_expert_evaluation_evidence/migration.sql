-- 专家履职评价：新增三维评价依据（出勤/质量/廉洁）持久化
ALTER TABLE "ExpertEvaluation" ADD COLUMN "evidence" JSONB;
