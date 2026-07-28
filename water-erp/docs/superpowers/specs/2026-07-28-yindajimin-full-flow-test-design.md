# 引大济岷工程千隧ZK10/ZK12 — 全流程端到端测试方案

**日期**: 2026-07-28
**目的**: 用 1 份招标文件(.docx) + 3 份投标文件(.pdf) 在 ERP 内生成完整项目，从公示到专家评标（含 AI 辅助），验证全链路。

## 输入材料

- 招标文件: `2026.1.27勘察分院-引大济岷工程千ZK10和千隧ZK12两个钻孔施工技术服务内部竞标（竞价）采购文件.docx`
- 投标文件 ×3:
  1. 成都华建地质工程科技有限公司
  2. 四川省第十二地质大队
  3. 四川省第四地质大队

## 执行方式

API 驱动（curl + REST），角色切换通过 cookie（token_web / token_supplier / token_expert）。

## 七阶段流程

| # | 阶段 | 角色 | 关键端点 | 终止条件 |
|---|------|------|---------|---------|
| ① | 建项 | staff | POST /bid/projects, POST /bid/projects/:id/suppliers | BidProject stage=DOWNLOAD, 3 suppliers |
| ② | 发公告 | staff | POST /announcements, POST /upload, POST /announcements/:id/bid-document | Announcement PUBLISHED + BidDocument |
| ③ | 投标 | 3×supplier | POST /upload, POST /supplier-portal/bid-submissions/:projectId/draft+submit | 3 submissions (status=submitted) |
| ④ | AI 分析 | staff | POST /bid/projects/:id/rerun-ai-analysis + 轮询 | AiBidAnalysisTask COMPLETED |
| ⑤ | 开标 | bid_host | open session, decrypt-all, opening-records, complete-opening | 3 decrypt OK + 唱标 |
| ⑥ | 评标准备 | staff | score-items/template+publish, expert/extract+confirm, start-evaluation | EVALUATING + 专家已分配 |
| ⑦ | 专家评标 | 3×expert | sign-in, avoidance, ai-consent, assist/:supplierId, assist/compare, POST /scores | 3 专家完成 5 类打分 |

## 终止点

专家全部打分完毕 → 停。不生成最终结果、不归档。

## AI 两条线

1. **采购侧 per-item 分析**（阶段④）: worker 从招标文件提取得分要点 + 分析 3 家投标
2. **专家侧 AI 辅助评标**（阶段⑦）: assist/:supplierId 风险/合规分析 + assist/compare 横向对比
