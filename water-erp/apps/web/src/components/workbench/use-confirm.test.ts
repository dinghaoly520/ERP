import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(path), "utf8");

/**
 * 确认框挂在哪里（2026-11-26）。
 * 文档审查的内容面板带着入场动画（.tender-section-enter，forwards 停在 transform: translateY(0)），
 * fixed 定位的确认框放进去会以那个面板为参照：只盖住面板、被面板的 overflow 裁掉
 * （实测遮罩只有 728×725，视口是 1440×900）。处在这类面板里的调用方要把确认框挂到 body 上。
 */
test("useConfirm 默认就地渲染；传 mountToBody 时挂到 body 上", () => {
  const hook = source("src/components/workbench/use-confirm.tsx");
  assert.match(hook, /mountToBody\?: boolean/, "要有 mountToBody 选项");
  assert.match(hook, /createPortal\(/, "挂到 body 用 createPortal");
  assert.match(hook, /createPortal\([\s\S]{0,80}document\.body\)/, "挂载点是 body");
  // 只有传了选项才走 portal（没传的调用方行为不变）；服务端渲染没有 document，不能调用 createPortal
  assert.match(
    hook,
    /options\.mountToBody\s*&&\s*typeof document !== 'undefined'\s*\?\s*createPortal\(/,
    "portal 只在传了 mountToBody 且有 document 时才用",
  );
});

test("文档审查的报告面板与规则面板渲染在入场动画面板里：确认框挂到 body", () => {
  for (const file of ["reports-panel-compact.tsx", "rules-panel-compact.tsx"]) {
    const panel = source(`src/components/tender-review/${file}`);
    assert.match(panel, /useConfirm\(\{ mountToBody: true \}\)/, `${file} 要用 mountToBody`);
    assert.match(panel, /\{dialog\}/, `${file} 要渲染 dialog`);
  }
  // 上面这条要求的依据：内容面板的根节点带着入场动画且裁切溢出。
  // 哪天动画改掉了（面板不再停在 transform 上），这两处的 mountToBody 可以撤
  const content = source("src/components/tender-review/review-workspace-content.tsx");
  assert.match(content, /className="wb-panel[^"]*tender-section-enter[^"]*overflow-hidden"/);
});

test("任务栏不在这类面板里：保持默认的就地渲染", () => {
  const bar = source("src/components/tender-review/task-queue-bar.tsx");
  assert.match(bar, /useConfirm\(\)/);
});
