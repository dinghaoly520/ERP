-- 合同签署证据状态收口：`signed` 不再表示“内审通过”，必须已经关联签署版文件。
-- 无履约记录的旧数据可以安全回退为“内审通过·待签署”；已有履约/验收记录的
-- 异常合同不能静默改写业务历史，部署必须先由经办人补齐真实签署件。

UPDATE "Contract" AS contract
SET
  "status" = 'approved_for_signing',
  "signedAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE contract."status" = 'signed'
  AND contract."signedAssetId" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "ContractFulfillment" AS fulfillment
    WHERE fulfillment."contractId" = contract."id"
  );

DO $$
DECLARE
  unresolved_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO unresolved_count
  FROM "Contract" AS contract
  WHERE contract."status" IN ('signed', 'performing', 'accepted')
    AND contract."signedAssetId" IS NULL;

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION
      '发现 % 条已进入签署/履约/验收阶段但缺少签署版文件的合同，已阻止迁移；请先按合同原件补齐 Contract.signedAssetId',
      unresolved_count
      USING HINT = '核查 SQL: SELECT id, "contractCode", status FROM "Contract" WHERE status IN (''signed'',''performing'',''accepted'') AND "signedAssetId" IS NULL;';
  END IF;
END $$;
