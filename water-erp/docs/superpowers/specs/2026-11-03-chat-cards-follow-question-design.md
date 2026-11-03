# 水叮当·表下真图 + 回答跟随提问 设计规格

> 日期：2026-11-03 · 状态：设计已获用户批准（全量 5 类 SVG / 规则闸 / 两端一致 三项裁定）
> 前置：:3011 水叮当 Tab（2026-10-22 创新版）、chart.mapper 图卡体系（:3005 ECharts）

## 1. 背景与根因

用户报告两问题：① 表卡下方没有图；② 回答不跟随提问、每答必带表。三层根因：

| 层 | 根因 | 证据 |
|---|------|------|
| ① | cockpit 工具表卡无 `viz` 声明 → 图卡从不生成（两端皆无） | `cockpit.tool.ts` 0 处 viz |
| ② | 图卡到 :3011 只渲染「图表详见电脑端」占位（当时移动端不画图） | `chat-card.tsx:5-12` |
| ③ | 卡片挂载无条件：`pushCardsWithCharts` 全量透传；正常聊天路径**强制补挂 global_overview**（一次 4 表+图）；快捷问题直派必挂 | `assistant.service.ts:417-421`、`pushCardsWithCharts` |

另：cockpit 节资表数值列是格式化字符串（`"5.4%"`/`"28.00万"`），viz 数值引用会 NaN→0——需隐藏数值列配合。

## 2. 用户裁定

1. 移动端图卡：**全量 5 类手写 SVG**（bar/line/pie/hbar/grouped_bar，零 echarts 依赖）
2. 按需出卡：**确定性规则闸**（无 LLM 额外步骤，零延迟零成本）
3. 影响面：**两端一致**（服务端收口，:3005/:3011 同步生效）

## 3. 方案

### 3.1 图卡自包含（chart.mapper.ts）

`ChartCard` 新增 `data`（与 `option` 并存——:3005 继续用 option/ECharts，:3011 用 data/SVG）。图卡从此可独立于表卡被消费。实施时细化为**派生序列**（与 ECharts 视图同源派生，消费端免重算排序/TopN）：

```
data: {
  rows:   Array<Record<string, unknown>>;              // 原始行（已滤 _total）
  points: Array<{ name: string; value: number }>?;     // pie/bar/hbar 降序；line 时间升序
  labels: string[]?;                                    // line/grouped_bar 的 x 轴标签
  series: Array<{ name: string; values: number[] }>?;   // grouped_bar 干净数值系
  total:  number?;                                      // pie 中心总计
}
```

### 3.2 cockpit 补 viz（cockpit.tool.ts）

- `stages`：`viz: { kind: 'distribution', category: '阶段', value: '项目数' }`（项目数本为数值 ✓）
- `savings`：rows 增隐藏数值键 `节资率数值`（number），补 `columns: [项目, 节资率, 节约额]`（前端表列以 columns 为准，数值键不显示）；`viz: { kind: 'ranking', category: '项目', value: '节资率数值' }`
- `risk`：不配图（2-5 行风险明细，图无增益）

### 3.3 规则闸（pushCardsWithCharts 重构为「过滤+汇报」）

```
metric 卡           → 原样保留
table 卡有 viz      → 保留表 + 生成图（分布/趋势/排名类，图即答案形状）
table 卡无 viz 且 行数≤3 且 数据键≤2 → 丢弃，rows 序列化进 droppedData（数字进正文）
其余无 viz 表卡      → 保留表（多行多列明细）
```

返回 `{ attachedCount, droppedData: string[] }` 供调用方调整提示词。

### 3.4 提示词随挂载结果自适应

- **直派路径**（快捷问题）：挂了卡 → 现文案「卡片已在前端渲染」；全被闸丢弃 → 「数据不挂卡片，请把关键数字自然写进正文」。
- **正常聊天路径**：
  - **删除强制补挂 global_overview**（「保证每次产出图表」旧目标作废——回答跟随提问）
  - 工具全成功但卡全被闸丢弃 → 不再走「cards=0 即失败」早退；droppedData 并入 toolSummary 继续生成数据落地的正文
  - 仅当 `successCount === 0` 才报查询失败

### 3.5 :3011 五类 SVG 渲染器（新组件 m/chart-card-svg.tsx）

- 按 chart 卡 `chartType` 分发（**复用 mapper 已有的智能选型**：≤5 类饼 / 6-12 柱 / >12 横柱 top10）
- 数据取 `card.data`；调色板复用 mapper 同源 8 色（跨门户小工具各自一份，仓库惯例）
- dataviz 规范：细 mark、4px 圆角数据端、直接标签（非逐点）、reduced-motion 直通、2px 表面间隙
- 替换 `chat-card.tsx` 的 chart 占位分支；`data` 缺失（存量会话历史卡）回退占位文案

## 4. 效果对照

| 问句 | 现状 | 改后 |
|------|------|------|
| 「哪个阶段最堵」 | 正文 + 8 行裸表 | 正文 + 阶段分布柱图（图即答案） |
| 「节资排名前三」 | 正文 + 表 | 正文 + 排行横柱图 |
| 「本月成交额多少」 | metric 卡 | 不变（本就合理） |
| 随口追问/一句话可答 | 拖表（甚至 4 表） | 纯文字（小结果数字进正文） |
| 「各公司成交对比」 | 表 + 图占位 | 表 + 真图 |

## 5. 数据与安全口径

- 公司隔离/allowedTools/ctx 收口全部不动（闸只过滤卡片呈现，不碰工具执行与权限）
- :3005 渲染零改动（option 原样；仅多了无人消费的 data 字段）
- 存量会话历史卡（无 data 的 chart 卡）回退占位——不迁移不重算

## 6. 测试与验收

- 后端单测：mapper data 字段 / 规则闸四分支 / cockpit stages+savings viz（含隐藏数值列不进表列）/ 直派提示词两态 / 正常路径去强制补挂 + 卡全弃仍出数
- 前端：五类 SVG 渲染器（tsc/lint/build + 手动五类各问一次）；存量历史卡回退占位
- 回归：assistant 既有 spec 全绿；mobile-cockpit e2e 不动
