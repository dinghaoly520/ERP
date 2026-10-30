# 系统健康页合并操作日志·常驻巡检头+分区 Tab

日期：2026-10-30 · 状态：已确认（用户裁定方案 A）· 页面：:3005 `/admin/health`

## 背景与裁定

用户裁定：操作日志并入系统健康页作为一个板块，并重新规划系统健康的 UI 与页面设计。结构形态选 **方案 A：常驻巡检头 + 分区 Tab**（hero 与探活瓷片常驻 = 巡检第一眼；重查询的日志隔离在 Tab 内按需加载）。

## 页面结构

```
┌ page-hero：标题「系统健康」+ 状态 chips + 刷新
│ 副标题：「各服务组件运行状态、接口表现、分析任务与全站操作审计」
├ 探活瓷片 ×5（PG/Redis/MinIO/OCR/分析服务）——常驻巡检层（2026-10-28 设计原样）
├ page-tab 分区条（role=tablist，复用账号管理三合一页的 page-tab/is-active 体系）
│   ▸ 运行总览（默认）  ▸ 操作日志（仅 admin 可见）
├ Tab 内容区（两 Tab 一旦激活即保持挂载、非激活 CSS 隐藏——切回不丢筛选状态）
```

- **运行总览**：24h 双泳道趋势 → 错误/慢接口榜 → AI 队列卡 + 2 Modal（错误样例、队列确认）——内容与口径零改动平移。
- **操作日志**：wb-toolbar 筛选（关键词/用户名/门户/角色/方法/状态/时间）+ 10 列表 + 行展开详情 + 分页——全功能平移；**首次激活该 Tab 才发起查询**（懒加载）。
- Tab 状态进 URL（`?tab=overview|log`），深链可分享、刷新不丢。

## 路由与导航

- `/admin/operation-log` → 服务端 redirect `/admin/health?tab=log`（旧深链/通知链接不 404；仿 registration-review→/admin/accounts 先例）。
- 侧栏删「操作日志」项；「系统健康」meta → 「运行状态·操作审计」。
- `app/(main)/layout.tsx` 面包屑/激活映射删 operation-log 行。

## 组件拆分与数据流

| 文件 | 职责 |
|------|------|
| `app/(main)/admin/health/page.tsx`（重写） | hero + 瓷片 + Tab 骨架；health 数据获取与页级错误态；isAdmin 判定；useSearchParams 需 Suspense 包裹 |
| `components/admin/health/health-api.ts` | `HealthReport` 等类型 + `api()` 取数函数 + fmt 工具（page 与 overview-tab 共用） |
| `components/admin/health/overview-tab.tsx` | 趋势 + 两榜 + 队列卡 + 2 Modal（props: data/loading/isAdmin/reload；Modal 状态自持） |
| `components/admin/health/operation-log-tab.tsx` | 日志全功能 + 懒加载（armed 标记：首次激活才查） |

数据流：health 数据在 page 层获取（瓷片 + 总览共用）；日志数据在 log-tab 内部自取。

## 权限与错误处理

- 日志 API 本就 admin-only；Tab 可见性用页面既有 `isAdmin`（fetchCurrentUser，与队列操作按钮同款判定）——leader 经 URL 访问只见「运行总览」。
- 日志 403/查询失败：沿用现日志页表格内错误态（不炸整页）；health API 失败仍是页级错误态。

## 不动项与验证

- 后端零改动；2026-10-28 巡检设计的内容、口径、告警语义原样保留。
- 验证：`tsc --noEmit` + eslint + 真数据手工核对（仓库惯例不建组件测试）。核对清单：Tab 切换/深链/刷新保持、旧路由重定向、leader 不见日志 Tab、日志懒加载与筛选分页、总览四区块无回归。
