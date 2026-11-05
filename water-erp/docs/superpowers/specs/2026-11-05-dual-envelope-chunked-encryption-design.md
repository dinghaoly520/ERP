# 双信封大文件分块加密 立项书（500MB 链路补缺 ③）

> 日期：2026-11-05
> 来源：OCR 接管升级 spec 的 500MB 全链审计（见 `2026-11-04-ocr-service-takeover-config-design.md`「2026-11-05 补充」节）
> 性质：单独立项——本文件自包含，新会话零上下文可开工
> 背景裁定：单文件上传上限全库统一 500MB（已落地：API 500MB、供应商前端闸默认 500MB、OCR 页数全量透传）

## 1. 问题

供应商投标走**双信封**（`BID_DUAL_ENVELOPE=true`）：明文标书在供应商浏览器用国密 SM4 加密成密文信封再上传；开标时供应商浏览器再解密。现状实现是 **sm-crypto 同步阻塞、无流式 CBC**，且把整个文件读进内存：

- 设计自述上限 ≤50MB：`apps/supplier-portal-next/src/utils/crypto-overlay.ts:2`（「B6（第四波）：同步国密 SM4 加密的全屏遮罩——sm-crypto 无流式 CBC，大文件（≤50MB）」）
- 500MB 明文：主线程同步计算冻结 UI 10-25s（sm-crypto JS 吞吐约 20-50MB/s，**开工先实测基线**）+ 内存乘数 ~3×（明文 buffer + 密文 + 中间），低配供应商机 tab 崩溃
- **两端同病**：投递加密（`apps/supplier-portal-next/src/app/(main)/bids/[id]/submit/page.tsx`）与开标大厅解密（bid-portal 开标大厅「供应商解密」单条/批量，供应商浏览器执行）共用同一套实现

**立项前现实约束（已记档）**：供应商单件建议 ≤100MB（同步冻结 2-5s 尚可忍受）。

## 2. 现状地图（先读这些）

| 文件 | 作用 |
|---|---|
| `water-erp/packages/ukey/src/sm-crypto-layer.ts` | SM4/SM2/SM3 封装层（改造主战场） |
| `water-erp/packages/ukey/src/dual-v3.ts` | 双信封 v3 信封构造/校验（`buildV3Envelope`/`computeV3FieldsCommit`/`keyWrapJson`——观察到的导出无分块逻辑） |
| `water-erp/packages/ukey/src/vendor-ukey.ts` / `mock-ukey.ts` / `scca-ukey.ts` | 真盾（SCCA）与 Mock 双轨适配 |
| `water-erp/packages/ukey/src/canonical.ts` | 规范化哈希（**注意查清：哈希对象是明文还是密文、分块后如何保持一致**） |
| `apps/supplier-portal-next/src/utils/crypto-overlay.ts` | 全屏加密遮罩（进度 UI 挂载点） |
| `apps/supplier-portal-next/src/app/(main)/bids/[id]/submit/page.tsx` | 投递页（文件读取→加密→上传链） |
| bid-portal 开标大厅组件 | 供应商解密入口（:3007，组件在 `apps/bid-portal/src`，开工时定位） |

**开工第一步**：核实现状——2026-10-24 曾有「供应商 dual-v2 前端已删（040df9a8）、dual-v3 前签名线不可用」的记录，与当前 submit 页存在双信封投递的关系需先理清（以当前代码为准，本立项书的文件清单基于 2026-11-05 实际观察）。

## 3. 设计方向（推荐 c，开工时按 brainstorming 流程定案）

a. **分块 CBC 循环 + 让出主线程**：手动按 SM4 块（16B）循环、每 N MB `await` 一次（`setTimeout`/`requestIdleCallback`），进度驱动遮罩。改造小，但计算仍在主线程，卡顿变「间歇性」。
b. **Web Worker 化**：sm-crypto 搬进 worker 线程，主线程零冻结；`File.stream()` 流式喂块，峰值内存从 3×S 降到 ~2×S。注意 Next/Turbopack 的 worker 打包（`new Worker(new URL(...))` 语法）与 U盾上下文限制。
c. **Worker + 分块 + 流式读**（a+b 结合，上限形态）：worker 内分块 CBC，`postMessage` 进度，`File.stream()` 避免整读。

**硬约束**：
- CBC 是链式依赖——分块必须按密码学块边界串行推进，**不能并行分块**（并行需换 GCM/CTR 类模式，合规评审另说，默认不做）
- envelope 格式/版本兼容：后端有验签与 `canonicalEnvelopeHash` 校验（`packages/ukey`），分块改造不得改变密文字节流语义（理想：仅改变「怎么算出来」，不改变「算出什么」——纯性能改造，信封零变化）；若不可避免要改格式，走 envelope 版本升级并处理后端双轨
- Mock 盾与 SCCA 真盾（`scca-ukey.ts`，测试盾 01/02 在库）**双轨都要过**
- 解密端同改（开标大厅）

## 4. 验收标准

1. ≤100MB：全程无感（无冻结帧，遮罩进度平滑）
2. 500MB：完成加密/解密，浏览器标签内存峰值 ≤1GB，进度可见，无崩溃（低配机可用「降速挡」：块间更长让出）
3. 信封字节级兼容：改造前后同一输入产出**完全相同**的密文与 envelope（若设计成格式升级则明确版本共存策略）
4. `packages/ukey` 单测：分块与整块加密输出一致性（同 key/IV 下 chunked == one-shot）
5. e2e：供应商投递→开标解密全链（现有 e2e 基础上补 100MB 级用例；500MB 用脚本级验证）
6. 基准数据入档：改造前后 50/100/500MB 加解密耗时与内存实测表

## 5. 交付面

- `packages/ukey`（分块核心 + 测试）
- `apps/supplier-portal-next`（投递页接线 + 遮罩进度）
- `apps/bid-portal`（大厅解密接线）
- 文档：本 spec 补「实现纪要」+ CLAUDE.md 双信封节一句话更新 + `crypto-overlay.ts` 头注释的 ≤50MB 自述修正

## 6. 风险与坑（开工必读）

- **CBC 链式**：见上，禁止并行分块
- **U盾操作线程**：签名/PoP 可能要求主线程或盾特定上下文——worker 只搬「数据加密」，盾交互留主线程
- **sm-crypto API**：确认其 CBC 实现的 padding/IV 处理在分块拼接后与 one-shot 逐字节一致（先写一致性测试再动工）
- **Next/Turbopack worker 打包**：历史上有构建器差异坑（见 CLAUDE.md Node24/Turbopack 节）
- **进度遮罩 UX**：B6 遮罩已有，改造需保留其视觉体系（cgzxui）
- **并行会话**：本仓库多会话共用 main，遵守 CLAUDE.md 并行会话协作约定（只 add 明确路径、commit 前查 status）
- **测试盾**：SCCA 01/02 盾绑定关系见 memory（`scca-test-shield-allocation`），换绑需走既有流程

## 7. 关联阅读

- `docs/superpowers/specs/2026-11-04-ocr-service-takeover-config-design.md`（500MB 全链审计原始记录）
- CLAUDE.md：「双信封新轨·生产启用前清单」「供应商门户」「开评标管理端」节
- memory：`scca-test-shield-allocation`、`supplier-dualv2-frontend-removed`、`kb-switch-and-scca-wrong-shield-diagnosis`
