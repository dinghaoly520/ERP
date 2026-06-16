# 前端交互式图表重设计 — 数据驱动的可视化层

> 状态：设计完成，待用户审阅
> 日期：2026-06-16
> 前置：替代 2026-06-15 的 Python 沙箱方案（已废弃）

## 1. 目标

将助手门户的数据可视化从"LLM 生成 Python 代码 → 后端执行 matplotlib → PNG"改为"数据工具声明可视化 → 映射器确定选图 → 前端 ECharts 交互式渲染"。

核心收益：
- **零出错**：图表类型由数据形状 + 固定规则决定，LLM 不参与画图
- **零延迟**：无 Python 进程、无 MinIO 上传，数据到了毫秒出图
- **全交互**：hover 看数值、图例筛选、动画过渡
- **视觉统一**：全局 ECharts 主题，所有图表共用一套配色/字体/间距
- **安全简化**：删除整套 Python 沙箱（AST 检查、子进程、图床），纯前端渲染

## 2. 架构：三层 + LLM 只做文字

```
① LLM 理解意图 → TOOL_CALL 调数据工具
② 数据工具查询 → 返回 table（含中文标签）+ viz 声明
③ 可视化映射器（纯函数，无 AI）→ 读 viz.kind → 选图表 → 生成 ECharts option
④ LLM 第二轮 → 基于数据写文字分析（不碰图表）
⑤ 前端 ChartRenderer → 收到 option → ECharts 渲染（交互/动效自带）
```

LLM 在 ①④ 只做语义理解和文字叙述，在 ②③ 完全不参与图表生成。

## 3. 可视化分类法（5 种 viz kinds）

| viz.kind | 数据特征 | 选图规则 | 典型场景 |
|---|---|---|---|
| `distribution` | 类别 + 数量 | ≤5类→饼图；6-12类→竖柱；>12类→横柱(top10) | 阶段分布、状态分布、专业方向 |
| `composition` | 部分占整体 | 饼图/环形图 | 采购类型占比、预算构成 |
| `trend` | 时间 + 数值 | 折线图（x 轴按时间排序） | 月度招标数量、入库趋势 |
| `ranking` | 实体 + 数值 | 横向柱状图（降序，top N） | 投标次数排名、部门采购额 |
| `comparison` | 多维并列 | 分组柱状图 | 各部门 × 各状态 项目数 |

## 4. viz 声明契约

数据工具在返回 table card 时，**可选**附带 `viz` 字段。由工具作者（懂业务）填写，非 LLM：

```typescript
{
  type: 'table',
  title: '招标项目阶段分布',
  columns: [{key:'stage',label:'阶段'},{key:'count',label:'数量'}],
  rows: [{stage:'在线开标',count:1}, ...],
  viz?: {
    kind: 'distribution' | 'composition' | 'trend' | 'ranking' | 'comparison';
    category?: string;     // 分类/实体字段（distribution/ranking/comparison）
    value: string;         // 数值字段
    timeField?: string;    // 时间字段（trend）
    seriesField?: string;  // 分组字段（comparison）
    topN?: number;         // 只显示前 N（ranking）
  }
}
```

无 `viz` 的 table → 只渲染表格，不出图。

## 5. 映射器确定性规则

映射器是纯函数 `mapToChartOption(table): ChartCard | null`，规则写死：

```
distribution:
  n = rows.length
  n <= 5  → pie（带百分比 + 数值标签）
  n <= 12 → bar（竖柱，按数值降序）
  n > 12  → hbar（横柱，top 10）

composition:
  → pie（环形，中心显示总数）

trend:
  → line（x 轴时间排序，平滑曲线，面积填充淡色）

ranking:
  → hbar（横向柱，降序，top topN || 10）

comparison:
  → grouped bar（分组柱，图例）
```

**视觉铁律（焊在映射器，不可违反）：**
- 柱状图按数值降序（绝不按字母/录入序）
- Y 轴从 0 起
- 每根柱/每个扇区直接标数值
- 强调色：最大值用 `#2563EB`，其余降饱和蓝灰

## 6. 前端组件架构

```
DataCanvas
├── TableCard（保留）
└── ChartCard（新）
    └── ChartRenderer
        └── <ReactECharts option={option} theme="shuidf" />
```

- `ChartRenderer`：收后端算好的 `option`，套主题 `shuidf`，自适应高度（饼图正方形，柱/线 16:9），加载/错误兜底
- 主题 `shuidf`：一次性定义配色、字体、网格线、tooltip、动画，所有图表共用

## 7. ECharts 主题（shuidf）

配色：`#2563EB / #0891b2 / #7dd3fc / #0d9488 / #6366f1`（品牌蓝系循环）
字体：浏览器默认中文字体，永不出现豆腐块
网格线：极淡灰 `rgba(201,217,239,0.25)`，y 轴虚线
tooltip：白底卡片，阴影，显示分类名 + 数值 + 占比
动画：600ms 缓动，渲染时柱子从底部长出

## 8. 质量保证清单

| 维度 | 保证 |
|---|---|
| 配色 | 统一蓝系，强调色突出故事数据 |
| 字体 | 浏览器字体，中文永不豆腐块 |
| 标签 | 柱/饼直接标数值，不用读坐标轴 |
| 排序 | 柱图按值降序，排名取 top N |
| 单位 | 金额自动转"万/亿"，百分比带 % |
| 去噪 | 无 3D、无渐变填充、网格线极淡 |
| 交互 | hover 看明细、图例点击筛选、动画过渡 |
| 响应 | 自适应容器宽度 |

## 9. 代码改动

**删除（整套 Python 链路）：**
- `apps/api/src/assistant/python-sandbox.service.ts` + 单元测试
- `assistant.service.ts` 里的 Python 代码块提取/执行逻辑、`inferChartTitle/Type/Caption` 辅助方法
- `system-knowledge.ts` 里的"图表生成规则"（Python 那段）
- `PythonSandboxService` 在 AssistantModule 的注册
- types 里 chart 卡片的 `imageUrl` 字段（改为 `option`）

**保留：**
- 所有数据工具（加 `viz` 声明）
- 表格渲染、对话/数据双模式、IndicatorBar
- ChartLightbox（前端图本身可交互，但保留全屏查看入口）

**新增：**
- `viz` 类型定义（前端 types.ts + 后端 assistant-tool.ts）
- 后端可视化映射器 `chart.mapper.ts`（纯函数，可单测）
- 各工具补 `viz` 声明
- 前端 `ChartRenderer` 组件 + ECharts 主题文件
- 安装 `echarts` + `echarts-for-react`

净效果：删除 Python 沙箱 230+ 行，新增映射器 ~100 行 + 前端组件 ~80 行，代码量减少。

## 10. 兜底与边界

| 情况 | 处理 |
|---|---|
| 工具无 viz 声明 | 只出表格，不出图 |
| 数据为空 | 图表区显示"暂无数据"占位 |
| 单一分类（n=1） | 不出饼图，只出表格 |
| 趋势只有 1 个时间点 | 不出折线，只出表格 |
| LLM 问了工具未覆盖的问题 | 出表格 + 文字分析，不出图 |
| option 异常 | ChartRenderer 显示"图表加载失败"占位 |

## 11. 落地顺序

1. 映射器 + ChartRenderer（核心，一个 distribution 跑通闭环）
2. `global_overview` 工具加 viz 声明，端到端验证
3. 删除 Python 沙箱链路
4. 其余工具（bid/supplier/expert/announcement/mall/notification）补 viz 声明
5. 打磨 ECharts 主题

每步可见效果，不会做完一大块才发现方向错。

## 12. 测试要点

- 单元：`mapToChartOption()` 各 kind 的选图规则、降序、topN 截断、空数据/null 返回
- 集成：`global_overview` 端点 → cards 含 chart 类型且 option 正确
- E2E：数据模式切换、图表 hover/图例交互、空状态占位
