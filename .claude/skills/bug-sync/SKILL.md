---
name: bug-sync
description: 禅道 bug 整理核查与入库流水线——按仓库权威 SOP 手册从禅道拉取新 bug、核对元数据、附件 md5 校验、OCR 截图取证、代码核查，然后产出即入库 docs/bugs/<批次>/（原件+manifest+票修队列）并交接 /bug-fix 修复。仅限装有禅道 docker 与 OCR 的机器。用户说「整理bug」「同步bug」「拉取禅道bug」「bug入库」「/bug-sync」时进入。
---

# bug-sync · 禅道 bug 整理入库流水线

把禅道新 bug 变成仓库里可修的批次材料。**本 skill 只是编排入口——工序细节一律以仓库权威手册为准，勿凭记忆重造**：

> 权威手册：`water-erp/docs/bugs/SOP-bug整理与代码核查执行手册.md`（§1 数据核对 → §2 附件 md5 → §3 OCR 取证 → §4 代码核查 → §5 产出物规范 → §6 质量闸 → §8 产出即入库）。`~/桌面/禅道/bug-export/` 内同名手册是工作区指针副本，**不是权威版**。

## 0. 前置自检（仅本机可跑，缺一如实报告并停）

1. **禅道栈在跑**：`docker ps` 见 `zentao-standalone-db-1`；没起则 `~/桌面/禅道/start-zentao.sh`（先问用户）。
2. **OCR 在跑**：`curl -s --noproxy '*' http://localhost:8110/health` 或 PM2 `erp-ocr` 状态；截图取证唯一权威通道（SOP §3，勿信 CDN 回传）。
3. **ERP 工作区先同步再记基准**：`git fetch` → 落后则**问用户**是否拉取（pull 前树必须干净，绝不 autostash/脏树——并行会话避让）；拉不了就按当前 HEAD 继续，但产出件「核查方法备注」必须写明「核查基准=本地 HEAD `<hash>`，落后 origin/main N 提交」。随后 `git log --oneline -1` 记基准 commit（写进产出件）。前六步只读安全，§8 起只 add 自己的批次目录。

## 1. 定范围（先问用户）

- 指派给谁、状态口径、排除项（如「正式环境」单独立档）——默认沿用最近批次口径；DB 凭据按 SOP §0 现取（`docker exec ... printenv`），不写死。
- 软删除铁律：`deleted='0'`（SOP §1.1）；范围数与预期不符走 `zt_action` 追历史（§1.2）。

## 2. 按手册执行 §1→§6

逐票完成：元数据核对 → 附件导出 md5 N/N 全绿 → 截图本地 OCR 实证（疑难点 dpi300+分块）→ 代码核查四层断言（锚点/根因链/裁定区防撞车/缺失类全仓反证，`rg -n` 勿 `rg -rn`）→ 按 §5 产出 MD+CSV（括注纪律：无实证不写「与描述相符 ✓」）→ §6 质量闸逐项过。

## 3. §8 产出即入库

1. 落位 `water-erp/docs/bugs/<导出日期>-<负责人>/`：清单 MD+CSV + `images/` **引用到的原件原样**（不压缩）+ 生成 `manifest.json`（逐文件 md5+size，与 §2.2 校验一致）。
2. 建 `票修队列.md`（沿用现行格式；组/联动从汇总分组抄录）。
3. 只 add 本批次目录，commit（`chore(bugs): 入列 <日期>-<负责人> N 票`）→ **问用户是否推送**（建议推——修 bug 的机器靠 pull 拿活）。

## 4. 交接

入库即完成本 skill 使命。修复阶段走 `/bug-fix`（队列取票，两道强制确认闸门）；别机无禅道，新批次靠 git pull 到达，不需要压缩包。
