import test from "node:test";
import assert from "node:assert/strict";

import { getAiGenerationFields, buildPrefillFromProject, mergePrefillFillingGaps } from "./prefill-from-project";
import type { ProjectManagementItem } from "@/lib/types/project-management";
import type { TenderDocumentType } from "@/lib/types/tender-write";

/** 2026-10-30 实录契约：项目名称不入 AI 生成清单——名称权威来源是 PMI 标题（预填），
 *  LLM 拿全套素材只会写出整段项目综述盖掉名称（服务端同款纵深拦截 PROJECT_NAME_NO_AI）。 */
test("getAiGenerationFields：所有类型均不含 projectName（项目名称只预填不 AI 生成）", () => {
  const types: TenderDocumentType[] = [
    "COMPETITIVE_NEGOTIATION",
    "SINGLE_SOURCE",
    "INQUIRY_PURCHASE",
    "INTERNAL_BIDDING",
    "INVITED_BIDDING",
  ];
  for (const t of types) {
    const fields = getAiGenerationFields(t).map((f) => f.fieldKey);
    assert.ok(!fields.includes("projectName"), `${t} 不应把 projectName 列入 AI 生成`);
  }
});

test("getAiGenerationFields：清单内字段必须都能解析到 aiPrompt（防再混入无提示词字段）", () => {
  const types: TenderDocumentType[] = [
    "COMPETITIVE_NEGOTIATION",
    "SINGLE_SOURCE",
    "INQUIRY_PURCHASE",
    "INTERNAL_BIDDING",
    "INVITED_BIDDING",
  ];
  for (const t of types) {
    for (const f of getAiGenerationFields(t)) {
      assert.ok(f.aiPrompt && f.aiPrompt.length > 10, `${t}.${f.fieldKey} 缺 aiPrompt——无提示词字段会被服务端「生成专业内容」兜底prompt带偏`);
    }
  }
});

const mkProject = (): ProjectManagementItem =>
  ({
    id: "pmi-1",
    title: "便携式全液压岩心钻机（800型）采购",
    requesterName: "张维刚",
    requesterDepartment: "工程勘察院/钻探室",
    procurementMethod: "邀请招标",
    budgetAmount: 873000,
    supplierRequirements: "见附件",
  }) as unknown as ProjectManagementItem;

test("buildPrefillFromProject：项目名称预填 PMI 标题（各类型一致）", () => {
  for (const t of ["COMPETITIVE_NEGOTIATION", "SINGLE_SOURCE", "INQUIRY_PURCHASE", "INTERNAL_BIDDING", "INVITED_BIDDING"] as TenderDocumentType[]) {
    const prefill = buildPrefillFromProject(mkProject(), t) as Record<string, unknown>;
    assert.equal(prefill.projectName, "便携式全液压岩心钻机（800型）采购");
  }
});

test("mergePrefillFillingGaps：非空草稿字段不被预填顶掉（projectName 综述/供应商名同款保护）", () => {
  const merged = mergePrefillFillingGaps(
    { projectName: "用户已改的名称", maxPrice: "" },
    { projectName: "预填标题", maxPrice: "100" },
  );
  assert.equal(merged.projectName, "用户已改的名称");
  assert.equal((merged as Record<string, unknown>).maxPrice, "100");
});
