# 方案遗漏修复计划（2026-06-25）

对照 `docs/投标文件分析-移植到ERP方案.md` 全文审查，16 项遗漏。按 A→B→C 优先级逐个修复。

---

## A 类：强制（安全/合规/错误）

### A1. 专家回避屏蔽（15.4）
- **问题**：`getAssistData` 未校验 `conflictedSupplierIds`，回避供应商仍能看 AI 分析
- **文件**：`apps/api/src/expert/expert.service.ts`（getAssistData）
- **改动**：加 `expert.conflictedSupplierIds.includes(supplierId)` 检查 → throw ForbiddenException
- **复杂度**：3 行代码

### A2. 任务终态自动更新 + 部分失败容忍（15.6）
- **问题**：bidderResults 可 FAILED，但 task 不会自动 → COMPLETED_WITH_ERRORS；无终态检查
- **文件**：`apps/api/src/ai-bid-analysis/queues/bidder.processor.ts`（末尾加 tryComparativeScoring 调用）
- **改动**：bidder.processor 处理完后检查全部终态 → 更新 task COMPLETED/COMPLETED_WITH_ERRORS + 触发 comparativeScoring（≥2 COMPLETED）
- **复杂度**：~30 行

### A3. decrypt-all 端点（4.4）
- **问题**：无 `POST /bid/projects/:id/decrypt-all` 一键解密端点
- **文件**：`apps/api/src/bid/bid.controller.ts` + `bid.service.ts`
- **改动**：新增端点，遍历解密窗口内待解密供应商调 decryptSupplier
- **复杂度**：~20 行

---

## B 类：推荐（质量/体验）

### B4. AI 建议 vs 专家分对比（6.4）
- **问题**：评分分析 Tab 缺「AI 建议 vs 您的评分」对比表
- **文件**：`apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx`（评分分析 Tab）
- **改动**：加对比表（读 myScores + assistData.scoreItems，按 scoreItemId 对齐，显示偏差）
- **复杂度**：~40 行 JSX

### B5. 串通检测触发 + 面板（6.5）
- **问题**：FraudDetector 未在 worker 触发，串通检测 Tab 无数据
- **文件**：`bidder.processor.ts`（所有 bidder COMPLETED 后触发）+ `expert.service.ts`（getAssistData 返回 fraud 摘要）
- **改动**：tryComparativeScoring 后调 FraudDetector → 存 AiBidReport.fraudIndicators；getAssistData 返回 fraud 摘要
- **复杂度**：~50 行

### B6. 综合报告 + DOCX 导出（6.5）
- **问题**：ReportGenerator + DocxGenerator 未触发
- **文件**：`bidder.processor.ts`（或新 trigger）+ getAssistData 返回报告
- **改动**：所有 bidder COMPLETED + fraud 后 → ReportGenerator.generate → DocxGenerator → 存 AiBidReport
- **复杂度**：~40 行

### B7. neutralizeRecommendationText（6.6）
- **问题**：AI 评语未中性化
- **文件**：procurement 的 `neutralizeRecommendationText` 移植到 `ai-bid-analysis/utils/`
- **改动**：移植函数 + bidder.processor/report-generator 输出前调用
- **复杂度**：~30 行

### B8. 重新分析机制（15.5）
- **问题**：无 `POST /bid/projects/:id/rerun-ai-analysis`
- **文件**：`bid.controller.ts` + `bid.service.ts`（或 `task.service.ts`）
- **改动**：新增端点，清除旧 AiBidderResult → 重置 task PENDING → 入队
- **复杂度**：~30 行

### B9. LLM Redis 缓存（15.7）
- **问题**：CacheService 是内存 Map
- **文件**：`ai-bid-analysis/services/cache.service.ts` → Redis 实现
- **改动**：替换为 Redis getOrCall（按 seed + prompt hash，TTL 7 天）
- **复杂度**：~40 行

### B10. 监督日志（15.10）
- **问题**：AI 分析启动无监督日志
- **文件**：`bid.service.ts`（startEvaluation 入队后写 BidSupervisionLog）
- **改动**：加 `tx.bidSupervisionLog.create({ action: '启动AI辅助分析', ... })`
- **复杂度**：~10 行

---

## C 类：方案/测试

### C11. 澄清答疑纳入需求提取（15.9）
- **问题**：TenderExtractor 未纳入 BidClarification
- **文件**：`tender.processor.ts` + `tender-extractor.service.ts`
- **改动**：查 BidClarification（已回复）→ 传入 TenderExtractor.extract
- **复杂度**：~20 行

### C12. 解密双格式测试（7.2）
- **文件**：新建 `plaintext-fetcher.service.spec.ts`
- **改动**：测试 wrappedKey + legacy hex 解密路径
- **复杂度**：~50 行

### C13. per-item 评分测试（7.3）
- **文件**：新建 `generic-item-scorer.service.spec.ts`
- **改动**：mock LlmService，测试 score + scorePriceByFormula + mergeAndAggregate
- **复杂度**：~80 行

### C14. E2E 测试（7.4）
- **文件**：`apps/api/test/` 新建 ai-bid.e2e-spec.ts
- **改动**：登录 → startEvaluation → 等 worker → getAssistData 验证
- **复杂度**：~100 行

---

## 执行顺序

```
A1 → A2 → A3 → B10 → B7 → B4 → B5 → B6 → B8 → B9 → C11 → C12 → C13 → C14
```

- A1-A3：安全/合规，先做
- B10/B7：小改动，快速完成
- B4：前端增强，有数据后立即可做
- B5/B6：需要 worker 触发 fraud + report，依赖 A2（终态检查）
- B8/B9：独立增强
- C11-C14：测试/补充

**每项做完即 commit**，便于回溯。
