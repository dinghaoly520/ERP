
## 操作日志法定留存（P1-12，2026-08-25）

- **OperationLog**：过期月分区 DROP 前先归档到 MinIO（`operation-log-archive/<yyyy_mm>.jsonl.gz`，gzip JSON-lines + SHA-256），清单表 `OperationLogArchive`（month 唯一/rowCount/objectKey/sha256/sizeBytes）；归档失败**不 DROP**（下轮重试，宁可超保留期不可损毁）。`OPERATION_LOG_ARCHIVE_ENABLED=false` 可回退旧行为（直接 DROP），但启动时 warn 不满足办法第42条≥15年留存。
- **AuditLog**：保留期参数化 `AUDIT_LOG_RETENTION_DAYS`，默认 5475（15 年）；低频业务动作表直接留 PG。
- **归档对象非 FileAsset、无删除端点**（天然不可删）；归档对象须随 MinIO 备份策略覆盖，备份保留期同步 ≥15 年。
- 验证端点：`GET /operation-log/archive`（admin 清单）、`GET /operation-log/archive/verify/:month`（admin，sha256 比对）。
