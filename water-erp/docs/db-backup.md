# 数据库备份与恢复

`water_erp` 库的每日逻辑备份（`pg_dump --clean --if-exists | gzip`），经 `docker exec` 直连 postgres 容器（绕过 pgbouncer）。

## 手动备份 / 恢复

```bash
pnpm db:backup                                    # → backups/water_erp_时间戳.sql.gz（默认保留 14 天）
BACKUP_KEEP_DAYS=30 pnpm db:backup                # 自定义保留天数

# 恢复到默认库（生产恢复，会先 DROP 再建所有表）
bash scripts/db-restore.sh backups/water_erp_20260722_033000.sql.gz

# 恢复到临时库做验证（不影响线上）
docker exec -e PGPASSWORD=water_erp_dev water-erp-postgres createdb -U water_erp water_erp_restore_test
bash scripts/db-restore.sh backups/xxx.sql.gz water_erp_restore_test
docker exec -e PGPASSWORD=water_erp_dev water-erp-postgres dropdb -U water_erp water_erp_restore_test
```

## 定时任务（host cron）

```cron
# crontab -e  —— 每日 03:30，错开 04:00 的 OperationLog 分区清理 cron
30 3 * * * cd /home/asus/桌面/ERP/water-erp && /usr/bin/env BACKUP_KEEP_DAYS=14 bash scripts/db-backup.sh >> backups/backup.log 2>&1
```

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `PG_CONTAINER` | `water-erp-postgres` | postgres 容器名 |
| `DB_USER` / `DB_PASS` / `DB_NAME` | `water_erp` / `water_erp_dev` / `water_erp` | 库凭据 |
| `BACKUP_KEEP_DAYS` | `14` | 旧备份保留天数 |

## 注意

- 备份为纯 SQL 明文（gzip 压缩），含全部 DDL + 数据；`OperationLog` 分区表结构一并导出。
- 恢复到已有库会先 DROP 全部业务表（`--clean --if-exists`），恢复期间该库不可用。
- `backups/` 已 gitignore；生产环境建议再同步一份到异地（rsync/对象存储）。
- MinIO 文件（投标文件/附件）不在本备份内——文件量大，需单独用 `mc mirror` 备份 `water-erp_minio-data`。

## 监督推送签名密钥备份

`apps/api/.data/supervision/platform-signing.json` 是平台 SM2 签名私钥（A-153 监督推送适配层），与 `ADMIN_KEYSTORE_DIR` 同等纳入备份：丢失 = 历史推送信封签名不可复现、省平台侧验签失效。该文件不在 pg_dump/MinIO 备份内，须随宿主机文件备份策略（同 admin-keystore）覆盖；目录可用 `SUPERVISION_KEYSTORE_DIR` 覆盖（缺省由 `platform-signing.service.ts` 以 `__dirname` 锚定到 `apps/api/.data/supervision`）。

另注：本开发库上 `migrate dev` 可能就 20260826122001（开标签字追赶迁移）提示迁移已被编辑（checksum 变化）——该迁移已幂等化修复（`ADD COLUMN IF NOT EXISTS`，e73d3579），按提示接受重放或用 `prisma migrate resolve` 处理即可。
