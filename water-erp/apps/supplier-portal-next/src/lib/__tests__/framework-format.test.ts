import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeOptionalApplicationNote } from "../../components/prequal/prequal-application-dialog";
import { formatFrameworkQuotaRule } from "../framework-format";

test("prequalification application note is genuinely optional", () => {
  assert.equal(normalizeOptionalApplicationNote(""), undefined);
  assert.equal(normalizeOptionalApplicationNote("   \n  "), undefined);
  assert.equal(normalizeOptionalApplicationNote("  具备水利施工一级资质  "), "具备水利施工一级资质");
});

test("framework quota rule is presented as readable Chinese clauses", () => {
  assert.equal(
    formatFrameworkQuotaRule({
      annualQuantity: 1200,
      unit: "吨",
      shareRatio: 0.35,
      allocation: "按季度需求分配",
    }),
    "年度约定数量：1,200；单位：吨；约定占比：35%；分配方式：按季度需求分配",
  );
});

test("framework quota rule handles arrays, booleans and nested clauses without raw JSON", () => {
  const text = formatFrameworkQuotaRule({
    regions: ["成都", "德阳"],
    allowAdjustment: true,
    limits: { minQuantity: 10, maxQuantity: 200 },
  });

  assert.equal(text, "适用区域：成都、德阳；允许调整：是；数量范围：最低数量：10；最高数量：200");
  assert.doesNotMatch(text ?? "", /[{}\[\]"]/);
});

test("empty framework quota rules have no visible placeholder", () => {
  assert.equal(formatFrameworkQuotaRule(null), null);
  assert.equal(formatFrameworkQuotaRule({}), null);
  assert.equal(formatFrameworkQuotaRule({ ignored: null }), null);
});

test("unknown backend keys do not leak technical field names to suppliers", () => {
  assert.equal(formatFrameworkQuotaRule({ internalCustomKey: "按实际订单执行" }), "其他约定：按实际订单执行");
});
