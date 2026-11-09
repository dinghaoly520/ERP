-- ═══ 金仓 KStudio「编辑数据」表格直编修复(静态版,2026-11-09) ═══
-- 问题:KStudio 保存时生成 UPDATE ... WHERE 所有列=旧值,枚举列与 text 比较报
--      42883 operator does not exist("XXX" = text);金仓不认隐式 cast,只能造操作符。
-- 交付:本脚本 = 给 public 模式全部 32 个枚举类型各建一对 函数+「=」操作符。
-- 形式:纯单行 CREATE/DROP 语句 —— KStudio 的 SQL 解析器按分号切分、不识别
--      DO $do$ 块(体内分号被当语句结尾 → 42601 Unterminated dollar quote),
--      故不用 DO 块;函数体内无分号,不怕切分。DBA 在 ksql 里跑等价 DO 块亦可。
-- 幂等:每对前置 DROP IF EXISTS,重复执行安全;库重建/迁移重放后本脚本会丢,需重跑。
-- 回滚:见文件尾注释的 DROP 清单(或用 DO 块按 %_eq_text 通配删除)。
-- 验证:执行后
--   SELECT count(*) FROM pg_operator o
--    WHERE o.oprnamespace='public'::regnamespace AND o.oprname='='
--      AND o.oprright='text'::regtype;   -- 应 = 32
-- 新增枚举类型的表再报 42883 时:按模板为本文件追加一对即可。

DROP OPERATOR IF EXISTS public.=("AiAnalysisTaskStatus", text);
DROP FUNCTION IF EXISTS public."AiAnalysisTaskStatus_eq_text"("AiAnalysisTaskStatus", text);
CREATE FUNCTION public."AiAnalysisTaskStatus_eq_text"(e "AiAnalysisTaskStatus", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "AiAnalysisTaskStatus", RIGHTARG = text, PROCEDURE = public."AiAnalysisTaskStatus_eq_text");
DROP OPERATOR IF EXISTS public.=("AiBidderStatus", text);
DROP FUNCTION IF EXISTS public."AiBidderStatus_eq_text"("AiBidderStatus", text);
CREATE FUNCTION public."AiBidderStatus_eq_text"(e "AiBidderStatus", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "AiBidderStatus", RIGHTARG = text, PROCEDURE = public."AiBidderStatus_eq_text");
DROP OPERATOR IF EXISTS public.=("AnnouncementStatus", text);
DROP FUNCTION IF EXISTS public."AnnouncementStatus_eq_text"("AnnouncementStatus", text);
CREATE FUNCTION public."AnnouncementStatus_eq_text"(e "AnnouncementStatus", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "AnnouncementStatus", RIGHTARG = text, PROCEDURE = public."AnnouncementStatus_eq_text");
DROP OPERATOR IF EXISTS public.=("AnnouncementType", text);
DROP FUNCTION IF EXISTS public."AnnouncementType_eq_text"("AnnouncementType", text);
CREATE FUNCTION public."AnnouncementType_eq_text"(e "AnnouncementType", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "AnnouncementType", RIGHTARG = text, PROCEDURE = public."AnnouncementType_eq_text");
DROP OPERATOR IF EXISTS public.=("ArchiveRetentionPeriod", text);
DROP FUNCTION IF EXISTS public."ArchiveRetentionPeriod_eq_text"("ArchiveRetentionPeriod", text);
CREATE FUNCTION public."ArchiveRetentionPeriod_eq_text"(e "ArchiveRetentionPeriod", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "ArchiveRetentionPeriod", RIGHTARG = text, PROCEDURE = public."ArchiveRetentionPeriod_eq_text");
DROP OPERATOR IF EXISTS public.=("ArchiveStatus", text);
DROP FUNCTION IF EXISTS public."ArchiveStatus_eq_text"("ArchiveStatus", text);
CREATE FUNCTION public."ArchiveStatus_eq_text"(e "ArchiveStatus", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "ArchiveStatus", RIGHTARG = text, PROCEDURE = public."ArchiveStatus_eq_text");
DROP OPERATOR IF EXISTS public.=("AttachmentType", text);
DROP FUNCTION IF EXISTS public."AttachmentType_eq_text"("AttachmentType", text);
CREATE FUNCTION public."AttachmentType_eq_text"(e "AttachmentType", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "AttachmentType", RIGHTARG = text, PROCEDURE = public."AttachmentType_eq_text");
DROP OPERATOR IF EXISTS public.=("BidStage", text);
DROP FUNCTION IF EXISTS public."BidStage_eq_text"("BidStage", text);
CREATE FUNCTION public."BidStage_eq_text"(e "BidStage", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "BidStage", RIGHTARG = text, PROCEDURE = public."BidStage_eq_text");
DROP OPERATOR IF EXISTS public.=("ChangeStatus", text);
DROP FUNCTION IF EXISTS public."ChangeStatus_eq_text"("ChangeStatus", text);
CREATE FUNCTION public."ChangeStatus_eq_text"(e "ChangeStatus", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "ChangeStatus", RIGHTARG = text, PROCEDURE = public."ChangeStatus_eq_text");
DROP OPERATOR IF EXISTS public.=("ConfirmStatus", text);
DROP FUNCTION IF EXISTS public."ConfirmStatus_eq_text"("ConfirmStatus", text);
CREATE FUNCTION public."ConfirmStatus_eq_text"(e "ConfirmStatus", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "ConfirmStatus", RIGHTARG = text, PROCEDURE = public."ConfirmStatus_eq_text");
DROP OPERATOR IF EXISTS public.=("DecryptStatus", text);
DROP FUNCTION IF EXISTS public."DecryptStatus_eq_text"("DecryptStatus", text);
CREATE FUNCTION public."DecryptStatus_eq_text"(e "DecryptStatus", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "DecryptStatus", RIGHTARG = text, PROCEDURE = public."DecryptStatus_eq_text");
DROP OPERATOR IF EXISTS public.=("ExpertLevel", text);
DROP FUNCTION IF EXISTS public."ExpertLevel_eq_text"("ExpertLevel", text);
CREATE FUNCTION public."ExpertLevel_eq_text"(e "ExpertLevel", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "ExpertLevel", RIGHTARG = text, PROCEDURE = public."ExpertLevel_eq_text");
DROP OPERATOR IF EXISTS public.=("InvitationStatus", text);
DROP FUNCTION IF EXISTS public."InvitationStatus_eq_text"("InvitationStatus", text);
CREATE FUNCTION public."InvitationStatus_eq_text"(e "InvitationStatus", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "InvitationStatus", RIGHTARG = text, PROCEDURE = public."InvitationStatus_eq_text");
DROP OPERATOR IF EXISTS public.=("OpeningHallMessageType", text);
DROP FUNCTION IF EXISTS public."OpeningHallMessageType_eq_text"("OpeningHallMessageType", text);
CREATE FUNCTION public."OpeningHallMessageType_eq_text"(e "OpeningHallMessageType", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "OpeningHallMessageType", RIGHTARG = text, PROCEDURE = public."OpeningHallMessageType_eq_text");
DROP OPERATOR IF EXISTS public.=("OpeningHallRoomType", text);
DROP FUNCTION IF EXISTS public."OpeningHallRoomType_eq_text"("OpeningHallRoomType", text);
CREATE FUNCTION public."OpeningHallRoomType_eq_text"(e "OpeningHallRoomType", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "OpeningHallRoomType", RIGHTARG = text, PROCEDURE = public."OpeningHallRoomType_eq_text");
DROP OPERATOR IF EXISTS public.=("OpeningHallSenderRole", text);
DROP FUNCTION IF EXISTS public."OpeningHallSenderRole_eq_text"("OpeningHallSenderRole", text);
CREATE FUNCTION public."OpeningHallSenderRole_eq_text"(e "OpeningHallSenderRole", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "OpeningHallSenderRole", RIGHTARG = text, PROCEDURE = public."OpeningHallSenderRole_eq_text");
DROP OPERATOR IF EXISTS public.=("PasswordChangeRequestStatus", text);
DROP FUNCTION IF EXISTS public."PasswordChangeRequestStatus_eq_text"("PasswordChangeRequestStatus", text);
CREATE FUNCTION public."PasswordChangeRequestStatus_eq_text"(e "PasswordChangeRequestStatus", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "PasswordChangeRequestStatus", RIGHTARG = text, PROCEDURE = public."PasswordChangeRequestStatus_eq_text");
DROP OPERATOR IF EXISTS public.=("ProcurementStatus", text);
DROP FUNCTION IF EXISTS public."ProcurementStatus_eq_text"("ProcurementStatus", text);
CREATE FUNCTION public."ProcurementStatus_eq_text"(e "ProcurementStatus", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "ProcurementStatus", RIGHTARG = text, PROCEDURE = public."ProcurementStatus_eq_text");
DROP OPERATOR IF EXISTS public.=("ProjectManagementStatus", text);
DROP FUNCTION IF EXISTS public."ProjectManagementStatus_eq_text"("ProjectManagementStatus", text);
CREATE FUNCTION public."ProjectManagementStatus_eq_text"(e "ProjectManagementStatus", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "ProjectManagementStatus", RIGHTARG = text, PROCEDURE = public."ProjectManagementStatus_eq_text");
DROP OPERATOR IF EXISTS public.=("ProjectStageStatus", text);
DROP FUNCTION IF EXISTS public."ProjectStageStatus_eq_text"("ProjectStageStatus", text);
CREATE FUNCTION public."ProjectStageStatus_eq_text"(e "ProjectStageStatus", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "ProjectStageStatus", RIGHTARG = text, PROCEDURE = public."ProjectStageStatus_eq_text");
DROP OPERATOR IF EXISTS public.=("ResultStatus", text);
DROP FUNCTION IF EXISTS public."ResultStatus_eq_text"("ResultStatus", text);
CREATE FUNCTION public."ResultStatus_eq_text"(e "ResultStatus", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "ResultStatus", RIGHTARG = text, PROCEDURE = public."ResultStatus_eq_text");
DROP OPERATOR IF EXISTS public.=("ScoreCategory", text);
DROP FUNCTION IF EXISTS public."ScoreCategory_eq_text"("ScoreCategory", text);
CREATE FUNCTION public."ScoreCategory_eq_text"(e "ScoreCategory", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "ScoreCategory", RIGHTARG = text, PROCEDURE = public."ScoreCategory_eq_text");
DROP OPERATOR IF EXISTS public.=("SignStatus", text);
DROP FUNCTION IF EXISTS public."SignStatus_eq_text"("SignStatus", text);
CREATE FUNCTION public."SignStatus_eq_text"(e "SignStatus", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "SignStatus", RIGHTARG = text, PROCEDURE = public."SignStatus_eq_text");
DROP OPERATOR IF EXISTS public.=("SourceType", text);
DROP FUNCTION IF EXISTS public."SourceType_eq_text"("SourceType", text);
CREATE FUNCTION public."SourceType_eq_text"(e "SourceType", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "SourceType", RIGHTARG = text, PROCEDURE = public."SourceType_eq_text");
DROP OPERATOR IF EXISTS public.=("SupplierLinkStatus", text);
DROP FUNCTION IF EXISTS public."SupplierLinkStatus_eq_text"("SupplierLinkStatus", text);
CREATE FUNCTION public."SupplierLinkStatus_eq_text"(e "SupplierLinkStatus", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "SupplierLinkStatus", RIGHTARG = text, PROCEDURE = public."SupplierLinkStatus_eq_text");
DROP OPERATOR IF EXISTS public.=("SupplierStatus", text);
DROP FUNCTION IF EXISTS public."SupplierStatus_eq_text"("SupplierStatus", text);
CREATE FUNCTION public."SupplierStatus_eq_text"(e "SupplierStatus", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "SupplierStatus", RIGHTARG = text, PROCEDURE = public."SupplierStatus_eq_text");
DROP OPERATOR IF EXISTS public.=("TagStatus", text);
DROP FUNCTION IF EXISTS public."TagStatus_eq_text"("TagStatus", text);
CREATE FUNCTION public."TagStatus_eq_text"(e "TagStatus", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "TagStatus", RIGHTARG = text, PROCEDURE = public."TagStatus_eq_text");
DROP OPERATOR IF EXISTS public.=("WorkArrangementNoteType", text);
DROP FUNCTION IF EXISTS public."WorkArrangementNoteType_eq_text"("WorkArrangementNoteType", text);
CREATE FUNCTION public."WorkArrangementNoteType_eq_text"(e "WorkArrangementNoteType", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "WorkArrangementNoteType", RIGHTARG = text, PROCEDURE = public."WorkArrangementNoteType_eq_text");
DROP OPERATOR IF EXISTS public.=("WorkArrangementRecurrence", text);
DROP FUNCTION IF EXISTS public."WorkArrangementRecurrence_eq_text"("WorkArrangementRecurrence", text);
CREATE FUNCTION public."WorkArrangementRecurrence_eq_text"(e "WorkArrangementRecurrence", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "WorkArrangementRecurrence", RIGHTARG = text, PROCEDURE = public."WorkArrangementRecurrence_eq_text");
DROP OPERATOR IF EXISTS public.=("WorkArrangementStatus", text);
DROP FUNCTION IF EXISTS public."WorkArrangementStatus_eq_text"("WorkArrangementStatus", text);
CREATE FUNCTION public."WorkArrangementStatus_eq_text"(e "WorkArrangementStatus", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "WorkArrangementStatus", RIGHTARG = text, PROCEDURE = public."WorkArrangementStatus_eq_text");
DROP OPERATOR IF EXISTS public.=("WorkArrangementType", text);
DROP FUNCTION IF EXISTS public."WorkArrangementType_eq_text"("WorkArrangementType", text);
CREATE FUNCTION public."WorkArrangementType_eq_text"(e "WorkArrangementType", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "WorkArrangementType", RIGHTARG = text, PROCEDURE = public."WorkArrangementType_eq_text");
DROP OPERATOR IF EXISTS public.=("WorkArrangementUrgency", text);
DROP FUNCTION IF EXISTS public."WorkArrangementUrgency_eq_text"("WorkArrangementUrgency", text);
CREATE FUNCTION public."WorkArrangementUrgency_eq_text"(e "WorkArrangementUrgency", t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT $1::text = $2 $f$;
CREATE OPERATOR public.= (LEFTARG = "WorkArrangementUrgency", RIGHTARG = text, PROCEDURE = public."WorkArrangementUrgency_eq_text");

-- ═══ 回滚(需要时):═══
-- DO $do$
-- DECLARE r record;
-- BEGIN
--   FOR r IN
--     SELECT lt.typname AS ltype, f.proname AS fname
--     FROM pg_operator o JOIN pg_type lt ON lt.oid=o.oprleft JOIN pg_proc f ON f.oid=o.oprcode
--     WHERE o.oprnamespace='public'::regnamespace AND o.oprname='=' AND o.oprright='text'::regtype
--       AND lt.typtype='e' AND lt.typnamespace='public'::regnamespace
--       AND f.proname LIKE '%\_eq\_text'
--   LOOP
--     EXECUTE format('DROP OPERATOR public.=(%I, text)', r.ltype);
--     EXECUTE format('DROP FUNCTION public.%I(%I, text)', r.fname, r.ltype);
--   END LOOP;
-- END $do$;
-- (回滚 DO 块需在 ksql 或支持美元引用的工具里执行,KStudio SQL 窗口不行)
