import test from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import { resolveInstructionRuleSetPath } from "../core/instructionContracts";

test("resolveInstructionRuleSetPath works for compiled module layout", () => {
  const baseDir = path.join(process.cwd(), "dist", "core");
  const resolved = resolveInstructionRuleSetPath(baseDir);
  assert.equal(
    resolved,
    path.join(process.cwd(), "contracts", "instruction-contract-rules.json"),
  );
});

test("resolveInstructionRuleSetPath works for bundled extension layout", () => {
  const baseDir = path.join(process.cwd(), "dist");
  const resolved = resolveInstructionRuleSetPath(baseDir);
  assert.equal(
    resolved,
    path.join(process.cwd(), "contracts", "instruction-contract-rules.json"),
  );
});