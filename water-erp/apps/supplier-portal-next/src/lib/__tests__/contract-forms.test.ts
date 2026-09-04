import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as contractForms from "../contract-forms";

const { canAttachFulfillmentProof, validateProofFile, validateSatisfaction } = contractForms;
const getLocalRecordsPanelVisibility = (
  contractForms as typeof contractForms & {
    getLocalRecordsPanelVisibility?: (view: "platform" | "archive") => {
      platform: boolean;
      archive: boolean;
    };
  }
).getLocalRecordsPanelVisibility;

test("contract proof validates size and supported document/image MIME types", () => {
  assert.equal(validateProofFile({ name: "proof.pdf", type: "application/pdf", size: 1024 }), null);
  assert.equal(validateProofFile({ name: "proof.exe", type: "application/octet-stream", size: 1024 }), "仅支持 PDF、Word、JPG 或 PNG 文件");
  assert.equal(validateProofFile({ name: "proof.pdf", type: "application/zip", size: 1024 }), "文件扩展名与实际类型不一致");
  assert.equal(validateProofFile({ name: "proof.zip", type: "application/pdf", size: 1024 }), "文件扩展名与实际类型不一致");
  assert.equal(validateProofFile({ name: "large.pdf", type: "application/pdf", size: 50 * 1024 * 1024 + 1 }), "文件大小不能超过 50 MB");
});

test("completed or inactive contract evidence cannot be replaced", () => {
  assert.equal(canAttachFulfillmentProof("performing", "pending"), true);
  assert.equal(canAttachFulfillmentProof("performing", "exception"), true);
  assert.equal(canAttachFulfillmentProof("performing", "done"), false);
  assert.equal(canAttachFulfillmentProof("accepted", "pending"), false);
  assert.equal(canAttachFulfillmentProof("terminated", "exception"), false);
});

test("local records workspaces expose exactly one data domain at a time", () => {
  assert.equal(typeof getLocalRecordsPanelVisibility, "function");
  if (!getLocalRecordsPanelVisibility) return;

  assert.deepEqual(getLocalRecordsPanelVisibility("platform"), {
    platform: true,
    archive: false,
  });
  assert.deepEqual(getLocalRecordsPanelVisibility("archive"), {
    platform: false,
    archive: true,
  });
});

test("supplier contract page labels approved contracts as awaiting signature", () => {
  const source = readFileSync(
    new URL("../../app/(main)/contracts/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /approved_for_signing/);
  assert.match(source, /内审已通过·待签署/);
});

test("satisfaction score must be an integer from one to five", () => {
  assert.equal(validateSatisfaction(0), "请选择 1 至 5 分的满意度");
  assert.equal(validateSatisfaction(3.5), "请选择 1 至 5 分的满意度");
  assert.equal(validateSatisfaction(5), null);
});
