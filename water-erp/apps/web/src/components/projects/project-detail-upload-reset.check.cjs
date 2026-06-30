const fs = require('node:fs');
const path = require('node:path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const source = fs.readFileSync(
  path.resolve(__dirname, 'project-detail-panel.tsx'),
  'utf8',
);

assert(
  /useRef<HTMLInputElement \| null>\(null\)/.test(source),
  'expected file input ref so the chooser can be reset after upload',
);

assert(
  /setSelectedFile\(null\);[\s\S]{0,200}fileInputRef\.current\.value = ''/.test(source),
  'expected successful upload to clear selected file state and reset the file input element',
);

console.log('project-detail-upload-reset-check:ok');
