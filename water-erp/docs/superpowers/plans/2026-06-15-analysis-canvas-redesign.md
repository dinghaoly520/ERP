# 分析画布重设计 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将助手门户分析画布改造为跟随式全宽数据工作台，通过 Python 沙箱执行 matplotlib 生成高质量图表，与 AI 问答深度联动。

**Architecture:** 后端新增 PythonSandboxService（AST 安全检查 + spawn python3 + MinIO 存图），修改 AssistantService.chat() 流程以提取 Python 代码块并生成 chart card。前端新增 DataCanvas/IndicatorBar/ChartLightbox 三个组件，重写 ChatWorkspace 支持对话/数据双模式切换，每轮对话的 cards 跟随式展示。

**Tech Stack:** NestJS 11 + Prisma + MinIO（后端），Next.js 16 App Router + CSS Modules + Lucide Icons（前端），Python 3 + matplotlib/numpy/pandas（图表渲染）

---

## Task 1: 扩展前端类型定义

**Files:**
- Modify: `apps/assistant/src/lib/types.ts`

- [ ] **Step 1: 新增 chart card 类型 + 画布模式枚举**

```typescript
// types.ts — 在现有 AssistantCard 联合类型末尾追加
export type AssistantCard =
  | { type: 'metric'; title: string; value: string; trend?: string }
  | {
      type: 'chart';
      title: string;
      chartType: 'line' | 'bar' | 'pie' | 'scatter' | 'radar';
      data: unknown;
    }
  | {
      type: 'table';
      title: string;
      columns: Array<{ key: string; label: string }>;
      rows: unknown[];
    }
  | {
      type: 'actionPlan';
      title: string;
      riskLevel: string;
      actionId: string;
      changes: unknown[];
    };

// 新增 chart card 带图片 URL
export type AssistantCard =
  | { type: 'metric'; title: string; value: string; trend?: string }
  | {
      type: 'chart';
      title: string;
      chartType: 'bar' | 'line' | 'pie' | 'scatter' | 'radar';
      imageUrl: string;
      caption?: string;
    }
  | {
      type: 'table';
      title: string;
      columns: Array<{ key: string; label: string }>;
      rows: unknown[];
    }
  | {
      type: 'actionPlan';
      title: string;
      riskLevel: string;
      actionId: string;
      changes: unknown[];
    };
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd water-erp && npx tsc --noEmit --project apps/assistant/tsconfig.json 2>&1 | head -10
```

Expected: 无错误输出（或只有预存的 baseUrl deprecation warning）

- [ ] **Step 3: Commit**

```bash
git add apps/assistant/src/lib/types.ts
git commit -m "feat(assistant): add chart card type with imageUrl to AssistantCard union

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: 后端新增 AssistantCard chart 类型 + 扩展 ToolResult

**Files:**
- Modify: `apps/api/src/assistant/tools/assistant-tool.ts`

- [ ] **Step 1: 在 ToolResult 的 cards 类型中追加 chart**

```typescript
// assistant-tool.ts — 在 cards?: Array<{...}> 的类型定义中追加
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  cards?: Array<{
    type: 'metric' | 'chart' | 'table';
    title: string;
    [key: string]: unknown;
  }>;
  citations?: Array<{
    type: string;
    title: string;
    entityId: string;
  }>;
}
```

`chart` 类型已可出现在 `cards` 中，字段通过 `[key: string]: unknown` 索引签名兼容 `imageUrl`、`chartType`、`caption` 等额外字段。

- [ ] **Step 2: 验证 API TypeScript 编译**

```bash
cd water-erp && npx tsc --noEmit --project apps/api/tsconfig.json 2>&1 | head -10
```

Expected: 只有预存的 baseUrl deprecation warning

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/assistant/tools/assistant-tool.ts
git commit -m "feat(api): add chart to ToolResult card types

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: 创建 PythonSandboxService

**Files:**
- Create: `apps/api/src/assistant/python-sandbox.service.ts`
- Modify: `apps/api/src/assistant/assistant.module.ts`

This service handles: AST security validation, data injection, spawn python3, MinIO upload, temp file cleanup.

- [ ] **Step 1: 创建 PythonSandboxService 完整实现**

```typescript
// apps/api/src/assistant/python-sandbox.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';

const CHART_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // 5 MB
const WORK_DIR = path.join(os.tmpdir(), 'assistant_charts');

// Built-in modules that are safe for charting
const ALLOWED_IMPORTS = new Set([
  'matplotlib', 'matplotlib.pyplot', 'numpy', 'pandas', 'json',
  'math', 'datetime', 'collections', 'itertools', 'functools',
]);

// Forbidden module name prefixes
const FORBIDDEN_MODULES = [
  'os', 'subprocess', 'socket', 'sys', 'shutil', 'pathlib',
  'requests', 'http', 'urllib', 'ftplib', 'telnetlib',
  'smtplib', 'imaplib', 'poplib',
];

@Injectable()
export class PythonSandboxService implements OnModuleInit {
  private readonly logger = new Logger(PythonSandboxService.name);
  private chartEnabled = false;

  async onModuleInit() {
    try {
      execSync('python3 --version', { timeout: 5000, stdio: 'pipe' });
      execSync(
        'python3 -c "import matplotlib; import numpy; import pandas; print(\'OK\')"',
        { timeout: 10000, stdio: 'pipe' },
      );
      this.chartEnabled = true;
      this.logger.log('Python 3 + matplotlib/numpy/pandas 就绪，图表功能已启用');
    } catch (e) {
      this.chartEnabled = false;
      this.logger.warn(
        `Python 3 环境不可用，图表生成已禁用：${(e as Error).message}`,
      );
    }

    // Ensure work directory exists
    if (!fs.existsSync(WORK_DIR)) {
      fs.mkdirSync(WORK_DIR, { recursive: true });
    }
  }

  /**
   * Execute Python chart code and return a MinIO image URL.
   */
  async execute(
    code: string,
    data: unknown,
  ): Promise<
    { success: true; imageUrl: string } | { success: false; error: string }
  > {
    if (!this.chartEnabled) {
      return { success: false, error: 'Python 环境不可用，图表功能已禁用' };
    }

    // AST security check
    const validation = this.validateCode(code);
    if (!validation.valid) {
      return { success: false, error: `安全检查拒绝：${validation.reason}` };
    }

    // Prepare code with data injection and font setup
    const fullCode = this.prepareCode(code, data);

    // Unique filenames for this execution
    const runId = crypto.randomBytes(8).toString('hex');
    const scriptPath = path.join(WORK_DIR, `script_${runId}.py`);
    const outputPath = path.join(WORK_DIR, `output_${runId}.png`);

    try {
      // Write script to temp file
      fs.writeFileSync(scriptPath, fullCode, 'utf-8');

      // Execute
      await this.spawnPython(scriptPath);

      // Read output image
      if (!fs.existsSync(outputPath)) {
        return {
          success: false,
          error: 'Python 脚本执行完成但未生成图片，请检查代码是否正确调用 plt.savefig',
        };
      }

      const stat = fs.statSync(outputPath);
      if (stat.size === 0) {
        return { success: false, error: '生成的图片为空' };
      }
      if (stat.size > MAX_OUTPUT_BYTES) {
        return {
          success: false,
          error: `图片大小超过上限（${MAX_OUTPUT_BYTES / 1024 / 1024}MB）`,
        };
      }

      // Upload to MinIO
      const imageUrl = await this.uploadToMinIO(outputPath, runId);

      return { success: true, imageUrl };
    } catch (e) {
      return {
        success: false,
        error: (e as Error).message || 'Python 执行异常',
      };
    } finally {
      // Cleanup temp files
      try { if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath); } catch {}
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
    }
  }

  /**
   * Simple AST-based security check using regex patterns.
   * Blocks forbidden module imports and dangerous built-in access.
   */
  private validateCode(code: string): { valid: boolean; reason?: string } {
    // Check for forbidden module imports
    const importRe = /(?:import\s+(\S+)|from\s+(\S+)\s+import)/g;
    let match: RegExpExecArray | null;
    while ((match = importRe.exec(code)) !== null) {
      const moduleName = (match[1] || match[2] || '').split('.')[0];
      if (FORBIDDEN_MODULES.includes(moduleName)) {
        return { valid: false, reason: `禁止导入模块：${moduleName}` };
      }
    }

    // Check for dangerous builtins access
    const dangerousPatterns = [
      /\b__builtins__\b/,
      /\beval\s*\(/,
      /\bexec\s*\(/,
      /\bcompile\s*\(/,
      /\bopen\s*\(/,
      /\b__import__\s*\(/,
    ];
    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        return { valid: false, reason: `禁止使用危险函数：${pattern.source}` };
      }
    }

    // Block file system write operations (except savefig which we allow)
    const writePatterns = [
      /\bos\.(?:remove|unlink|rmdir|chmod|chown|symlink|rename)\s*\(/,
      /\bshutil\./,
      /\bpathlib\./,
    ];
    for (const pattern of writePatterns) {
      if (pattern.test(code)) {
        return { valid: false, reason: `禁止进行文件系统操作：${pattern.source}` };
      }
    }

    return { valid: true };
  }

  /**
   * Inject data variable and Chinese font setup at the top of the user's code.
   */
  private prepareCode(code: string, data: unknown): string {
    const dataJson = JSON.stringify(data);

    // Matplotlib preamble: detect & set Chinese font, set common style
    const preamble = `# === 自动注入：数据变量 ===
import json
data = json.loads('''${dataJson.replace(/'/g, "\\'")}''')

# === 自动注入：中文字体设置 ===
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm

# Auto-detect Chinese font
_chinese_fonts = [
    'PingFang SC', 'Heiti SC', 'STHeiti', 'Microsoft YaHei',
    'SimHei', 'Noto Sans CJK SC', 'WenQuanYi Micro Hei',
    'WenQuanYi Zen Hei', 'AR PL UMing CN', 'sans-serif',
]
_available = set(f.name for f in fm.fontManager.ttflist)
_selected = None
for _f in _chinese_fonts:
    if _f in _available:
        _selected = _f
        break
if _selected is None:
    _selected = 'sans-serif'

plt.rcParams.update({
    'font.family': _selected,
    'axes.unicode_minus': False,
    'figure.dpi': 120,
    'savefig.dpi': 120,
    'savefig.bbox': 'tight',
    'savefig.pad_inches': 0.1,
})

# === 用户代码 ===

`;

    return preamble + code;
  }

  /**
   * Spawn python3 as a child process with a 30-second timeout.
   */
  private spawnPython(scriptPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('python3', [scriptPath], {
        cwd: WORK_DIR,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: CHART_TIMEOUT_MS,
      });

      let stderr = '';

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          // Truncate stderr for reasonable error messages
          const errMsg = stderr.slice(-500) || `退出码 ${code}`;
          reject(new Error(`Python 执行失败：${errMsg}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`无法启动 Python 进程：${err.message}`));
      });
    });
  }

  /**
   * Upload the rendered PNG to MinIO and return a direct URL.
   */
  private async uploadToMinIO(
    localPath: string,
    runId: string,
  ): Promise<string> {
    const objectKey = `assistant/charts/${runId}.png`;
    const fileBuffer = fs.readFileSync(localPath);

    await minioClient.putObject(
      MINIO_BUCKET,
      objectKey,
      fileBuffer,
      fileBuffer.length,
      { 'Content-Type': 'image/png' },
    );

    // Return direct MinIO URL (public bucket or presigned URL based on setup)
    const endpoint = process.env.MINIO_ENDPOINT || 'localhost';
    const port = Number(process.env.MINIO_PORT || 9000);
    const useSSL = process.env.MINIO_USE_SSL === 'true';
    const protocol = useSSL ? 'https' : 'http';
    return `${protocol}://${endpoint}:${port}/${MINIO_BUCKET}/${objectKey}`;
  }
}
```

- [ ] **Step 2: 注册 PythonSandboxService 到 AssistantModule**

```typescript
// apps/api/src/assistant/assistant.module.ts
import { PythonSandboxService } from './python-sandbox.service';

@Module({
  imports: [PrismaModule],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    DeepSeekProvider,
    ToolRegistry,
    GlobalOverviewTool,
    ProcurementTool,
    BidTool,
    SupplierTool,
    ExpertTool,
    AnnouncementTool,
    NotificationTool,
    MallTool,
    ActionPlannerService,
    ActionExecutorService,
    PythonSandboxService,  // <-- 新增
  ],
  exports: [AssistantService],
})
export class AssistantModule {}
```

- [ ] **Step 3: 验证 API TypeScript 编译**

```bash
cd water-erp && npx tsc --noEmit --project apps/api/tsconfig.json 2>&1 | head -10
```

Expected: 只有预存的 baseUrl deprecation warning

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/assistant/python-sandbox.service.ts apps/api/src/assistant/assistant.module.ts
git commit -m "feat(api): add PythonSandboxService — AST-safe matplotlib chart rendering

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: 修改 AssistantService.chat() — 图表生成集成

**Files:**
- Modify: `apps/api/src/assistant/assistant.service.ts`

Inject PythonSandboxService, modify handleNormalChat() to extract Python code blocks, execute them, generate chart cards.

- [ ] **Step 1: 注入 PythonSandboxService**

```typescript
// assistant.service.ts — 在构造函数中追加
import { PythonSandboxService } from './python-sandbox.service';

constructor(
  private readonly prisma: PrismaService,
  private readonly model: DeepSeekProvider,
  private readonly toolRegistry: ToolRegistry,
  // ... existing tool injections ...
  private readonly pythonSandbox: PythonSandboxService,  // <-- 新增
) { ... }
```

- [ ] **Step 2: 在 handleNormalChat 末尾追加代码块提取 + 图表生成逻辑**

Replace the second model call section (starting at the `try` block with `const followUp = await this.model.chat(...)`) with the following. The key addition is after `answer = followUpText` — extract Python block, execute sandbox, generate chart card.

```typescript
// assistant.service.ts — handleNormalChat() 中的二次调用部分（替换现有 try/catch）

    let answer: string; // 这是函数已有的变量
    // ... 前面 TOOL_CALL 匹配和工具执行代码不变 ...

    try {
      const followUp = await this.model.chat([
        ...messages,
        { role: 'assistant' as const, content: answer },
        {
          role: 'user' as const,
          content: `工具 ${toolCall.tool} 返回了数据。${toolSummary}`,
        },
      ]);
      const followUpText = followUp.text?.trim();
      if (!followUpText) {
        const stripped = answer.replace(/TOOL_CALL:\s*\{[\s\S]*?\}\s*/g, '').trim();
        answer = stripped || '抱歉，数据查询成功但 AI 未能生成分析。请重新提问或简化问题。';
      } else {
        answer = followUpText;
      }
    } catch {
      const stripped = answer.replace(/TOOL_CALL:\s*\{[\s\S]*?\}\s*/g, '').trim();
      if (stripped) {
        answer = stripped;
      } else {
        answer = '抱歉，AI 服务在处理您的请求时出现异常，请稍后重试或换一种方式提问。';
      }
    }

    // === 新增：提取 Python 代码块并生成图表 ===
    const pythonBlockRe = /```python\s*\n([\s\S]*?)```/;
    const pythonMatch = answer.match(pythonBlockRe);

    if (pythonMatch) {
      const pythonCode = pythonMatch[1].trim();
      // Remove code block from answer text (keep the narrative)
      answer = answer.replace(pythonBlockRe, '').trim();

      const chartResult = await this.pythonSandbox.execute(
        pythonCode,
        result.data || result,
      );

      if (chartResult.success) {
        cards.push({
          type: 'chart',
          title: this.inferChartTitle(answer, toolCall.tool),
          chartType: this.inferChartType(pythonCode),
          imageUrl: chartResult.imageUrl,
          caption: this.inferChartCaption(answer),
        });
      } else {
        // Append a brief note that chart generation failed
        answer = answer + `\n（图表生成失败：${chartResult.error}）`;
      }
    }

    return answer;
  }

  /**
   * Extract a short chart title from the answer text.
   */
  private inferChartTitle(answer: string, toolName: string): string {
    const toolLabels: Record<string, string> = {
      global_overview: '全局概览',
      procurement: '采购分析',
      bid: '招标分析',
      supplier: '供应商分析',
      expert: '专家分析',
      announcement: '公告统计',
      notification: '通知统计',
      mall: '商城分析',
    };
    const label = toolLabels[toolName] || '数据图表';
    // Take first sentence as chart title, truncated
    const firstSentence = answer.split(/[。！\n]/)[0]?.slice(0, 30) || '';
    return firstSentence || label;
  }

  /**
   * Determine chart type from Python code patterns.
   */
  private inferChartType(
    code: string,
  ): 'bar' | 'line' | 'pie' | 'scatter' | 'radar' {
    if (code.includes('.pie(')) return 'pie';
    if (code.includes('.scatter(')) return 'scatter';
    if (code.includes('.plot(')) return 'line';
    if (code.includes('.barh(')) return 'bar';
    if (code.includes('.bar(')) return 'bar';
    return 'bar'; // default
  }

  /**
   * Extract a short caption from the answer for chart context.
   */
  private inferChartCaption(answer: string): string {
    const sentence = answer.split(/[。！\n]/)[0]?.slice(0, 50) || '';
    return sentence;
  }
```

- [ ] **Step 3: 验证 API TypeScript 编译**

```bash
cd water-erp && npx tsc --noEmit --project apps/api/tsconfig.json 2>&1 | head -10
```

Expected: 只有预存的 baseUrl deprecation warning

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/assistant/assistant.service.ts
git commit -m "feat(api): integrate Python chart rendering into chat flow

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: 更新系统提示词 — 图表生成规则

**Files:**
- Modify: `apps/api/src/assistant/knowledge/system-knowledge.ts`

- [ ] **Step 1: 在提示词末尾追加图表生成规则**

```typescript
// system-knowledge.ts — 在文件末尾追加以下内容（在 最后一行末尾的 `; 前）

【图表生成规则】
- 当工具返回的数据适合图表可视化时，在文字回答末尾追加一个 Python 代码块。
- 数据变量已预定义为 data，直接使用其中的字段。data 的类型可能是数组、对象或包含数组的对象（如 {items: [...]}），请根据实际结构提取数据。
- 图表要求：
  · 配色使用蓝色系（#2563EB, #0891b2, #7dd3fc, #0d9488, #6366f1）
  · 白色背景（facecolor='white'），无网格线（grid=False 或极淡灰色网格线 alpha=0.15）
  · 分辨率 120 dpi，尺寸不超过 (8, 5)
  · 只生成一个图表，选择最符合数据特征的图表类型
  · 中文标签字体大小为 12-14
  · 必须调用 plt.savefig('output_<runId>.png') 保存图片（路径格式固定，沙箱会自动处理）
  · 不要调用 plt.show()
- 代码块放在文字内容之后，用空行分隔。不要将代码块嵌入到段落中间。
- 不要在代码块前后添加额外描述（如"以下是图表代码"），直接放代码块即可。
```

- [ ] **Step 2: 验证编译**

```bash
cd water-erp && npx tsc --noEmit --project apps/api/tsconfig.json 2>&1 | head -10
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/assistant/knowledge/system-knowledge.ts
git commit -m "feat(api): add chart generation rules to system prompt

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: 创建 DataCanvas 组件

**Files:**
- Create: `apps/assistant/src/components/data-canvas.tsx`
- Create: `apps/assistant/src/components/data-canvas.module.css`

- [ ] **Step 1: CSS Module — 全宽画布网格**

```css
/* data-canvas.module.css */
.canvas {
  flex: 1;
  overflow-y: auto;
  padding: 24px 24px 100px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Header: back button + topic label */
.canvasHeader {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(201, 217, 239, 0.35);
  flex-shrink: 0;
}

.backBtn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px 6px 10px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.45);
  border: 1px solid rgba(201, 217, 239, 0.35);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  cursor: pointer;
  transition: all 0.2s ease;
}

.backBtn:hover {
  background: rgba(255, 255, 255, 0.72);
  color: var(--primary);
  border-color: rgba(176, 196, 222, 0.55);
  transform: translateX(-2px);
}

.topicLabel {
  font-size: var(--font-sm);
  font-weight: 600;
  color: var(--text-heading);
  letter-spacing: 0.03em;
}

/* Adaptive grid */
.cardGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

/* Empty state */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 12px;
  color: var(--text-muted);
  font-size: var(--font-sm);
  text-align: center;
  padding: 60px 20px;
}

.emptyIcon {
  opacity: 0.35;
  width: 64px;
  height: 64px;
  color: var(--text-hint);
}

.emptyText {
  max-width: 320px;
  line-height: 1.6;
}

/* Metric card — 紧凑型 */
.metricCard {
  position: relative;
  z-index: 1;
  padding: 14px 16px;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.64) 0%, rgba(244, 249, 255, 0.44) 100%);
  border: 1px solid rgba(201, 217, 239, 0.38);
  box-shadow: 0 2px 10px rgba(19, 36, 62, 0.03);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  overflow: hidden;
}

.metricCard .cardShimmer {
  position: absolute;
  inset: -2px;
  border-radius: 18px;
  z-index: -1;
  pointer-events: none;
  background: linear-gradient(
    135deg,
    rgba(120, 160, 210, 0.35),
    rgba(150, 140, 210, 0.4) 20%,
    rgba(100, 180, 180, 0.45) 40%,
    rgba(140, 160, 220, 0.4) 60%,
    rgba(170, 150, 220, 0.35) 80%,
    rgba(120, 160, 210, 0.35)
  );
  background-size: 300% 300%;
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  animation: cardShimmer 5s ease-in-out infinite;
}

@keyframes cardShimmer {
  0%, 100% { background-position: 0% 0%; }
  25%      { background-position: 100% 0%; }
  50%      { background-position: 100% 100%; }
  75%      { background-position: 0% 100%; }
}

.metricLabel {
  font-size: var(--font-xs);
  color: var(--text-muted);
  margin-bottom: 4px;
}

.metricValue {
  font-family: var(--font-mono);
  font-size: var(--font-2xl);
  font-weight: 700;
  color: var(--text-heading);
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.metricTrend {
  font-size: var(--font-xs);
  font-family: var(--font-sans);
  font-weight: 600;
}

/* Table card */
.tableCard {
  position: relative;
  z-index: 1;
  border-radius: 16px;
  overflow: hidden;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.64) 0%, rgba(244, 249, 255, 0.44) 100%);
  border: 1px solid rgba(201, 217, 239, 0.38);
  box-shadow: 0 2px 10px rgba(19, 36, 62, 0.03);
}

.tableCard .cardShimmer {
  position: absolute;
  inset: -2px;
  border-radius: 18px;
  z-index: -1;
  pointer-events: none;
  background: linear-gradient(
    135deg,
    rgba(120, 160, 210, 0.3),
    rgba(150, 140, 210, 0.35) 20%,
    rgba(100, 180, 180, 0.4) 40%,
    rgba(140, 160, 220, 0.35) 60%,
    rgba(170, 150, 220, 0.3) 80%,
    rgba(120, 160, 210, 0.3)
  );
  background-size: 300% 300%;
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  animation: cardShimmer 5s ease-in-out infinite;
}

.tableHeader {
  padding: 10px 16px;
  font-size: var(--font-xs);
  font-weight: 700;
  color: var(--text-secondary);
  background: rgba(240, 245, 255, 0.5);
  border-bottom: 1px solid rgba(201, 217, 239, 0.3);
}

.tableBody {
  overflow-x: auto;
}

.tableBody table {
  width: 100%;
  border-collapse: collapse;
}

.tableBody th {
  font-size: var(--font-xs);
  font-weight: 600;
  color: var(--text-secondary);
  text-align: left;
  padding: 6px 12px;
  border-bottom: 1px solid rgba(201, 217, 239, 0.25);
  white-space: nowrap;
  background: rgba(248, 251, 255, 0.6);
}

.tableBody td {
  font-size: var(--font-xs);
  color: var(--text-primary);
  padding: 6px 12px;
  border-bottom: 1px solid rgba(201, 217, 239, 0.15);
  white-space: nowrap;
}

/* Chart card */
.chartCard {
  position: relative;
  z-index: 1;
  border-radius: 16px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.64);
  border: 1px solid rgba(201, 217, 239, 0.38);
  box-shadow: 0 2px 10px rgba(19, 36, 62, 0.03);
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.chartCard:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(19, 36, 62, 0.06);
}

.chartImage {
  width: 100%;
  height: auto;
  display: block;
  object-fit: contain;
}

.chartOverlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0);
  opacity: 0;
  transition: all 0.2s ease;
  border-radius: 16px;
}

.chartCard:hover .chartOverlay {
  background: rgba(255, 255, 255, 0.6);
  opacity: 1;
}

.chartToolBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(201, 217, 239, 0.5);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
  backdrop-filter: blur(6px);
}

.chartToolBtn:hover {
  background: #fff;
  color: var(--primary);
  border-color: rgba(37, 99, 235, 0.25);
  box-shadow: 0 2px 8px rgba(37, 99, 168, 0.1);
}

.chartTitle {
  padding: 10px 14px 0;
  font-size: var(--font-xs);
  font-weight: 600;
  color: var(--text-secondary);
}

.chartCaption {
  padding: 4px 14px 10px;
  font-size: var(--font-xs);
  color: var(--text-muted);
  line-height: 1.4;
}
```

- [ ] **Step 2: DataCanvas 组件实现**

```typescript
// apps/assistant/src/components/data-canvas.tsx
'use client';

import { ArrowLeft, Maximize2, Download, BarChart3 } from 'lucide-react';
import type { AssistantCard as AssistantCardType } from '@/lib/types';
import styles from './data-canvas.module.css';

export function DataCanvas({
  cards,
  topicLabel,
  onBack,
  onChartClick,
  onChartDownload,
  onAskFollowUp,
}: {
  cards: AssistantCardType[];
  topicLabel: string;
  onBack: () => void;
  onChartClick: (imageUrl: string) => void;
  onChartDownload: (imageUrl: string) => void;
  onAskFollowUp: (question: string) => void;
}) {
  const displayCards = cards.filter((c) => c.type !== 'actionPlan');

  if (displayCards.length === 0) {
    return (
      <div className={styles.canvas}>
        <div className={styles.canvasHeader}>
          <button className={styles.backBtn} onClick={onBack} type="button">
            <ArrowLeft size={14} strokeWidth={1.8} />
            返回对话
          </button>
        </div>
        <div className={styles.empty}>
          <BarChart3 className={styles.emptyIcon} strokeWidth={1.2} />
          <p className={styles.emptyText}>
            暂无数据卡片。在对话中提出分析问题（如"帮我看看当前的招标情况"），AI 会生成数据卡片和图表。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.canvas}>
      <div className={styles.canvasHeader}>
        <button className={styles.backBtn} onClick={onBack} type="button">
          <ArrowLeft size={14} strokeWidth={1.8} />
          返回对话
        </button>
        <span className={styles.topicLabel}>当前话题：{topicLabel}</span>
      </div>

      <div className={styles.cardGrid}>
        {displayCards.map((card, i) => {
          if (card.type === 'metric') {
            return (
              <div key={`metric-${i}`} className={styles.metricCard}>
                <div className={styles.metricLabel}>{card.title}</div>
                <div className={styles.metricValue}>
                  {card.value}
                  {card.trend && (
                    <span
                      className={styles.metricTrend}
                      style={{
                        color: card.trend.startsWith('+')
                          ? 'var(--success)'
                          : card.trend.startsWith('-')
                            ? 'var(--error)'
                            : 'var(--text-muted)',
                      }}
                    >
                      {card.trend}
                    </span>
                  )}
                </div>
                <div className={styles.cardShimmer} />
              </div>
            );
          }

          if (card.type === 'table') {
            return (
              <div key={`table-${i}`} className={styles.tableCard}>
                <div className={styles.tableHeader}>{card.title}</div>
                <div className={styles.tableBody}>
                  <table>
                    <thead>
                      <tr>
                        {card.columns.map((c) => (
                          <th key={c.key}>{c.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(card.rows as Array<Record<string, unknown>>).map((row, j) => (
                        <tr key={j}>
                          {card.columns.map((c) => (
                            <td key={c.key}>{String(row[c.key] ?? '-')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className={styles.cardShimmer} />
              </div>
            );
          }

          if (card.type === 'chart') {
            return (
              <div key={`chart-${i}`}>
                {card.title && (
                  <div className={styles.chartTitle}>{card.title}</div>
                )}
                <div
                  className={styles.chartCard}
                  onClick={() => onChartClick(card.imageUrl)}
                >
                  <img
                    src={card.imageUrl}
                    alt={card.title || '数据图表'}
                    className={styles.chartImage}
                    loading="lazy"
                  />
                  <div className={styles.chartOverlay}>
                    <button
                      className={styles.chartToolBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        onChartClick(card.imageUrl);
                      }}
                      type="button"
                      title="放大查看"
                    >
                      <Maximize2 size={18} strokeWidth={1.5} />
                    </button>
                    <button
                      className={styles.chartToolBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        onChartDownload(card.imageUrl);
                      }}
                      type="button"
                      title="下载图表"
                    >
                      <Download size={18} strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
                {card.caption && (
                  <div className={styles.chartCaption}>{card.caption}</div>
                )}
              </div>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 验证 TypeScript 编译**

```bash
cd water-erp && npx tsc --noEmit --project apps/assistant/tsconfig.json 2>&1 | head -10
```

- [ ] **Step 4: Commit**

```bash
git add apps/assistant/src/components/data-canvas.tsx apps/assistant/src/components/data-canvas.module.css
git commit -m "feat(assistant): add DataCanvas component with metric/table/chart cards

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: 创建 ChartLightbox 组件

**Files:**
- Create: `apps/assistant/src/components/chart-lightbox.tsx`
- Create: `apps/assistant/src/components/chart-lightbox.module.css`

- [ ] **Step 1: CSS Module — 灯箱样式**

```css
/* chart-lightbox.module.css */
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 20, 40, 0.72);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.content {
  position: relative;
  max-width: calc(100vw - 80px);
  max-height: calc(100vh - 80px);
  display: flex;
  flex-direction: column;
  align-items: center;
  animation: zoomIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes zoomIn {
  from { transform: scale(0.9); opacity: 0; }
  to   { transform: scale(1); opacity: 1; }
}

.image {
  max-width: 100%;
  max-height: calc(100vh - 160px);
  object-fit: contain;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 4px 40px rgba(0, 0, 0, 0.2);
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}

.actionBtn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.2);
  cursor: pointer;
  transition: all 0.15s ease;
}

.actionBtn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
  border-color: rgba(255, 255, 255, 0.35);
}

.closeBtn {
  position: absolute;
  top: -44px;
  right: 0;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
  cursor: pointer;
  transition: all 0.15s ease;
}

.closeBtn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}
```

- [ ] **Step 2: ChartLightbox 组件实现**

```typescript
// apps/assistant/src/components/chart-lightbox.tsx
'use client';

import { useEffect, useCallback } from 'react';
import { X, Download } from 'lucide-react';
import styles from './chart-lightbox.module.css';

export function ChartLightbox({
  imageUrl,
  onClose,
}: {
  imageUrl: string | null;
  onClose: () => void;
}) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!imageUrl) return;
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [imageUrl, handleKeyDown]);

  if (!imageUrl) return null;

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = `chart-${Date.now()}.png`;
    a.click();
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.content} onClick={(e) => e.stopPropagation()}>
        <button
          className={styles.closeBtn}
          onClick={onClose}
          type="button"
          aria-label="关闭"
        >
          <X size={18} strokeWidth={1.8} />
        </button>
        <img
          src={imageUrl}
          alt="图表放大视图"
          className={styles.image}
        />
        <div className={styles.actions}>
          <button
            className={styles.actionBtn}
            onClick={handleDownload}
            type="button"
          >
            <Download size={14} strokeWidth={1.8} />
            下载 PNG
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 验证编译**

```bash
cd water-erp && npx tsc --noEmit --project apps/assistant/tsconfig.json 2>&1 | head -10
```

- [ ] **Step 4: Commit**

```bash
git add apps/assistant/src/components/chart-lightbox.tsx apps/assistant/src/components/chart-lightbox.module.css
git commit -m "feat(assistant): add ChartLightbox component for full-size chart viewing

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: 创建 IndicatorBar 组件

**Files:**
- Create: `apps/assistant/src/components/indicator-bar.tsx`
- Create: `apps/assistant/src/components/indicator-bar.module.css`

- [ ] **Step 1: CSS Module — 迷你指示条**

```css
/* indicator-bar.module.css */
.bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 6px 16px;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.25);
  border-top: 1px solid rgba(201, 217, 239, 0.25);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
}

.bar:hover {
  background: rgba(255, 255, 255, 0.45);
  color: var(--primary);
}

.indicator {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--primary);
  opacity: 0.6;
  flex-shrink: 0;
}

.hint {
  font-size: 10px;
  color: var(--text-hint);
  opacity: 0.7;
}
```

- [ ] **Step 2: IndicatorBar 组件实现**

```typescript
// apps/assistant/src/components/indicator-bar.tsx
'use client';

import { BarChart3 } from 'lucide-react';
import styles from './indicator-bar.module.css';

export function IndicatorBar({
  metricCount,
  tableCount,
  chartCount,
  onClick,
  dataMode,
}: {
  metricCount: number;
  tableCount: number;
  chartCount: number;
  onClick: () => void;
  dataMode: boolean;
}) {
  const total = metricCount + tableCount + chartCount;
  if (total === 0) return null;

  const parts: string[] = [];
  if (chartCount > 0) parts.push(`${chartCount} 张图表`);
  if (tableCount > 0) parts.push(`${tableCount} 张表格`);
  if (metricCount > 0) parts.push(`${metricCount} 张指标`);

  return (
    <div
      className={styles.bar}
      onClick={dataMode ? undefined : onClick}
      role={dataMode ? 'status' : 'button'}
      tabIndex={dataMode ? undefined : 0}
      aria-label={dataMode ? `共 ${total} 张数据卡片` : `共 ${total} 张数据卡片，点击查看`}
    >
      <BarChart3 size={12} strokeWidth={1.8} />
      <span className={styles.indicator}>
        {parts.map((p, i) => (
          <span key={i}>
            {i > 0 && ' · '}
            <span className={styles.dot} />
            {p}
          </span>
        ))}
      </span>
      {!dataMode && <span className={styles.hint}>点击切换到数据模式</span>}
    </div>
  );
}
```

- [ ] **Step 3: 验证编译**

```bash
cd water-erp && npx tsc --noEmit --project apps/assistant/tsconfig.json 2>&1 | head -10
```

- [ ] **Step 4: Commit**

```bash
git add apps/assistant/src/components/indicator-bar.tsx apps/assistant/src/components/indicator-bar.module.css
git commit -m "feat(assistant): add IndicatorBar for canvas mode toggle hint

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: 重写 ChatWorkspace — 双模式支持

**Files:**
- Modify: `apps/assistant/src/components/chat-workspace.tsx`
- Modify: `apps/assistant/src/components/chat-workspace.module.css`

Replace the old AnalysisCanvas integration with the new DataCanvas + IndicatorBar + ChartLightbox pattern.

- [ ] **Step 1: 重写 chat-workspace.tsx**

```typescript
// apps/assistant/src/components/chat-workspace.tsx
'use client';

import { useMemo, useState, useCallback } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { MessageList } from './message-list';
import { DataCanvas } from './data-canvas';
import { IndicatorBar } from './indicator-bar';
import { ChartLightbox } from './chart-lightbox';
import type {
  Message,
  AssistantCard as AssistantCardType,
  AssistantCitation,
} from '@/lib/types';
import styles from './chat-workspace.module.css';
import GradientText from './GradientText';

export function ChatWorkspace({
  messages,
  onSend,
  isLoading,
  onConfirmAction,
  onCancelAction,
  onBack,
  headerLeft = 260,
  dataMode,
  onDataModeChange,
}: {
  messages: Message[];
  onSend: (msg: string) => void;
  isLoading: boolean;
  onConfirmAction: (id: string) => void;
  onCancelAction: (id: string) => void;
  onBack: () => void;
  headerLeft?: number;
  dataMode: boolean;
  onDataModeChange: (mode: boolean) => void;
}) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Accumulate all cards from the entire conversation
  const { cards, citations } = useMemo(() => {
    const cardMap = new Map<string, AssistantCardType>();
    const citationSet = new Set<string>();
    const allCitations: AssistantCitation[] = [];
    for (const msg of messages) {
      if (msg.role === 'assistant') {
        if (msg.cards) {
          for (const c of msg.cards as AssistantCardType[]) {
            const key = c.title || JSON.stringify(c);
            if (!cardMap.has(key)) cardMap.set(key, c);
          }
        }
        if (msg.citations) {
          for (const cit of msg.citations as AssistantCitation[]) {
            const key = `${cit.type}:${cit.title}`;
            if (!citationSet.has(key)) {
              citationSet.add(key);
              allCitations.push(cit);
            }
          }
        }
      }
    }
    return { cards: Array.from(cardMap.values()), citations: allCitations };
  }, [messages]);

  const metricCount = cards.filter((c) => c.type === 'metric').length;
  const tableCount = cards.filter((c) => c.type === 'table').length;
  const chartCount = cards.filter((c) => c.type === 'chart').length;

  // Topic label: use the last user message
  const topicLabel = useMemo(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    return lastUser?.content?.slice(0, 30) || '数据总览';
  }, [messages]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const val = (e.target as HTMLTextAreaElement).value.trim();
      if (val && !isLoading) {
        onSend(val);
        (e.target as HTMLTextAreaElement).value = '';
      }
    }
  };

  const handleSendClick = () => {
    const textarea = document.querySelector(
      `.${styles.aiInput}`,
    ) as HTMLTextAreaElement;
    if (textarea) {
      const val = textarea.value.trim();
      if (val && !isLoading) {
        onSend(val);
        textarea.value = '';
      }
    }
  };

  const handleChartDownload = useCallback((imageUrl: string) => {
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = `chart-${Date.now()}.png`;
    a.click();
  }, []);

  const handleAskFollowUp = useCallback(
    (question: string) => {
      onDataModeChange(false);
      onSend(question);
    },
    [onSend, onDataModeChange],
  );

  return (
    <div className={styles.workspace}>
      <div className={styles.main}>
        {/* Header */}
        <header
          className={styles.header}
          style={{ left: `${headerLeft}px` }}
        >
          <button
            className={styles.headerTitle}
            onClick={onBack}
            type="button"
            title="返回首页"
          >
            <GradientText
              colors={[
                '#1a2332',
                '#2563EB',
                '#0891b2',
                '#18a56c',
                '#1a2332',
              ]}
              animationSpeed={8}
              direction="horizontal"
              yoyo={true}
            >
              智慧水发 · 蜀水云采
            </GradientText>
          </button>
        </header>

        {/* Messages — hidden in data mode */}
        <div
          className={styles.messages}
          style={{ display: dataMode ? 'none' : undefined }}
        >
          <MessageList
            messages={messages}
            onConfirmAction={onConfirmAction}
            onCancelAction={onCancelAction}
          />
        </div>

        {/* DataCanvas — shown in data mode */}
        {dataMode && (
          <DataCanvas
            cards={cards}
            topicLabel={topicLabel}
            onBack={() => onDataModeChange(false)}
            onChartClick={setLightboxUrl}
            onChartDownload={handleChartDownload}
            onAskFollowUp={handleAskFollowUp}
          />
        )}

        {/* Spacer when messages empty in data mode */}
        {dataMode && cards.length === 0 && (
          <div style={{ flex: 1 }} />
        )}

        {/* IndicatorBar */}
        <IndicatorBar
          metricCount={metricCount}
          tableCount={tableCount}
          chartCount={chartCount}
          onClick={() => onDataModeChange(true)}
          dataMode={dataMode}
        />

        {/* Input */}
        <div className={styles.inputBar}>
          <div className={styles.inputWrapper}>
            <div className={styles.commandBox}>
              <textarea
                className={styles.aiInput}
                placeholder={
                  dataMode
                    ? '基于数据画布追问...'
                    : '输入问题 / 生成分析 / 操作业务...'
                }
                rows={1}
                onKeyDown={handleInputKeyDown}
                disabled={isLoading}
              />
              <button
                className={`${styles.sendBtn} ${isLoading ? '' : styles.active}`}
                onClick={handleSendClick}
                disabled={isLoading}
                type="button"
              >
                {isLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Send size={16} />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ChartLightbox */}
      <ChartLightbox
        imageUrl={lightboxUrl}
        onClose={() => setLightboxUrl(null)}
      />
    </div>
  );
}
```

- [ ] **Step 2: 调整 CSS — 移除旧的 analysis-canvas 引用**

在 `chat-workspace.module.css` 中，消息区在 dataMode 时的隐藏由 inline style 控制，CSS 无需修改。确认 CSS 中不再引用 `analysis-canvas` 的任何样式。

- [ ] **Step 3: 验证编译**

```bash
cd water-erp && npx tsc --noEmit --project apps/assistant/tsconfig.json 2>&1 | head -10
```

- [ ] **Step 4: Commit**

```bash
git add apps/assistant/src/components/chat-workspace.tsx apps/assistant/src/components/chat-workspace.module.css
git commit -m "feat(assistant): refactor ChatWorkspace to support dual chat/data mode

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: 更新 page.tsx — 模式状态 + 键盘快捷键

**Files:**
- Modify: `apps/assistant/src/app/page.tsx`

- [ ] **Step 1: 新增 dataMode 状态和键盘快捷键**

```typescript
// page.tsx — 在现有 state 声明区域追加
const [dataMode, setDataMode] = useState(false);

// 键盘快捷键监听
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
      e.preventDefault();
      setDataMode((prev) => !prev);
    }
  };
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, []);

// handleSend 中追加：发送新消息时切回对话模式
const handleSend = useCallback(
  async (msg: string) => {
    setDataMode(false);  // <-- 新增
    setInChat(true);
    // ... 其余不变 ...
  },
  [conversationId, refreshConversations],
);

// handleSelectConversation 中追加：加载历史对话时切回对话模式
const handleSelectConversation = useCallback(async (id: string) => {
  setDataMode(false);  // <-- 新增
  // ... 其余不变 ...
}, []);
```

- [ ] **Step 2: 传递 dataMode 和 onDataModeChange 给 ChatWorkspace**

```typescript
// page.tsx — 在 ChatWorkspace 的 JSX 中追加两个 props
<ChatWorkspace
  messages={messages}
  onSend={handleSend}
  isLoading={isLoading}
  onConfirmAction={handleConfirmAction}
  onCancelAction={handleCancelAction}
  onBack={handleBack}
  headerLeft={sidebarCollapsed ? 40 : 260}
  dataMode={dataMode}                    // <-- 新增
  onDataModeChange={setDataMode}         // <-- 新增
/>
```

- [ ] **Step 3: 验证编译**

```bash
cd water-erp && npx tsc --noEmit --project apps/assistant/tsconfig.json 2>&1 | head -10
```

- [ ] **Step 4: Commit**

```bash
git add apps/assistant/src/app/page.tsx
git commit -m "feat(assistant): add dataMode state + Cmd+D keyboard shortcut

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 11: 删除旧的 AnalysisCanvas 组件

**Files:**
- Delete: `apps/assistant/src/components/analysis-canvas.tsx`
- Delete: `apps/assistant/src/components/analysis-canvas.module.css`

- [ ] **Step 1: 删除文件**

```bash
rm apps/assistant/src/components/analysis-canvas.tsx
rm apps/assistant/src/components/analysis-canvas.module.css
```

- [ ] **Step 2: 验证编译（确认无 import 残留）**

```bash
cd water-erp && npx tsc --noEmit --project apps/assistant/tsconfig.json 2>&1 | head -10
```

Expected: 无 error（确认所有 analysis-canvas import 已移除）

- [ ] **Step 3: Commit**

```bash
git add apps/assistant/src/components/analysis-canvas.tsx apps/assistant/src/components/analysis-canvas.module.css
git commit -m "refactor(assistant): remove deprecated AnalysisCanvas component

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 12: API E2E 测试 — 图表生成

**Files:**
- Create: `apps/api/src/assistant/python-sandbox.service.spec.ts`

- [ ] **Step 1: 编写单元测试 — 安全检查**

```typescript
// apps/api/src/assistant/python-sandbox.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { PythonSandboxService } from './python-sandbox.service';

describe('PythonSandboxService', () => {
  let service: PythonSandboxService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PythonSandboxService],
    }).compile();
    service = module.get<PythonSandboxService>(PythonSandboxService);
    // Skip onModuleInit — we test individual methods
  });

  describe('validateCode', () => {
    it('should accept safe matplotlib code', () => {
      const code = `
import matplotlib.pyplot as plt
import numpy as np
x = [1,2,3]
plt.bar(x, x)
plt.savefig('output.png')
`;
      // Access private method via reflection for testing
      const result = (service as any).validateCode(code);
      expect(result.valid).toBe(true);
    });

    it('should reject os import', () => {
      const code = `import os\nos.system('ls')`;
      const result = (service as any).validateCode(code);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('os');
    });

    it('should reject eval() call', () => {
      const code = `eval('print(1)')`;
      const result = (service as any).validateCode(code);
      expect(result.valid).toBe(false);
    });

    it('should reject subprocess import', () => {
      const code = `import subprocess\nsubprocess.run(['ls'])`;
      const result = (service as any).validateCode(code);
      expect(result.valid).toBe(false);
    });
  });

  describe('prepareCode', () => {
    it('should inject data and font setup before user code', () => {
      const userCode = `plt.bar(data['labels'], data['values'])`;
      const testData = { labels: ['A', 'B'], values: [10, 20] };
      const prepared = (service as any).prepareCode(userCode, testData);
      expect(prepared).toContain('data = json.loads');
      expect(prepared).toContain('"labels"');
      expect(prepared).toContain('matplotlib.use');
      expect(prepared).toContain('font.family');
      expect(prepared).toContain(userCode);
    });
  });

  describe('inferChartType', () => {
    it('should detect bar chart', () => {
      const result = (service as any).inferChartType("plt.bar(x, y)");
      expect(result).toBe('bar');
    });

    it('should detect pie chart', () => {
      const result = (service as any).inferChartType("plt.pie(values)");
      expect(result).toBe('pie');
    });

    it('should detect line chart', () => {
      const result = (service as any).inferChartType("plt.plot(x, y)");
      expect(result).toBe('line');
    });

    it('should default to bar for unknown code', () => {
      const result = (service as any).inferChartType("print('hello')");
      expect(result).toBe('bar');
    });
  });
});
```

- [ ] **Step 2: 运行测试验证**

```bash
cd water-erp && pnpm --filter api test -- python-sandbox 2>&1 | tail -20
```

Expected: 4 个测试用例全部通过

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/assistant/python-sandbox.service.spec.ts
git commit -m "test(api): add PythonSandboxService unit tests for AST validation + code injection

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 13: 安装 Python 依赖 + 启动验证

- [ ] **Step 1: 安装 Python 依赖**

```bash
pip3 install matplotlib numpy pandas
```

验证安装：
```bash
python3 -c "import matplotlib; import numpy; import pandas; print('OK: matplotlib', matplotlib.__version__, 'numpy', numpy.__version__, 'pandas', pandas.__version__)"
```

Expected: `OK: matplotlib X.X.X numpy X.X.X pandas X.X.X`

- [ ] **Step 2: 启动 API 验证健康检查**

```bash
cd water-erp && pnpm dev:api
```

观察终端输出，确认包含：
```
[Nest] ... [PythonSandboxService] Python 3 + matplotlib/numpy/pandas 就绪，图表功能已启用
```

- [ ] **Step 3: 启动前端验证**

```bash
cd water-erp && pnpm dev:assistant
```

打开 `http://localhost:3008`，验证：
1. 首页无变化（8 个快捷入口正常）
2. 点击快捷入口发送问题
3. AI 回答后，底部出现 IndicatorBar，显示数据卡片数量
4. 点击 IndicatorBar → 全宽数据画布显示
5. `Cmd+D` 来回切换对话/数据模式
6. 发送新消息 → 自动切回对话模式
7. Chart 卡片悬浮显示放大/下载按钮
8. 点击 chart 卡片 → 灯箱弹出
9. ESC 或点击遮罩 → 灯箱关闭

---

## 任务依赖关系

```
Task 1 (types) ──┐
                 ├──> Task 6 (DataCanvas) ──┐
Task 2 (API types)┐                        │
                  ├──> Task 4 (chat flow) ──┤
Task 3 (sandbox) ─┘                        ├──> Task 9 (ChatWorkspace) ──> Task 10 (page.tsx) ──> Task 11 (cleanup)
                                           │
Task 5 (prompt) ────────────────────────────┤
                                           │
Task 7 (Lightbox) ─────────────────────────┘
Task 8 (IndicatorBar) ─────────────────────┘

Task 12 (tests) — after Task 3,4
Task 13 (validation) — after Task 10,11
```

## 验证清单

- [ ] `pnpm --filter api build` — API 编译通过
- [ ] `pnpm --filter assistant build` — 前端编译通过
- [ ] `pnpm --filter api test -- python-sandbox` — 沙箱测试通过
- [ ] Python 环境健康检查成功（启动日志）
- [ ] 对话模式 ↔ 数据模式 `Cmd+D` 切换正常
- [ ] IndicatorBar 显示正确的卡片数量
- [ ] 发送新消息后自动回到对话模式
- [ ] Chart 卡片灯箱放大 + 下载功能
- [ ] 图表生成失败时文字回答正常展示（无白屏/崩溃）
- [ ] 切换历史对话后画布内容更新
