import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("src/components/projects/create-project-dialog.tsx"), "utf8");

const procurementCategoryOptions = [
  "生产技术类采购",
  "EPC项目采购",
  "EPC管理采购",
  "公用集中采购",
  "科技研发类采购",
  "信息化采购",
  "其他",
];

test("new project review step renders procurement category as a fixed dropdown", () => {
  assert.match(
    source,
    /<select[\s\S]*value=\{getSelectedFieldValue\('procurementCategory'/,
    "procurement category should render as a select bound to the merged category value",
  );

  for (const option of procurementCategoryOptions) {
    assert.match(
      source,
      new RegExp(`<option key=\\{category\\} value=\\{category\\}>\\{category\\}</option>[\\s\\S]*${option}|${option}[\\s\\S]*<option key=\\{category\\} value=\\{category\\}>\\{category\\}</option>`),
      `procurement category dropdown should include ${option}`,
    );
  }
});
