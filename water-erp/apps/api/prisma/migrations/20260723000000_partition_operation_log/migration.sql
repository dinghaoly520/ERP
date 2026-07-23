-- Convert "OperationLog" to a RANGE-partitioned table by "createdAt" (monthly).
-- Idempotent: no-op if the table is already partitioned. "OperationLog" has NO
-- foreign keys (verified), so the swap is safe.
--
-- Why: at 2万-user scale the global interceptor writes ~1M rows/day; a single
-- unpartitioned table with 180-day retention degrades VACUUM/cleanup. With
-- monthly partitions the daily 04:00 cron can DROP whole expired partitions
-- (O(1)) instead of scanning/deleting rows.
--
-- NOTE: partitioned tables require the partition key in every PK/unique index,
-- so the PK becomes ("id", "createdAt"). No code uses findUnique/update by id
-- on this model (only create/findMany/count/deleteMany — verified), so the
-- Prisma client is unaffected. Do NOT let `prisma migrate diff` regenerate DDL
-- for this table (it would try to "fix" the composite PK).

DO $$
DECLARE
  relkind_char char;
  first_m  timestamp;
  last_m   timestamp;
  m        timestamp;
  cnt_new  bigint;
  cnt_old  bigint;
BEGIN
  SELECT c.relkind INTO relkind_char
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'OperationLog';

  IF relkind_char IS NULL THEN
    RAISE EXCEPTION 'table "OperationLog" not found';
  END IF;

  IF relkind_char = 'p' THEN
    RAISE NOTICE 'OperationLog already partitioned — skipping';
    RETURN;
  END IF;

  -- 1) move legacy table aside (its indexes keep their names → rename them
  --    out of the way so the new table can reuse the original index names;
  --    the legacy_* indexes die with the legacy table in step 7)
  ALTER TABLE "OperationLog" RENAME TO "OperationLog_legacy";
  ALTER INDEX "OperationLog_pkey" RENAME TO "OperationLog_legacy_pkey";
  ALTER INDEX "OperationLog_userId_createdAt_idx" RENAME TO "OperationLog_legacy_userId_createdAt_idx";
  ALTER INDEX "OperationLog_createdAt_idx" RENAME TO "OperationLog_legacy_createdAt_idx";
  ALTER INDEX "OperationLog_role_createdAt_idx" RENAME TO "OperationLog_legacy_role_createdAt_idx";
  ALTER INDEX "OperationLog_portal_createdAt_idx" RENAME TO "OperationLog_legacy_portal_createdAt_idx";
  ALTER INDEX "OperationLog_path_createdAt_idx" RENAME TO "OperationLog_legacy_path_createdAt_idx";
  ALTER INDEX "OperationLog_statusCode_createdAt_idx" RENAME TO "OperationLog_legacy_statusCode_createdAt_idx";

  -- 2) partitioned replacement — identical columns/types/defaults
  CREATE TABLE "OperationLog" (
      "id"         TEXT NOT NULL,
      "userId"     TEXT,
      "username"   TEXT,
      "role"       TEXT,
      "portal"     TEXT,
      "method"     TEXT NOT NULL,
      "path"       TEXT NOT NULL,
      "query"      TEXT,
      "body"       JSONB,
      "statusCode" INTEGER NOT NULL,
      "durationMs" INTEGER NOT NULL,
      "ipAddress"  TEXT,
      "userAgent"  TEXT,
      "referer"    TEXT,
      "error"      TEXT,
      "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "OperationLog_pkey" PRIMARY KEY ("id", "createdAt")
  ) PARTITION BY RANGE ("createdAt");

  -- 3) same 6 secondary indexes (parent indexes auto-propagate to partitions)
  CREATE INDEX "OperationLog_userId_createdAt_idx"     ON "OperationLog" ("userId", "createdAt");
  CREATE INDEX "OperationLog_createdAt_idx"            ON "OperationLog" ("createdAt");
  CREATE INDEX "OperationLog_role_createdAt_idx"       ON "OperationLog" ("role", "createdAt");
  CREATE INDEX "OperationLog_portal_createdAt_idx"     ON "OperationLog" ("portal", "createdAt");
  CREATE INDEX "OperationLog_path_createdAt_idx"       ON "OperationLog" ("path", "createdAt");
  CREATE INDEX "OperationLog_statusCode_createdAt_idx" ON "OperationLog" ("statusCode", "createdAt");

  -- 4) DEFAULT partition = safety net for out-of-range rows
  CREATE TABLE "OperationLog_default" PARTITION OF "OperationLog" DEFAULT;

  -- 5) monthly partitions: month of min(legacy row) … current month + 1
  SELECT COALESCE(date_trunc('month', min("createdAt")), date_trunc('month', CURRENT_TIMESTAMP))
    INTO first_m FROM "OperationLog_legacy";
  last_m := date_trunc('month', CURRENT_TIMESTAMP + interval '1 month');
  m := first_m;
  WHILE m <= last_m LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS "OperationLog_%s" PARTITION OF "OperationLog" FOR VALUES FROM (%L) TO (%L)',
      to_char(m, 'YYYY_MM'), m, m + interval '1 month');
    m := m + interval '1 month';
  END LOOP;

  -- 6) copy rows + verify counts before dropping legacy
  INSERT INTO "OperationLog" SELECT * FROM "OperationLog_legacy";
  SELECT count(*) INTO cnt_new FROM "OperationLog";
  SELECT count(*) INTO cnt_old FROM "OperationLog_legacy";
  IF cnt_new <> cnt_old THEN
    RAISE EXCEPTION 'row count mismatch after copy (new=%, old=%) — aborting; legacy kept as "OperationLog_legacy"', cnt_new, cnt_old;
  END IF;

  -- 7) drop legacy
  DROP TABLE "OperationLog_legacy";

  RAISE NOTICE 'OperationLog partitioned: % rows migrated', cnt_new;
END $$;
