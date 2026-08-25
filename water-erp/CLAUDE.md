
## CI 流水线（2026-08-25）

`.github/workflows/ci.yml`（push main / PR，concurrency 取消旧跑）：

- **validate job**（~2.5 min，无基础设施）：install → 写 CI .env（schema env() 必需 DATABASE_URL/DIRECT_URL）→ build shared 三包 → prisma generate/validate → api tsc/lint → 全量单测（jest testTimeout 20s——PBKDF2+sm-crypto 用例在慢速 runner 超 5s 默认值）。
- **e2e job**（~4 min，pgvector:pg16 + redis:7 services + docker MinIO）：`migrate deploy` 全新库重放（迁移链健康）→ status 干净 → build → **boot smoke**（:4099 起 → docs 200 → 杀；单测绿≠能启动）→ 装 reportlab（seed 投标 PDF 依赖）→ seed（含编号序列对齐）→ 起 :4001 → dual-selfcheck → 新轨 e2e 55 项 → 快照恢复（CI 重封模式）+ 旧轨 13 项 + 恢复。
- **快照重封**（`SNAPSHOT_RESEAL_CRYPTO=1`，仅 CI）：快照内 sealedKey/bidPrice 是 dev KMS 包裹、FileAsset 引用 dev 产物——异 KMS 环境解不开。恢复时缺失 FileAsset 补桩（dummy 对象+哈希）、sealedKey 置空（走 legacy 完整性校验）、bidPrice 本地重封占位价。dev 关闭保持原值（快照是证据件）。产物仅作冒烟，非证据。

**教训闸**（memory `unit-tests-green-does-not-mean-boots` 的落地）：boot smoke 与 tsc 闸在 CI 首日各捕获一个真实 bug（ConflictException 导入漏 / Length 同类）。
