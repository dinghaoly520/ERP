// 自托管 MediaPipe WASM —— 内网不依赖 CDN（2026-09-18 身份核验设计 R3）
// wasm 体积 ~34MB 不入库：dev/build 前从 node_modules 复制到 public/（pnpm install 后必在场）。
// 模型 blaze_face_short_range.tflite（230KB，Apache-2.0）已入库，随仓库分发。
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, '..', 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const dest = join(root, '..', 'public', 'models', 'mediapipe', 'wasm');

if (!existsSync(src)) {
  console.error(`[copy-mediapipe] wasm 源不存在：${src}（先 pnpm install）`);
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true, dereference: true });
console.log('[copy-mediapipe] wasm → public/models/mediapipe/wasm（自 node_modules 复制）');
