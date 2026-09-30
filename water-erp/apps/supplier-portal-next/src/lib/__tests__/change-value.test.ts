import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeChangeValue } from "../change-value";

test("summarizeChangeValue：空值/普通文本原样", () => {
  assert.equal(summarizeChangeValue(undefined, null), "—");
  assert.equal(summarizeChangeValue(undefined, ""), "—");
  assert.equal(summarizeChangeValue("legalPerson", "张三"), "张三");
  assert.equal(summarizeChangeValue("enterpriseType", "有限责任公司"), "有限责任公司");
});

test("summarizeChangeValue：bankAccounts 数组→个数摘要", () => {
  assert.equal(summarizeChangeValue("bankAccounts", "[]"), "0 个银行账户（整体更新）");
  assert.equal(summarizeChangeValue("bankAccounts", JSON.stringify([{ accountNo: "1" }, { accountNo: "2" }])), "2 个银行账户（整体更新）");
});

test("summarizeChangeValue：performances 计数 + 证明材料份数，proofFiles 非数组不炸", () => {
  assert.equal(
    summarizeChangeValue("performances", JSON.stringify([
      { projectName: "A", proofFiles: [{ url: "x" }, { url: "y" }] },
      { projectName: "B", proofFiles: [] },
      { projectName: "C" }, // proofFiles 缺失
    ])),
    "3 项主体业绩（整体更新，含证明材料 2 份）",
  );
  assert.equal(summarizeChangeValue("performances", "[]"), "清空业绩");
});

test("summarizeChangeValue：tags 数组→顿号拼接，空数组→（空）", () => {
  assert.equal(summarizeChangeValue("tags", JSON.stringify(["办公用品", "钻机销售"])), "办公用品、钻机销售");
  assert.equal(summarizeChangeValue("tags", "[]"), "（空）");
});

test("summarizeChangeValue：convertToRegular 转正摘要", () => {
  const v = { contacts: [{}, {}], qualifications: [{}] };
  assert.equal(summarizeChangeValue("convertToRegular", JSON.stringify(v)), "转正资料：联系人 2 人 · 资质 1 项");
});

test("summarizeChangeValue：非法 JSON 回退原文，不抛异常", () => {
  assert.equal(summarizeChangeValue("performances", "{bad json"), "{bad json");
  assert.equal(summarizeChangeValue("bankAccounts", "not-json"), "not-json");
});
