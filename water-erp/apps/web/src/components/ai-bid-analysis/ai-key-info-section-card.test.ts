import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_KEY_INFO_SECTION_EXPANDED } from "./ai-key-info-section-card";

test("key info section cards are expanded by default", () => {
  assert.equal(DEFAULT_KEY_INFO_SECTION_EXPANDED, true);
});
