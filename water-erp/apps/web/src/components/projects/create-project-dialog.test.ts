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

test("评审页字段编辑必须同步 compare 步 selectedValue——解析模式预选值否则弹回手填值（立项日期无法选择）", () => {
  // 根因：compareFields 对每字段自动预选 selectedValue（initiationValue || demandValue），
  // 评审页 value 解析优先读它，而 onChange 若只写 initiationFields（低优先级源），
  // 手填值会被旧预选值弹回；立项日期抽出非 ISO 串时日期框空白且无法选择。
  // e798639a 曾为 budgetAmount 单独修过此病，此处要求推广到全部评审字段（house precedent）。
  assert.match(
    source,
    /const handleReviewFieldChange = \(fieldName: string, value: string\) => \{[\s\S]*?setInitiationFields[\s\S]*?setFieldComparisons[\s\S]*?selectedValue: value/,
    "应存在同时写 initiationFields 与 fieldComparisons.selectedValue 的评审字段编辑助手",
  );

  const reviewFields = [
    "requesterName",
    "requesterDepartment",
    "initiationDate",
    "procurementTitle",
    "procurementCategory",
    "projectReason",
    "supplierRequirements",
  ];
  for (const field of reviewFields) {
    assert.ok(
      source.includes(`handleReviewFieldChange('${field}'`),
      `评审字段 ${field} 的 onChange 应走同步助手，否则解析预选值会弹回手填值`,
    );
  }

  // 立项日期输入框专项：type=date 的 value/onChange 必须绑定同一同步链路
  assert.match(
    source,
    /<input\s+type="date"[\s\S]{0,200}value=\{getSelectedFieldValue\('initiationDate'[\s\S]{0,120}handleReviewFieldChange\('initiationDate'/,
    "立项日期 type=date 输入框 onChange 必须同步 selectedValue",
  );

  // 项目归属自由输入（handleAttributionInputChange）同样受预选值弹回影响，须同步 demandProject 比较项
  assert.match(
    source,
    /const handleAttributionInputChange = \(value: string\) => \{[\s\S]*?setFieldComparisons[\s\S]*?fieldName === 'demandProject'[\s\S]*?selectedValue: value/,
    "项目归属输入须同步 demandProject 的比较 selectedValue",
  );

  // 项目归属下拉选中（handleSelectAttribution）同样须同步，否则选中项被旧预选值弹回
  assert.match(
    source,
    /const handleSelectAttribution = \(attr: ProjectAttribution\) => \{[\s\S]*?setFieldComparisons[\s\S]*?fieldName === 'demandProject'[\s\S]*?selectedValue: attr\.name/,
    "项目归属下拉选中须同步 demandProject 的比较 selectedValue",
  );
});
