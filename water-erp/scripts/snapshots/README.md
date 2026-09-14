# 演示项目快照（demo-snapshot）

本目录存放演示项目的全量状态快照，由 `../demo-snapshot.js` 生成与恢复。

## 恢复脚本

```bash
# 方式一（推荐）：一键脚本
scripts/snapshots/restore-demo.sh

# 方式二：原始 node 脚本
node scripts/demo-snapshot.js restore scripts/snapshots/JJ-2026091003-demo.json
```

恢复行为：删除该项目的现有行并按快照整体回灌（20 张表：BidProject/PMI+阶段/公告+招标文件/供应商+标书/专家+评分/评分标准/开标会话与唱标/AI 分析+一致性核验+AI 评审报告）。**MinIO 文件对象不动（仅引用原 FileAsset id）；监督日志不随快照回滚**，恢复时自动追加一条「快照恢复」留痕。

## 生成新快照

```bash
# 方式一（推荐）：一键脚本（默认编号 JJ-2026091003、快照名 demo）
scripts/snapshots/snapshot-demo.sh [快照名] [编号]

# 方式二：原始 node 脚本
node scripts/demo-snapshot.js snapshot <BidProject 编号> <快照名>
# 例：node scripts/demo-snapshot.js snapshot JJ-2026091003 demo
# 输出：scripts/snapshots/<编号>-<快照名>.json
```

默认编号 `JJ-2026091003`、默认快照名 `demo`。注意：参数取的是 **BidProject 编号**（内部编号），不是 :3005 展示的 PMI 编号（如 PMI JJ-2026091005 ↔ BidProject JJ-2026091003）。

## 当前快照

### `JJ-2026091003-demo-0914.json`（2026-09-14 捕获，最新）

与 `demo.json` 同项目同停止点（组长末签前），差异：3 家投标回执**全部已电子签名**（payload+signature 存档）。恢复脚本如需回到「已签回执」演示态用这份：

```bash
node scripts/demo-snapshot.js restore snapshots/JJ-2026091003-demo-0914.json
```

### `JJ-2026091003-demo.json`（2026-09-11 捕获）

引大济岷工程千隧ZK10/千隧ZK12钻孔施工技术服务（竞价采购，最高限价 153.99 万）。

| 内容 | 明细 |
|---|---|
| 3 家真实投标 | 成都华建地质工程科技有限公司 152.9 万 / 四川省第十二地质大队 153.95 万 / 四川省第四地质大队 153.8998 万（双信封密封 + 真实标书 PDF） |
| 评分标准 | 模板 + AI 提取 18 项得分点，评标办法=最低价法 |
| 专家评审 | 5 正选（组长彭明亮，技术组/商务组分工）+ 5 候补；45 条评分记录 |
| 开标 | 会话（窗口 2026-09-10 20:30 → 09-11 23:59）、唱标 3 条、供应商电子签名 |
| AI 审查 | 投标分析 3 家（99.10/99.50/99.60，资格通过）、一致性核验 3 行、AI 评审报告 1 份 |

**恢复节点（停止点）**：EVALUATING、5/5 专家报告确认、**组长末签未执行**——恢复后从「组长确认（末签）」一步即可继续演示。

## 备注

- `BID-DEMO-20260817150148-pre-open.json`：**CI 旧轨回归专用 fixture**（`.github/workflows/ci.yml` e2e job 引用），2026-09-14 自 `cd1f1b3e^` 找回——09-11 快照替换时误删致 CI 旧轨步骤必挂。其 FileAsset 引用已随 2026-09-10 清库失效，**仅 SNAPSHOT_RESEAL_CRYPTO=1（CI 重封模式）可恢复，勿删、勿用于 dev 恢复**。
- `backups/keep_water_erp_20260914_141321.sql.gz`：demo-0914 同时刻的**全库备份**（含快照不覆盖的 FileAsset 元数据行），`keep_` 前缀使其脱离 `water_erp_*.sql.gz` 剪枝匹配、不随 14 天保留期清除；整库回滚用它（`db-restore.sh` 传该路径），单项目回滚用快照。
- 公告/招标文件按 `metadata.projectCode` 过滤归属（BidProject 与 PMI 编码同空间，防止误吞/误删同号他方项目数据）。
- 快照不含 OperationLog/监督日志（审计留痕设计如此）。
