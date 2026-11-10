import test from "node:test";
import assert from "node:assert/strict";

// @ts-expect-error Node 原生 --test 的 ESM 解析需要显式 .ts 扩展；tsc（bundler 分辨）不接受——压此行（须单行 import：指令只作用于下一行）
import { normalizeCompanyName, companyNameSimilarity, rankCompaniesBySimilarity } from "./company-name-similarity.ts";

test("归一化：剥行政区划前缀与有限公司主体后缀（保留 ≥4 字主体）", () => {
  assert.equal(normalizeCompanyName("四川省引大济岷水资源开发有限公司"), "引大济岷水资源开发");
  assert.equal(normalizeCompanyName("引大济岷水资源开发有限公司"), "引大济岷水资源开发");
  assert.equal(normalizeCompanyName("四川水发建设有限公司"), "水发建设");
});

test("简写与官方拼写（去前后缀后全等）→ 相似度 1", () => {
  assert.equal(
    companyNameSimilarity("引大济岷水资源开发有限公司", "四川省引大济岷水资源开发有限公司"),
    1,
  );
});

test("剥前后缀后全等 → 1；互含（子串关系）→ 0.9；无公共子串 → 0", () => {
  assert.equal(companyNameSimilarity("四川水发建设", "四川水发建设有限公司"), 1);
  assert.equal(companyNameSimilarity("四川水发建设", "四川水发建设监理有限公司"), 0.9);
  assert.equal(companyNameSimilarity("某某科技公司", "四川省水利发展集团有限公司"), 0);
});

test("排序：最可能的一家置顶，零分沉底且不打乱其余相对顺序", () => {
  const candidates = [
    { name: "四川省水利发展集团有限公司" },
    { name: "四川省引大济岷水资源开发有限公司" },
    { name: "四川水发建设有限公司" },
  ];
  const ranked = rankCompaniesBySimilarity("引大济岷水资源开发有限公司", candidates);
  assert.equal(ranked[0].name, "四川省引大济岷水资源开发有限公司");
  assert.ok(ranked[0].similarity >= ranked[1].similarity);
  assert.ok(ranked[1].similarity >= ranked[2].similarity);
});

test("「四川水发集团某新分公司」→ 水发系公司应排零分公司之前", () => {
  const candidates = [
    { name: "成都航都自来水有限公司" },
    { name: "四川水发建设有限公司" },
    { name: "井研县兴业供水有限责任公司" },
  ];
  const ranked = rankCompaniesBySimilarity("四川水发集团某新分公司", candidates);
  assert.equal(ranked[0].name, "四川水发建设有限公司");
});
