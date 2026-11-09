import test from "node:test";
import assert from "node:assert/strict";

// @ts-expect-error Node 原生 --test 的 ESM 解析需要显式 .ts 扩展；tsc（bundler 分辨）不接受——压此行
import { splitQualificationItems } from "./qualification-split.ts";

test("用户实录样例：三类标记多合一名称 → 按类分组拆条目", () => {
  const raw =
    "资质/许可/认证: （1）资质：电子与智能化工程专业承包一级、乙级测绘资质 （2）许可：安全生产许可证 （3）认证：质量管理体系证书、信息技术服务管理体系认证证书、环境管理体系认证证书、职业健康安全管理体系认证证书、信息安全管理体系认证证书、国家高新技术企业、成都市企业技术中心、四川省“专精特新”中小企业、四川省软件省内首版次产品荣誉证书、软件企业、软件产品证书、ITSS运维证书、CMMI 3级认证以及多项发明专利证书和软件著作权登记证书等";
  const groups = splitQualificationItems(raw);
  assert.ok(groups);
  assert.deepEqual(
    groups.map((g) => g.label),
    ["资质", "许可", "认证"],
  );
  assert.deepEqual(groups[0].items, ["电子与智能化工程专业承包一级", "乙级测绘资质"]);
  assert.deepEqual(groups[1].items, ["安全生产许可证"]);
  assert.equal(groups[2].items.length, 14);
  // 「以及」接力拆 + 句尾「等」剥除
  assert.equal(groups[2].items[12], "CMMI 3级认证");
  assert.equal(groups[2].items[13], "多项发明专利证书和软件著作权登记证书");
});

test("单项普通名称 → null（原文渲染）", () => {
  assert.equal(splitQualificationItems("安全生产许可证"), null);
  assert.equal(splitQualificationItems("质量管理体系证书"), null);
});

test("同级别两项「一级、二级」→ null（不可断名，保守不拆）", () => {
  assert.equal(splitQualificationItems("电子与智能化工程专业承包一级、二级"), null);
});

test("无分类标记的顿号枚举 ≥3 项 → 拆为无标签单组", () => {
  const groups = splitQualificationItems("质量管理体系证书、环境管理体系认证证书、职业健康安全管理体系认证证书");
  assert.deepEqual(groups, [
    { label: "", items: ["质量管理体系证书", "环境管理体系认证证书", "职业健康安全管理体系认证证书"] },
  ]);
});

test("半角括号/冒号标记变体 → 照常分组", () => {
  const groups = splitQualificationItems("(1)资质: 甲资质 (2)许可: 乙许可证");
  assert.ok(groups);
  assert.deepEqual(groups, [
    { label: "资质", items: ["甲资质"] },
    { label: "许可", items: ["乙许可证"] },
  ]);
});

test("分类标记前有正文残段 → 形态不可识别，null 交回原文", () => {
  assert.equal(splitQualificationItems("本单位拥有以下各项（1）资质：甲、乙"), null);
});
