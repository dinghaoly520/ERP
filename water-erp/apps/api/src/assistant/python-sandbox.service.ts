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

    if (!fs.existsSync(WORK_DIR)) {
      fs.mkdirSync(WORK_DIR, { recursive: true });
    }
  }

  async execute(
    code: string,
    data: unknown,
  ): Promise<
    { success: true; imageUrl: string } | { success: false; error: string }
  > {
    if (!this.chartEnabled) {
      return { success: false, error: 'Python 环境不可用，图表功能已禁用' };
    }

    const validation = this.validateCode(code);
    if (!validation.valid) {
      return { success: false, error: `安全检查拒绝：${validation.reason}` };
    }

    const fullCode = this.prepareCode(code, data);

    const runId = crypto.randomBytes(8).toString('hex');
    const scriptPath = path.join(WORK_DIR, `script_${runId}.py`);
    const outputPath = path.join(WORK_DIR, `output_${runId}.png`);

    try {
      fs.writeFileSync(scriptPath, fullCode, 'utf-8');
      await this.spawnPython(scriptPath);

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

      const imageUrl = await this.uploadToMinIO(outputPath, runId);
      return { success: true, imageUrl };
    } catch (e) {
      return {
        success: false,
        error: (e as Error).message || 'Python 执行异常',
      };
    } finally {
      try { if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath); } catch {}
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
    }
  }

  private validateCode(code: string): { valid: boolean; reason?: string } {
    const importRe = /(?:import\s+(\S+)|from\s+(\S+)\s+import)/g;
    let match: RegExpExecArray | null;
    while ((match = importRe.exec(code)) !== null) {
      const moduleName = (match[1] || match[2] || '').split('.')[0];
      if (FORBIDDEN_MODULES.includes(moduleName)) {
        return { valid: false, reason: `禁止导入模块：${moduleName}` };
      }
    }

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
        return { valid: false, reason: `禁止使用危险函数` };
      }
    }

    const writePatterns = [
      /\bos\.(?:remove|unlink|rmdir|chmod|chown|symlink|rename)\s*\(/,
      /\bshutil\./,
      /\bpathlib\./,
    ];
    for (const pattern of writePatterns) {
      if (pattern.test(code)) {
        return { valid: false, reason: `禁止进行文件系统操作` };
      }
    }

    return { valid: true };
  }

  private prepareCode(code: string, data: unknown): string {
    const dataJson = JSON.stringify(data);

    const preamble = `# === 自动注入：数据变量 ===
import json
data = json.loads('''${dataJson.replace(/'/g, "\\'")}''')

# === 自动注入：中文字体设置 ===
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm

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
          const errMsg = stderr.slice(-500) || `退出码 ${code}`;
          reject(new Error(`Python 执行失败：${errMsg}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`无法启动 Python 进程：${err.message}`));
      });
    });
  }

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

    const endpoint = process.env.MINIO_ENDPOINT || 'localhost';
    const port = Number(process.env.MINIO_PORT || 9000);
    const useSSL = process.env.MINIO_USE_SSL === 'true';
    const protocol = useSSL ? 'https' : 'http';
    return `${protocol}://${endpoint}:${port}/${MINIO_BUCKET}/${objectKey}`;
  }
}
