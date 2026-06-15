# 分析画布重设计 — AI 问答驱动的数据可视化工作台

> 状态：设计完成，待用户审阅
> 日期：2026-06-15

## 1. 目标

将助手门户（3008）的分析画布从"静态卡片容器"改造为"与 AI 问答深度联动的数据可视化工作台"：
- 数据支撑：对话中引用的数据在画布中自动可视化
- 数据展示：结构化卡片随对话实时更新
- 数据绘图：Python 渲染的高质量图表（折线/柱状/饼图/散点等）

## 2. 交互模式

### 2.1 跟随式画布（Follow Mode）

画布内容始终跟随"当前对话话题"。每轮 AI 回答产出的数据卡片（metric/table/chart）绑定到当前消息，切换对话 → 画布内容同步切换。

### 2.2 全宽切换

- **默认：对话模式** — 消息列表占满主区域全宽，底部有迷你指示条（常驻）
- **数据模式** — 画布全屏占据主区域，隐藏消息列表；顶部显示"← 返回对话"按钮和当前话题名；底部有浮动输入栏可边看数据边追问
- 切换方式：
  - 点击底部指示条 → 进入数据模式
  - 点击"← 返回对话" → 回到对话模式
  - 快捷键 `Cmd/Ctrl + D` → 来回切换
  - 发送新消息 → 自动切回对话模式（用户需要看回复）

### 2.3 图表卡片交互

悬浮图表卡片时展示工具栏：
- 放大：点击图表 → 弹出灯箱，满屏查看高分辨率图
- 下载：下载 PNG
- 追问：自动生成上下文相关追问（如"解释这个趋势的原因"、"预测下月走势"）

## 3. 数据流

```
用户提问
  │
  ▼
┌──────────────────────────────────────────┐
│ 1. AI 第一轮：识别意图 → TOOL_CALL        │
│    工具查询数据库，返回原始 data + cards    │
└──────────────────────────────────────────┘
  │
  ▼
┌──────────────────────────────────────────┐
│ 2. AI 第二轮：基于 data，同时产出：          │
│    a) 文字回答（自然段落，含数据引用）       │
│    b) Python 图表代码（```python 块）      │
└──────────────────────────────────────────┘
  │
  ├── a) 文字 → 剥离代码块 → 消息气泡
  │
  └── b) Python 代码块
        │
        ▼
┌──────────────────────────────────────────┐
│ 3. PythonSandboxService                  │
│    - AST 安全检查（禁止 os/subprocess 等）  │
│    - 数据通过 JSON 注入代码                │
│    - spawn python3，30s 超时              │
│    - 输出 PNG → 上传 MinIO → 返回 URL      │
└──────────────────────────────────────────┘
  │
  ▼
┌──────────────────────────────────────────┐
│ 4. 返回前端                              │
│    { answer, cards: [                     │
│        {type:"metric", ...},              │
│        {type:"table", ...},               │
│        {type:"chart", chartType:"bar",    │
│         imageUrl:"http://minio/xxx.png"}  │
│    ]}                                    │
└──────────────────────────────────────────┘
  │
  ▼
┌──────────────────────────────────────────┐
│ 5. 前端画布（全宽数据模式）                  │
│    - metric/table：HTML 渲染               │
│    - chart：<img> 加载 MinIO 图片          │
│    - 每轮回答的 cards 替换上一轮             │
└──────────────────────────────────────────┘
```

## 4. Python 沙箱

### 4.1 执行约束

| 约束 | 值 |
|---|---|
| 超时 | 30 秒 |
| 输出大小上限 | 5 MB |
| 中文字体 | 自动检测系统字体，找不到则用 sans-serif 兜底 |
| 系统依赖 | matplotlib, numpy, pandas（pip install） |
| 工作目录 | /tmp/assistant_charts/（每次执行后清理临时文件） |

### 4.2 安全检查（AST）

代码在 `spawn` 前做 AST 遍历，禁止以下节点：
- `import os`, `import subprocess`, `import socket`, `import sys`（只允许 `import matplotlib`, `import numpy`, `import pandas`, `import json`）
- 访问 `__builtins__`, `eval`, `exec`, `open`, `compile`
- 禁止的模块出现 → 立即拒绝执行，返回安全错误

### 4.3 执行流程

```
1. 提取 ```python 代码块
2. 在代码头部自动注入：
   - import json
   - data = json.loads('''<serialized_tool_data>''')
   - 中文字体自动设置（matplotlib rcParams）
3. 写入临时文件 /tmp/assistant_charts/script_<uuid>.py
4. spawn: python3 /tmp/assistant_charts/script_<uuid>.py
5. 读取输出图片 /tmp/assistant_charts/output_<uuid>.png
6. 上传 MinIO：assistant/charts/<uuid>.png
7. 返回 URL
8. 清理临时文件
```

### 4.4 降级策略

- 代码块不存在 → 无图表，只返回文字
- AST 安全检查拒绝 → 删除代码块，返回文字
- 执行超时/异常 → 删除代码块，返回文字 + 后端日志告警
- 图片为空 → 删除代码块，返回文字

降级不影响对话体验，图表是增强不是必需。

## 5. 后端变更

### 5.1 新增：PythonSandboxService

```
apps/api/src/assistant/python-sandbox.service.ts
```

```
class PythonSandboxService {
  // 主入口：执行 Python 代码，返回图片 URL 或错误
  async execute(code: string, data: unknown): Promise<
    { success: true; imageUrl: string } | { success: false; error: string }
  >

  // AST 安全检查
  private validateCode(code: string): { valid: boolean; reason?: string }

  // 注入数据 + 字体设置到代码头部
  private prepareCode(code: string, data: unknown): string

  // spawn python3 并等待结果
  private spawnPython(scriptPath: string, outputPath: string): Promise<void>

  // 上传到 MinIO 并返回 URL
  private uploadToMinIO(localPath: string): Promise<string>
}
```

### 5.2 修改：AssistantService.chat()

`handleNormalChat()` 流程变更：
1. 第二轮模型返回 `answer` 文本后
2. 从 `answer` 中提取 ````python ... ```` 代码块
3. 如果存在代码块 → 调用 `PythonSandboxService.execute(code, toolData)`
4. 成功 → 生成 chart card 加入 `cards` 数组；从 `answer` 中删除代码块
5. 失败 → 从 `answer` 中删除代码块；追加一行"图表生成失败：xxx"
6. 其余流程不变（保存消息、返回前端）

### 5.3 更新：ToolResult 类型

`apps/api/src/assistant/tools/assistant-tool.ts` — `AssistantCard` 新增 chart 类型：

```typescript
| {
    type: 'chart';
    title: string;
    chartType: 'bar' | 'line' | 'pie' | 'scatter' | 'radar';
    imageUrl: string;
    caption?: string;
  }
```

### 5.4 更新：系统提示词

在 `system-knowledge.ts` 中追加：

```
【图表生成规则】
- 当工具返回的数据适合可视化展示时，在回答末尾追加一个 Python 代码块。
- 数据变量已预定义为 data，直接使用，无需重新声明或赋值。
- 图表要求：
  · 配色使用蓝色系（#2563EB, #0891b2, #7dd3fc, #0d9488, #6366f1）
  · 白色背景，无网格线（或极淡灰色网格线）
  · dpi=120，figsize=(8, 5)
  · 只生成一个图表，选择最合适的图表类型
  · 中文标签字体大小 12-14px
- 代码块放在文字回答之后，用独立一行空行分隔。
```

## 6. 前端变更

### 6.1 组件树

```
page.tsx
├── HistorySidebar（不变）
├── ChatWorkspace（重构）
│   ├── Header（不变）
│   ├── MessageList（对话模式显示）
│   ├── DataCanvas（数据模式显示 — 全宽替换 MessageList）
│   │   ├── CanvasHeader（返回按钮 + 话题名）
│   │   ├── CanvasGrid（metric/table/chart 自适应网格）
│   │   └── ChartLightbox（图表灯箱放大）
│   ├── IndicatorBar（底部迷你指示条 — 始终显示）
│   └── InputBar（浮动输入栏 — 始终显示）
```

### 6.2 DataCanvas（重写 AnalysisCanvas）

- 全宽布局：填满 header 下方全部空间
- 自适应网格：`display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));`
- metric 卡片：紧凑型，保持现有流光边框
- table 卡片：自适应列宽，超宽表格横向滚动
- chart 卡片：`<img>` 加载 MinIO URL，`object-fit: contain`，悬浮工具栏
- 空状态：引导用户提问以生成数据（而非空白）
- 当前话题标签：显示在画布顶部

### 6.3 IndicatorBar（新增）

- 常驻在消息列表底部（对话模式）或画布底部（数据模式）
- 显示："📊 5 张卡片 · 3 张图表 · 2 张表格"
- 在对话模式中为可点击按钮：点击 → 切换到数据模式
- 在数据模式中变为装饰性指示（显示当前位置）
- 毛玻璃背景，贴近底部输入栏上方

### 6.4 ChartLightbox（新增）

- 点击 chart 卡片 → 灯箱弹出，居中显示高分辨率图
- 背景：半透明深色遮罩
- 操作：关闭按钮（右上角 + 点击遮罩）、下载按钮、全尺寸查看
- 键盘：ESC 关闭

### 6.5 模式状态管理

在 `page.tsx` 中新增：
```typescript
const [dataMode, setDataMode] = useState(false); // false=对话, true=数据
```

- 发送新消息 → `setDataMode(false)`
- `handleSelectConversation` → `setDataMode(false)`
- 快捷键监听：`Cmd/Ctrl + D` 切换

### 6.6 CSS 布局

```css
/* 数据模式：全宽画布 */
.workspace[data-mode="canvas"] .messageList {
  display: none;
}
.workspace[data-mode="canvas"] .dataCanvas {
  display: flex;
  flex: 1;
  overflow-y: auto;
}
.workspace[data-mode="chat"] .dataCanvas {
  display: none;
}
```

## 7. 错误处理矩阵

| 场景 | 处理 |
|---|---|
| Python 未安装/不可用 | 启动时健康检查，不可用则禁用图表生成（聊天正常） |
| 执行超时 | 返回文字回答（无图表），日志记录 |
| 生成的代码有语法错误 | 捕获 stderr，删除代码块，返回文字 |
| 图片输出为空 | 降级为纯文字回答 |
| AST 安全检查拒绝 | 删除代码块，文字回答正常展示 |
| MinIO 上传失败 | 前端显示占位图 + "图表加载失败" |
| 前端图片加载超时 | 显示骨架屏 + 重试按钮 |

## 8. 健康检查（启动时）

`PythonSandboxService.onModuleInit()`：
1. 执行 `python3 --version`
2. 执行 `python3 -c "import matplotlib; import numpy; import pandas; print('OK')"`
3. 如任一失败 → 打印 warn 日志，`chartEnabled = false`
4. 后续 `execute()` 调用检查 `chartEnabled`，为 false 则直接返回错误

## 9. 测试要点

- 单元：`PythonSandboxService.validateCode()` — 合法/非法代码 AST 检查
- 单元：`PythonSandboxService.prepareCode()` — 数据注入 + 字体注入正确性
- 集成：`chat` 端点 — 提出数据问题 → 验证 `cards` 数组含 chart 类型
- 集成：沙箱超时 — 死循环代码 → 30s 超时 → 降级返回文字
- E2E：前端数据模式切换、图表灯箱、对话切换后画布内容更新
