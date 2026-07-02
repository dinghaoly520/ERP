import test from "node:test";
import assert from "node:assert/strict";

import { resolveWorkspaceStage } from "./ai-workspace-stage-sync";
import type { AiWorkspaceStageItem } from "@/lib/types/ai-bid-analysis";

const stages = [
  { key: "upload", label: "文件上传", enabled: true, completed: true, active: false },
  { key: "key-info", label: "关键信息", enabled: true, completed: false, active: true },
] satisfies AiWorkspaceStageItem[];

test("keeps the upload tab active after an upload enables the next stage", () => {
  assert.equal(resolveWorkspaceStage("upload", "key-info", stages), "upload");
});
