# 系统健康页重设计（巡检 + 排查工作台）

日期：2026-10-28 · 状态：已评审待实施 · 页面：:3005 `/admin/health`（侧栏「系统管理」组）

## 背景与问题

现页面三块内容「真实度低、无行动出口」：

| 区块 | 现状 | 问题 |
|------|------|------|
| 组件探活 | `SELECT 1`/ping/ensureBucket/OCR healthz，显示 0~1ms 延迟 | 无容量/余量信息（PG 连接、Redis 内存、OCR 副本数） |
| 近 24h 接口指标 | OperationLog 聚合 | 口径失真——OperationLog **排除**高频轮询端点却标「全量」；错误数无下钻（不知哪个接口、何时、什么错） |
| AI 分析队列 | waiting/active/failed 计数 | 失败任务无任何操作（不看原因/不重试/不清除）；worker 挂没挂不可知 |

用户裁定（2026-10-28）：定位 = **C（巡检 + 排查兼顾）**；实现 = **方案二 + 方案三**（深化数据 + worker 心跳 + 全量计数中间件 + 趋势图）。

## 数据层

### 1. 全量请求指标拦截器（新增）

`apps/api/src/common/metrics.interceptor.ts`（全局，与 OperationLog 拦截器并存互不影响）：

- 响应完成后 fire-and-forget 写 Redis（`.catch(() => {})`，绝不阻塞/影响响应）：
  - 分钟桶：`HINCRBY sys:metrics:24h t:<yyyyMMddHHmm> 1`；statusCode≥400 加 `HINCRBY sys:metrics:24h e:<yyyyMMddHHmm> 1`
  - 接口聚合（**按日滚动 key**，TTL 25h）：`HINCRBY sys:metrics:routes:<yyyyMMdd> "METHOD <routePattern>" 1`；错误单独 `sys:metrics:routes:err:<yyyyMMdd>` 同构——口径如实标「今日」而非混称 24h
  - 路由归一：`req.route?.path`（Express 路由模式，如 `/api/auth/login`）缺失时回退 pathname 去参数——防 id 爆基数
  - 错误时间：`HSET sys:metrics:routes:last:<yyyyMMdd> <route> <ISO>`（仅错误时写，供 Top 错误表显示「最近发生」）
- `sys:metrics:24h` 两个 hash 均 TTL 48h 随写滚动刷新；查询侧忽略 >24h 的分钟字段
- 代价：每请求 2~3 条 Redis 命令（本机 ioredis 无感），比 OperationLog 落库轻一个量级

### 2. worker 心跳

- worker 启动入口（`ai-bid-analysis-worker` bootstrap）加 `setInterval` 30s：`SET sys:aiworker:hb:<pid> <ISO> EX 90`；进程退出不清理（TTL 自然过期）
- **只有 worker 进程写，API 主进程不写**——读不到即「分析服务未运行」
- health 端点 `SCAN sys:aiworker:hb:*` → `{ alive, count, lastBeatAgoSec }`（多副本扩容天然支持）

### 3. 端点（system-config 模块）

| 端点 | 权限 | 说明 |
|------|------|------|
| `GET /system-config/health`（扩展） | admin/leader | 返回体见下 |
| `GET /system-config/recent-errors?limit=20`（新增） | admin/leader | OperationLog statusCode≥400 最近样例：method/path/statusCode/createdAt/durationMs |
| `POST /system-config/queue/:name/retry-failed`（新增） | **admin** | `:name` 白名单校验 ∈ {tender, bidder} 队列名；逐 job `retry()`，**单次至多最新 500 个**，返回 `{retried, skipped}` |
| `POST /system-config/queue/:name/clear-failed`（新增） | **admin** | `queue.clean(0, 'failed')`，返回 `{cleaned}`；**不可恢复**（前端确认弹窗警示） |

`GET /health` 返回体：

```ts
{
  checkedAt: string,
  components: {
    db:    Probe & { activeConns: number, maxConns: number, sizeBytes: number },
           // pg_stat_activity count(*) / max_connections(pg_settings) / pg_database_size(current_database())
    redis: Probe & { usedMemoryBytes: number, clients: number, uptimeSec: number },  // INFO memory/clients/server
    minio: Probe,
    ocr:   { ok: boolean, upCount: number, total: number,
             replicas: Array<{ url: string, ok: boolean, latencyMs: number }> },     // OcrService 新增 probeReplicas()
  },
  api24h: { total, errors, errorRate,        // 全量计数器口径（含轮询）
            p95ms,                           // OperationLog 口径（排除轮询，如实标注）
            series: Array<{ hour: string, total: number, errors: number }> },  // 后端聚合成 24 个小时点
  topErrors: Array<{ method, route, count, lastAt }>,   // sys:metrics:routes:err:<今日> Top 8（口径=今日）
  topSlow:   Array<{ method, path, count, p95ms, maxMs }>, // OperationLog durationMs SQL p95 Top 8
  queues: Record<'tenderProcessing'|'bidderProcessing',
    { waiting, active, failed, lastFinishedAt,
      failedJobs: Array<{ id, name, failedReason(≤300字), failedAt, attempts }> } | null>,  // failedJobs 前 10
  worker: { alive: boolean, count: number, lastBeatAgoSec: number | null },
}
```

## 前端（`apps/web/src/app/(main)/admin/health/page.tsx` 重写）

自上而下「巡检 → 趋势 → 排查」，全部 cgzxui 语言（kpi-card / wb-panel / neu-table-card / wb-alert / neu-btn-xs / workbench Modal）：

1. **page-hero**：行 1 标题 + 状态汇总 chips（组件 N/N · 分析服务 运行中/未运行 · 24h 错误率）+ 刷新；行 2 = 探活瓷片 ×5（`grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`）：
   - PostgreSQL：活跃连接 x/y · 库大小；Redis：内存 · 客户端数；MinIO：正常 · 延迟
   - OCR 微服务：副本 n/m · 延迟（逐副本探测）；分析服务：运行中 · 心跳 Ns 前（异常红显「未运行 · 最后心跳 N 小时前」）
2. **24h 趋势卡**（wb-panel）：请求量面积线 + 错误柱双序列；**手写 inline SVG 不引图表库**；`var(--brand)`/`var(--danger)` oklch 用色；hover 高亮小时点显示数值；`prefers-reduced-motion` 静态
3. **接口表现卡**（neu-table-card）：顶部汇总行（总量 · 错误率 · P95〔日志口径〕）；**今日 Top 错误接口**（方法+路径、次数、最近发生）与 **Top 慢接口〔24h 日志口径〕**（路径、p95、次数）两表并排（窄屏堆叠）；错误行点击 → Modal 展示最近 20 条错误样例
4. **AI 队列卡**（neu-table-card）：每队列一行（等待/执行中/失败/最近完成于）+ 失败任务明细展开（前 10：名称、原因片段、失败时间、尝试次数）；admin 行内「重试失败 / 清除失败记录」（`neu-btn-xs is-warning / is-danger` + 确认弹窗）；**分析服务未运行且 waiting>0 → 卡顶 `wb-alert warning`** 告警横幅

**降级与空态**（无假数据铁律）：计数器无历史（刚上线）→ 趋势图如实显示「自部署起累积」；队列数据 null（Redis 故障）→ 「不可用」；探活失败 → 瓷片红显错误摘要。

## 测试

- **API 单测**：`metrics.interceptor.spec.ts`（计数递增 / 错误分类 / route 归一 / TTL 刻画）；worker 心跳 SCAN 解析
- **e2e**（`apps/api/test/`）：admin 登录 → `GET /health` 形状断言（`components.api24h.topErrors.topSlow.queues.worker` 字段存在；worker.alive 不论真假）；leader 调 `POST retry-failed` → 403
- **前端**：`tsc --noEmit` + 真数据手工验证（沿用仓库惯例，不建组件测试）

## 部署 / 迁移 / 协调

- 无 Prisma 迁移；新增 Redis key 三族（`sys:metrics:24h`、`sys:metrics:routes*`、`sys:aiworker:hb:*`）
- 趋势与全量计数**自部署起累积**（首日不完整属如实展示）；worker 心跳需重启 worker 进程生效
- 并行会话在本页有 12 行未提交文案 diff——重写覆盖，措辞意图保留；提交走 hunk 外科协调
