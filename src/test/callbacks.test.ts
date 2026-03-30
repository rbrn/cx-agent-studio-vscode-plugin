/*
 * Created by GitHub Copilot on 2026-03-30.
 * Callback helper tests for CES agent manifests.
 */

import { strict as assert } from "assert";
import test from "node:test";
import { collectAgentCallbackEntries, getCallbackFieldLabel } from "../core/callbacks";

test("collectAgentCallbackEntries returns callback entries with resolved paths", () => {
  const entries = collectAgentCallbackEntries("/tmp/sample-package", {
    beforeModelCallbacks: [
      {
        pythonCode: "agents/creditcards_agent/before_model_callbacks/urgent_card_safety/python_code.py",
      },
    ],
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.field, "beforeModelCallbacks");
  assert.equal(entries[0]?.index, 0);
  assert.equal(entries[0]?.pythonCodePath, "agents/creditcards_agent/before_model_callbacks/urgent_card_safety/python_code.py");
  assert.equal(entries[0]?.resolvedFilePath, "/tmp/sample-package/agents/creditcards_agent/before_model_callbacks/urgent_card_safety/python_code.py");
});

test("collectAgentCallbackEntries includes beforeAgentCallbacks entries", () => {
  const entries = collectAgentCallbackEntries("/tmp/sample-package", {
    beforeAgentCallbacks: [
      {
        pythonCode: "agents/root/before_agent_callbacks/setup/python_code.py",
      },
    ],
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.field, "beforeAgentCallbacks");
  assert.equal(getCallbackFieldLabel("beforeAgentCallbacks"), "Before agent callbacks");
});