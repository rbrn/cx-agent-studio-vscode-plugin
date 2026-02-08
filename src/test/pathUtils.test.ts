/*
 * Created by Codex on 2026-02-08.
 * Unit tests for path and classifier helpers.
 */

import { strict as assert } from "assert";
import test from "node:test";
import { getDepthBelowTopLevel, isLikelyInlineGlobalInstruction, isRelevantFilesystemPath, toRelativePath } from "../core/pathUtils";

test("getDepthBelowTopLevel returns expected depth", () => {
  assert.equal(getDepthBelowTopLevel("agents/root/instruction.txt"), 2);
  assert.equal(getDepthBelowTopLevel("toolsets/location/open_api_toolset/open_api_schema.yaml"), 3);
  assert.equal(getDepthBelowTopLevel("app.yaml"), 0);
});

test("isLikelyInlineGlobalInstruction detects inline text", () => {
  assert.equal(isLikelyInlineGlobalInstruction("global_instruction.txt"), false);
  assert.equal(isLikelyInlineGlobalInstruction("Use this policy for all customer interactions."), true);
  assert.equal(isLikelyInlineGlobalInstruction("Line one\nLine two"), true);
});

test("isRelevantFilesystemPath recognizes CES package files", () => {
  assert.equal(isRelevantFilesystemPath("/tmp/agent/app.yaml"), true);
  assert.equal(isRelevantFilesystemPath("/tmp/agent/agents/root/root.json"), true);
  assert.equal(isRelevantFilesystemPath("/tmp/random/readme.md"), false);

  const relative = toRelativePath("/tmp/agent", "/tmp/agent/toolsets/location/location.json");
  assert.equal(relative, "toolsets/location/location.json");
});
