import assert from "node:assert/strict";
import { test } from "node:test";
import { replaceObjectUrlPreview, revokeObjectUrlPreview } from "../object-url-preview";

test("replacing a local preview releases the previous object URL", () => {
  const revoked: string[] = [];
  const urlApi = {
    createObjectURL: () => "blob:next-logo",
    revokeObjectURL: (url: string) => revoked.push(url),
  };

  const next = replaceObjectUrlPreview({} as Blob, "blob:old-logo", urlApi);

  assert.equal(next, "blob:next-logo");
  assert.deepEqual(revoked, ["blob:old-logo"]);
});

test("cleanup releases the active local preview exactly once", () => {
  const revoked: string[] = [];
  const urlApi = {
    createObjectURL: () => "unused",
    revokeObjectURL: (url: string) => revoked.push(url),
  };

  revokeObjectUrlPreview("blob:active-logo", urlApi);
  revokeObjectUrlPreview("", urlApi);

  assert.deepEqual(revoked, ["blob:active-logo"]);
});
