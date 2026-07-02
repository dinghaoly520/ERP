import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const currentDir = dirname(fileURLToPath(import.meta.url));

const pageSource = readFileSync(
  resolve(currentDir, 'project-management-page.tsx'),
  'utf8',
);
const detailPanelSource = readFileSync(
  resolve(currentDir, 'project-detail-panel.tsx'),
  'utf8',
);
const cssSource = readFileSync(
  resolve(currentDir, '../../app/globals.css'),
  'utf8',
);

const detailPanelRenderCount = (pageSource.match(/<ProjectDetailPanel\b/g) ?? [])
  .length;

assert(
  detailPanelRenderCount === 1,
  `项目详情工作台只应渲染一次，当前检测到 ${detailPanelRenderCount} 次。`,
);

assert(
  !detailPanelSource.includes('项目详情工作台'),
  '详情面板顶部标签“项目详情工作台”应被移除。',
);

assert(
  cssSource.includes('grid-auto-rows: 1fr;'),
  '流程轨道需要统一行高，缺少 grid-auto-rows: 1fr。',
);

assert(
  /\.pm-stage-track__segment\s*\{[\s\S]*display:\s*flex;/.test(cssSource),
  '流程轨道每个分段需要拉伸成统一尺寸。',
);

console.log('project-management-layout-check:ok');
