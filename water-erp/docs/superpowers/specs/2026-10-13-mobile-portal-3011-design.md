# 移动端驾驶舱门户（:3011）设计

- **日期**：2026-10-13
- **状态**：已获用户批准（分节确认，2026-10-13 会话）
- **类型**：新门户 app（只读浏览）

## 背景与目标

:3005 采购管理工作台的「驾驶舱」组（数据库 / 采购台账 / 采购进度，仅 leader/admin 可见）目前只有桌面布局。用户需要一个新的 **:3011 端口、手机适配**门户，承载同样内容，供领导移动端随时查看，并与现有系统深度融合（同风格、同数据口径、同鉴权体系）。

## 决策记录

| 决策点 | 结论 | 理由 |
|--------|------|------|
| 功能范围 | **只读浏览**（统计/列表/详情下钻） | 驾驶舱本质是「看数据」；写操作留桌面端，避免移动端误触 |
| 登录账号 | 种子新增 `admin` / `admin123`（role=admin） | 专用账号不与任何人现有会话互踢；admin 视角=全部公司+公司选择器 |
| 会话命名空间 | 复用 `token_web`（`X-Portal: web`） | 后端零代码改动；单设备语义仅约束该专用账号 |
| 实现路线 | **方案一：独立轻应用 `apps/mobile-portal`**（bigscreen 先例） | 对 :3005 零风险；移动优先布局自由；三页 API 模块类型少量复制可接受 |
| 否决项 | 方案二（抽共享包双端消费）——需重构 :3005 三张活跃页，过度设计；方案三（:3005 响应式改造）——与独立端口要求冲突 | |

## ① 总体架构

```
apps/mobile-portal/
├── package.json                    # name: mobile-portal，dev -p 3011 -H 0.0.0.0
├── next.config.ts                  # allowedDevOrigins（局域网手机访问）
├── src/
│   ├── proxy.ts                    # 复制 web 版：/api/* 全量透传 → :4001，默认 x-portal: web
│   ├── app/
│   │   ├── layout.tsx              # 移动根布局：viewport-fit=cover 安全区、字体
│   │   ├── login/page.tsx          # 移动版登录页
│   │   └── (main)/
│   │       ├── layout.tsx          # 顶栏 + 底部 Tab 栏（数据库/台账/进展）+ 鉴权守卫
│   │       ├── dashboard/page.tsx  # 数据库
│   │       ├── ledger/page.tsx     # 台账
│   │       └── progress/page.tsx   # 进展
│   ├── lib/
│   │   ├── api/{api-fetch,dashboard,procurements,progress}.ts  # 从 web 复制（类型即契约）
│   │   ├── session-store.ts        # X-Web-Token tab 级会话
│   └── components/                 # BottomSheet、指标卡、SVG 图表移植等
```

- **零后端代码改动**：消费现有 `GET /api/dashboard`、`GET /api/procurements`（+`/stats`、`/company-counts`、`/methods`）、`GET /api/progress/stats`（+`/ai-insights`）；公司隔离由 `CompanyScopeService` 保证
- **无图表库依赖**：桌面端图表为手写内联 SVG，直接移植适配
- 融合点：`packages/config/src/ports.ts` 加 `mobile: 3011`；根 `package.json` 加 `dev:mobile` 并纳入 `pnpm dev` 与 `dev:kill`；CLAUDE.md 门户表 + ACCOUNTS.md 补录

## ② 鉴权与账号

- 种子新增 User：username `admin`、role `admin`、密码 `admin123`（bcrypt 落 `seed-data/User.json`；`[username, role]` 复合唯一，不与 `Swhi-CGZX-admin` 冲突）
- 登录 `POST /api/auth/login` + `X-Portal: web` → 写 `token_web` cookie；access_token 存 sessionStorage，请求带 `X-Web-Token` 头（与 :3005 同轨）
- admin 从 web 门户登录按 X-P1-01 逻辑保持 `token_web`，视角=全部公司 + 公司选择器
- 401 / `SESSION_REPLACED` → 清会话回登录页；只读门户不挂 SessionWatchdog 心跳

## ③ 三页移动端信息架构

全局骨架：顶栏（品牌 + 页内全局控件 + 退出）+ 底部 Tab「数据库 / 台账 / 进展」。桌面 Modal 下钻统一改**底部弹层**；宽表/多列网格改**卡片列表**。

**数据库**：日期范围快捷档（本月/本季/本年+自定义）+ 公司选择器（admin）；汇总指标 2 列卡网格；执行趋势 SVG 曲线（点数据点→弹层当日项目）；各部门分布横向条形列表（完成率进度条，点击→弹层）；采购方式/未成交原因环形图（点分段→弹层）；项目规模分段卡；节资排行 Top5 / 风险预警 / 供应商动态卡片列表；AI 综合分析默认折叠卡。

**台账**：搜索框 + 筛选 chips（结果状态/采购方式，admin 加公司）；分页卡片流（滑到底自动加载）；卡片=项目名/日期/方式/部门/预算→中标/状态徽标；点击→弹层详情（基本信息+轮次时间线+参与供应商）；无任何写操作入口。

**进展**：概览指标卡（在办/本月新增/本月完成/近期活跃+环比）；阶段分布横向条+平均阶段耗时；AI 进度洞察卡（urgency 着色）；项目清单卡（当前阶段徽标+紧凑步进条，点开看全时间线）。

## ④ 视觉适配细则

- cgzxui 同源：oklch 令牌、页面底色 `oklch(0.975 0.012 258)`、neu 方向性双影、1px 发丝线、Lucide 1.5px、rounded-2xl 卡片 / rounded-xl 按钮、等宽数字
- 移动专项：375px 基准单列；触摸目标 ≥44px；底部 Tab 适配 `env(safe-area-inset-bottom)`；除图表容器外禁横向滚动；字号 clamp；骨架屏/空态（无 mock fallback——仓库铁律）
- 访问：`-H 0.0.0.0`，手机同 WiFi 访问 `http://<局域网IP>:3011`

## ⑤ 错误处理

- 401 / `SESSION_REPLACED`：API 包装层统一捕获 → 清 sessionStorage → 跳登录页（无遮罩弹窗）
- API 失败：页顶红色横幅「数据加载失败+重试」，**保留最近数据**（:3007 任务板 O5/O6 模式），不白屏
- 代理 502：横幅「后端服务未启动」
- 登录失败：行内错误（映射后端 code 文案）；限流由后端 login 10/min 兜底
- 空数据：显空态文案不隐藏区块；加载中：首屏骨架屏、翻页/下钻局部 spinner

## ⑥ 测试与集成验证

- 质量闸：`tsc --noEmit` + `next build` + `eslint` 全过（门户侧无单测基建，随仓库惯例）
- 后端零代码改动不动 CI；seed 改动随 `pnpm db:seed` 幂等生效
- 人工冒烟清单：
  1. `pnpm db:seed` → `admin/admin123` 从 :3011 登录，role=admin，见全部公司数据
  2. 数据库页：指标/趋势/部门/方式环形/节资排行/风险预警真实数据 + 弹层下钻正常
  3. 台账页：搜索+筛选+分页加载+详情弹层（轮次+供应商）完整
  4. 进展页：概览/阶段分布/AI 洞察/时间线渲染正常
  5. 手机实测（局域网 IP）：375px 布局、底部 Tab、安全区、触摸目标
  6. 回归：:3005 以 `Swhi-CGZX-01` 登录不受影响（不同账号不互踢）
- 文档融合：CLAUDE.md 门户表加 :3011 行、ACCOUNTS.md 补账号

## 范围外（YAGNI）

通知/站内信、水叮当聊天面板、全局搜索、写操作、SessionWatchdog 心跳、CI 流水线改动、echarts 等图表库。
