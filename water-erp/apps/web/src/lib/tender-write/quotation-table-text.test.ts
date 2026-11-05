import test from "node:test";
import assert from "node:assert/strict";

import { serializeTableToText, tableHasDataRows } from "./quotation-table-text";
import type { TableData } from "../types/tender-write";

function cell(content: string, over: Partial<TableData["cells"][0][0]> = {}) {
  return { content, rowSpan: 1, colSpan: 1, align: "center" as const, ...over };
}

test("serializeTableToText joins visible cells with tabs, one line per non-empty row", () => {
  const table: TableData = {
    rows: 3,
    cols: 3,
    cells: [
      [cell("名称"), cell("单位"), cell("数量")],
      [cell("钻机"), cell("台"), cell("1")],
      [cell(""), cell(""), cell("")], // 整行空 → 跳过
    ],
  };
  assert.equal(
    serializeTableToText(table),
    "名称\t单位\t数量\n钻机\t台\t1",
  );
});

test("serializeTableToText emits empty string for hidden (merged) positions", () => {
  const table: TableData = {
    rows: 2,
    cols: 3,
    cells: [
      [cell("合并", { colSpan: 2 }), cell("", { hidden: true }), cell("尾")],
      [cell("a"), cell("b"), cell("c")],
    ],
  };
  assert.equal(serializeTableToText(table), "合并\t\t尾\na\tb\tc");
});

test("serializeTableToText of a header-only default table is just the header line", () => {
  const table: TableData = {
    rows: 2,
    cols: 2,
    cells: [
      [cell("名称"), cell("单位")],
      [cell(""), cell("")],
    ],
  };
  assert.equal(serializeTableToText(table), "名称\t单位");
});

test("tableHasDataRows ignores the header row and hidden cells", () => {
  const headerOnly: TableData = {
    rows: 2,
    cols: 2,
    cells: [
      [cell("名称"), cell("单位")],
      [cell(""), cell("")],
    ],
  };
  assert.equal(tableHasDataRows(headerOnly), false);

  const withData: TableData = {
    rows: 2,
    cols: 2,
    cells: [
      [cell("名称"), cell("单位")],
      [cell("钻机"), cell("")],
    ],
  };
  assert.equal(tableHasDataRows(withData), true);

  const onlyHiddenContent: TableData = {
    rows: 2,
    cols: 2,
    cells: [
      [cell("名称"), cell("单位")],
      [cell("藏", { hidden: true }), cell("")],
    ],
  };
  assert.equal(tableHasDataRows(onlyHiddenContent), false);
});
