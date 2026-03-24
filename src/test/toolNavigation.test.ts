/*
 * Created by GitHub Copilot on 2026-03-24.
 * Tool navigation helper tests for clickable tool inventory nodes.
 */

import { strict as assert } from "assert";
import test from "node:test";
import { buildPackageModel } from "../core/packageIndex";
import { resolveDirectToolNavigation, resolveOpenApiOperationNavigation, resolveToolsetNavigation } from "../core/toolNavigation";
import { cleanupFixture, createFixture } from "./helpers";

function baseToolNavigationFixture(): Record<string, string> {
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
        toolsets: [{ toolset: "location", toolIds: ["searchBranches"] }],
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
    "tools/customer_lookup/python_code.py": [
      "from typing import Any",
      "",
      "def customer_lookup(partner_id: str = \"\") -> dict[str, Any]:",
      "    return {\"partner_id\": partner_id}",
      "",
    ].join("\n"),
    "toolsets/location/location.json": JSON.stringify(
      {
        displayName: "location",
        openApiToolset: {
          openApiSchema: "toolsets/location/open_api_toolset/open_api_schema.yaml",
        },
      },
      null,
      2,
    ),
    "toolsets/location/open_api_toolset/open_api_schema.yaml": [
      "openapi: 3.0.0",
      "info:",
      "  title: Location API",
      "  version: 1.0.0",
      "paths:",
      "  /branches/search:",
      "    get:",
      "      operationId: searchBranches",
      "      responses:",
      "        '200':",
      "          description: ok",
      "",
    ].join("\n"),
  };
}

test("resolveDirectToolNavigation points Python tools to python_code.py", () => {
  const rootPath = createFixture(baseToolNavigationFixture());

  try {
    const model = buildPackageModel(rootPath);
    const target = resolveDirectToolNavigation(model, "customer_lookup");
    assert.ok(target);
    assert.equal(target?.filePath.endsWith("tools/customer_lookup/python_code.py"), true);
    assert.equal(target?.line, 3);
    assert.equal(target?.description, "python tool");
  } finally {
    cleanupFixture(rootPath);
  }
});

test("resolveOpenApiOperationNavigation points operations to schema operationId", () => {
  const rootPath = createFixture(baseToolNavigationFixture());

  try {
    const model = buildPackageModel(rootPath);
    const target = resolveOpenApiOperationNavigation(model, "searchBranches");
    assert.ok(target);
    assert.equal(target?.filePath.endsWith("toolsets/location/open_api_toolset/open_api_schema.yaml"), true);
    assert.equal(target?.line, 8);
    assert.equal(target?.description, "OpenAPI operation (location)");
  } finally {
    cleanupFixture(rootPath);
  }
});

test("resolveToolsetNavigation points toolset references to their manifest", () => {
  const rootPath = createFixture(baseToolNavigationFixture());

  try {
    const model = buildPackageModel(rootPath);
    const target = resolveToolsetNavigation(model, "location");
    assert.ok(target);
    assert.equal(target?.filePath.endsWith("toolsets/location/location.json"), true);
    assert.equal(target?.line, 1);
    assert.equal(target?.description, "toolset manifest");
  } finally {
    cleanupFixture(rootPath);
  }
});
