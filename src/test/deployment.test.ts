/*
 * Created by GitHub Copilot on 2026-03-24.
 * Deployment helper tests for CES packaging/import support.
 */

import { strict as assert } from "assert";
import test from "node:test";
import { collectRequiredArchiveMembers, findMissingArchiveMembers, findUnsupportedRootArchiveMembers } from "../core/deployment";
import { cleanupFixture, createFixture } from "./helpers";

function baseDeploymentFixture(): Record<string, string> {
  return {
    "app.yaml": [
      "displayName: sample_agent",
      "rootAgent: voice_banking_agent",
      "globalInstruction: global_instruction.txt",
      "guardrails: []",
      "",
    ].join("\n"),
    "global_instruction.txt": "Global instruction text for package.",
    "agents/voice_banking_agent/voice_banking_agent.json": JSON.stringify(
      {
        displayName: "voice_banking_agent",
        instruction: "agents/voice_banking_agent/instruction.txt",
        tools: ["customer_lookup"],
      },
      null,
      2,
    ),
    "agents/voice_banking_agent/instruction.txt": "<role>Root agent</role>",
    "tools/customer_lookup/customer_lookup.json": JSON.stringify(
      {
        displayName: "customer_lookup",
        pythonFunction: {
          name: "customer_lookup",
          pythonCode: "tools/customer_lookup/python_code.py",
        },
      },
      null,
      2,
    ),
    "tools/customer_lookup/python_code.py": "def customer_lookup():\n    return {'ok': True}\n",
  };
}

function aliasedToolDeploymentFixture(): Record<string, string> {
  return {
    "app.yaml": [
      "displayName: sample_agent",
      "rootAgent: voice_banking_agent",
      "globalInstruction: global_instruction.txt",
      "guardrails: []",
      "",
    ].join("\n"),
    "global_instruction.txt": "Global instruction text for package.",
    "agents/voice_banking_agent/voice_banking_agent.json": JSON.stringify(
      {
        displayName: "voice_banking_agent",
        instruction: "agents/voice_banking_agent/instruction.txt",
        tools: ["customer_lookup_wrapper"],
      },
      null,
      2,
    ),
    "agents/voice_banking_agent/instruction.txt": "<role>Root agent</role>",
    "tools/customer_lookup/customer_lookup.json": JSON.stringify(
      {
        displayName: "customer_lookup_wrapper",
        pythonFunction: {
          name: "customer_lookup_wrapper",
          pythonCode: "tools/customer_lookup/python_code.py",
        },
      },
      null,
      2,
    ),
    "tools/customer_lookup/python_code.py": "def customer_lookup_wrapper():\n    return {'ok': True}\n",
  };
}

test("collectRequiredArchiveMembers includes direct tool runtime files", () => {
  const rootPath = createFixture(baseDeploymentFixture());

  try {
    const required = collectRequiredArchiveMembers(rootPath);
    assert.equal(required.includes("app.yaml"), true);
    assert.equal(required.includes("global_instruction.txt"), true);
    assert.equal(required.includes("agents/voice_banking_agent/voice_banking_agent.json"), true);
    assert.equal(required.includes("agents/voice_banking_agent/instruction.txt"), true);
    assert.equal(required.includes("tools/customer_lookup/customer_lookup.json"), true);
    assert.equal(required.includes("tools/customer_lookup/python_code.py"), true);
  } finally {
    cleanupFixture(rootPath);
  }
});

test("findMissingArchiveMembers reports excluded direct tool files", () => {
  const rootPath = createFixture(baseDeploymentFixture());

  try {
    const packageName = rootPath.split(/[\\/]/).pop() ?? "package";
    const archiveEntries = [
      `${packageName}/`,
      `${packageName}/app.yaml`,
      `${packageName}/global_instruction.txt`,
      `${packageName}/agents/voice_banking_agent/voice_banking_agent.json`,
      `${packageName}/agents/voice_banking_agent/instruction.txt`,
    ];

    const missing = findMissingArchiveMembers(rootPath, archiveEntries);
    assert.equal(missing.includes(`${packageName}/tools/customer_lookup/customer_lookup.json`), true);
    assert.equal(missing.includes(`${packageName}/tools/customer_lookup/python_code.py`), true);
  } finally {
    cleanupFixture(rootPath);
  }
});

test("collectRequiredArchiveMembers resolves direct tool displayName aliases to real manifest paths", () => {
  const rootPath = createFixture(aliasedToolDeploymentFixture());

  try {
    const required = collectRequiredArchiveMembers(rootPath);
    assert.equal(required.includes("tools/customer_lookup/customer_lookup.json"), true);
    assert.equal(required.includes("tools/customer_lookup_wrapper/customer_lookup_wrapper.json"), false);
    assert.equal(required.includes("tools/customer_lookup/python_code.py"), true);
  } finally {
    cleanupFixture(rootPath);
  }
});

test("findUnsupportedRootArchiveMembers reports import-unsafe root files", () => {
  const rootPath = createFixture({
    ...baseDeploymentFixture(),
    "validate-package.py": "print('helper')\n",
  });

  try {
    const packageName = rootPath.split(/[\\/]/).pop() ?? "package";
    const unsupported = findUnsupportedRootArchiveMembers(rootPath, [
      `${packageName}/`,
      `${packageName}/app.yaml`,
      `${packageName}/global_instruction.txt`,
      `${packageName}/agents/voice_banking_agent/voice_banking_agent.json`,
      `${packageName}/agents/voice_banking_agent/instruction.txt`,
      `${packageName}/tools/customer_lookup/customer_lookup.json`,
      `${packageName}/tools/customer_lookup/python_code.py`,
      `${packageName}/validate-package.py`,
    ]);

    assert.deepEqual(unsupported, [`${packageName}/validate-package.py`]);
  } finally {
    cleanupFixture(rootPath);
  }
});
