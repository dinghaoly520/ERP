const fs = require('node:fs');
const path = require('node:path');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const source = fs.readFileSync(
  path.resolve(__dirname, 'project-detail-panel.tsx'),
  'utf8',
);

const aiIndex = source.indexOf('AI简报');
const workflowIndex = source.indexOf('pm-workflow-band');
const uploadIndex = source.indexOf('上传本阶段文件');
const fileAnalysisIndex = source.indexOf('文件分析');

assert(aiIndex >= 0, 'expected AI summary section to exist');
assert(workflowIndex >= 0, 'expected workflow section to exist');
assert(uploadIndex >= 0, 'expected upload section to exist');
assert(fileAnalysisIndex >= 0, 'expected file analysis section to exist');
assert(aiIndex < workflowIndex, 'expected AI summary to render above the workflow section');
assert(fileAnalysisIndex > uploadIndex, 'expected file analysis to render below the upload section');

console.log('project-detail-ai-layout-check:ok');
