# 信息门户(:3002)搜索完善——项目编号可搜 + 顶栏实时全库搜索 设计

日期：2026-10-14 · 状态：已批准（方案 C）

## 问题

用户输入项目编号（如 `SWZB-2026-XJB02`）搜不到项目相关公告。三个断点：

1. **后端 search 字段缺失（根因）**：`AnnouncementService.list()` 与 `companyCounts()` 的 `params.search` 只构造 `OR: [title contains, content contains]`，不含 `relatedProjectCode`（公告的结构化项目编号字段，前端 `AnnouncementItem.code` 即映射自它）。`list()` 被 `publicList`(:3002/:3004 供应商端共用) 与管理端(:3005) 三处复用，一处缺失三处皆哑。
2. **顶栏下拉只搜首页预取窗口**：`unified-header.tsx` 对 `announcements` prop（首页按类型各取 5 条，≤45 条）做客户端 `title/code` 过滤——窗口外的项目编号在下拉中永不出现。
3. **列表页兜底分支过滤过窄**：API 失败回退本地 `ANNOUNCEMENTS` 时按 `title.includes || code.includes` 过滤（大小写敏感）；搜索框每次按键即触发一次 API 请求，无防抖。

## 方案（C：全链路）

### 后端 `apps/api/src/announcement/announcement.service.ts`

- `list()` 与 `companyCounts()` 的 search `OR` 追加 `{ relatedProjectCode: { contains: params.search, mode: 'insensitive' } }`。
- 管理端搜索、公司分组计数同步受益，无行为破坏（OR 集合扩充，旧命中集是子集）。
- 不入 jsonb `metadata.projectCode` path 搜索——`relatedProjectCode` 为主链路，jsonb path contains 复杂度高收益低（YAGNI）。

### 顶栏下拉 `apps/public-portal/src/components/unified-header.tsx`

- 输入 ≥2 字符、250ms 防抖、AbortController 取消过期请求，调 `fetchPublicAnnouncements({ search, pageSize: 8 })`（即 `GET /api/announcements/public`，公开接口自带 120/min 节流，防抖下单次输入 ≈ 个位数请求）。
- 请求期间下拉显示「搜索中…」；成功后结果集替换本地过滤结果；失败（网络/5xx）回退本地过滤（现状行为）。
- 结果 title/code 中命中片段高亮（`<span>` 品牌蓝加粗，非 `<mark>` 默认黄底）。
- 文案：placeholder「搜索公告标题、项目编号…」；空态提示「输入公告标题或项目编号进行搜索」。
- 键盘导航 / 历史记录 / Enter 跳列表页行为不变。

### 列表页 `apps/public-portal/src/app/announcements/page.tsx`

- 搜索输入防抖 300ms 再触发 API 请求（输入态与查询态分离）。
- placeholder 改「搜索公告标题、项目编号...」。
- 兜底分支过滤改大小写不敏感。

### 测试

- `announcement.service.spec.ts` 新增 describe：`list({search})` 构造的 `where.OR` 含 `relatedProjectCode` contains（mock Prisma 断言）；`companyCounts` 同。
- 前端过 `tsc --noEmit`。
- 手工冒烟：curl `GET /api/announcements/public?search=<真实项目编号>` 命中。

## 不做的事

- 项目维度分组聚合（同一编号搜出即该项目的全部公告，类型 badge 已区分）。
- 全角/半角横杠归一（低频）。
- `relatedProjectCode` 加索引（公告表量级小，seq scan 可接受；量大时再议）。
