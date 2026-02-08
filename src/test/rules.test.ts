/*
 * Created by Codex on 2026-02-08.
 * Rule engine tests for CES validator MVP checks.
 */

import { strict as assert } from "assert";
import test from "node:test";
import { buildPackageModel } from "../core/packageIndex";
import { runRules } from "../core/rules";
import { ValidationIssue } from "../core/types";
import { cleanupFixture, createFixture } from "./helpers";

function runValidation(files: Record<string, string>): ValidationIssue[] {
  const rootPath = createFixture(files);
  try {
    const model = buildPackageModel(rootPath);
    return runRules(model);
  } finally {
    cleanupFixture(rootPath);
  }
}

function hasCode(issues: ValidationIssue[], code: string): boolean {
  return issues.some((issue) => issue.code === code);
}

function baseValidFixture(): Record<string, string> {
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
        childAgents: ["location_services_agent"],
      },
      null,
      2,
    ),
    "agents/voice_banking_agent/instruction.txt": "<role>\nRoot agent instruction\n</role>",
    "agents/location_services_agent/location_services_agent.json": JSON.stringify(
      {
        displayName: "location_services_agent",
        instruction: "agents/location_services_agent/instruction.txt",
        toolsets: [{ toolset: "location" }],
      },
      null,
      2,
    ),
    "agents/location_services_agent/instruction.txt": "<role>\nChild agent instruction\n</role>",
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
      "paths: {}",
      "",
    ].join("\n"),
    "environment.json": JSON.stringify(
      {
        toolsets: {
          location: {
            openApiToolset: {
              url: "https://api.example.com",
            },
          },
        },
      },
      null,
      2,
    ),
  };
}

test("valid package fixture passes MVP checks", () => {
  const issues = runValidation(baseValidFixture());
  assert.equal(issues.length, 0);
});

test("missing rootAgent directory is reported", () => {
  const files = baseValidFixture();
  files["app.yaml"] = [
    "displayName: sample_agent",
    "rootAgent: missing_root_agent",
    "globalInstruction: global_instruction.txt",
    "guardrails: []",
    "",
  ].join("\n");

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_ROOT_AGENT_DIR_MISSING"), true);
});

test("missing globalInstruction file is reported", () => {
  const files = baseValidFixture();
  files["app.yaml"] = [
    "displayName: sample_agent",
    "rootAgent: voice_banking_agent",
    "globalInstruction: missing_global_instruction.txt",
    "guardrails: []",
    "",
  ].join("\n");

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_GLOBAL_INSTRUCTION_MISSING"), true);
});

test("agent instruction path mismatch is reported", () => {
  const files = baseValidFixture();
  files["agents/location_services_agent/location_services_agent.json"] = JSON.stringify(
    {
      displayName: "location_services_agent",
      instruction: "agents/location_services_agent/wrong_instruction.txt",
      toolsets: [{ toolset: "location" }],
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_AGENT_INSTRUCTION_PATH_MISMATCH"), true);
});

test("missing OpenAPI schema is reported", () => {
  const files = baseValidFixture();
  files["toolsets/location/location.json"] = JSON.stringify(
    {
      displayName: "location",
      openApiToolset: {
        openApiSchema: "toolsets/location/open_api_toolset/missing_schema.yaml",
      },
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_OPENAPI_SCHEMA_MISSING"), true);
});

test("invalid OpenAPI syntax is reported", () => {
  const files = baseValidFixture();
  files["toolsets/location/open_api_toolset/open_api_schema.yaml"] = "openapi: [";

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_OPENAPI_PARSE_ERROR"), true);
});

test("unsupported evaluationDatasets directory is reported", () => {
  const files = baseValidFixture();
  files["evaluationDatasets/sample/sample.json"] = JSON.stringify({ displayName: "sample" }, null, 2);

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_UNSUPPORTED_IMPORT_DIRECTORY"), true);
});

test("localhost URLs in environment.json produce warning", () => {
  const files = baseValidFixture();
  files["environment.json"] = JSON.stringify(
    {
      toolsets: {
        location: {
          openApiToolset: {
            url: "http://localhost:8080",
          },
        },
      },
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_ENVIRONMENT_LOCALHOST_WARNING"), true);
});

test("deep agents nesting produces warning", () => {
  const files = baseValidFixture();
  files["agents/location_services_agent/deep/extra/file.txt"] = "nested";

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_NESTING_DEPTH_EXCEEDED"), true);
});

test("missing guardrail reference is reported", () => {
  const files = baseValidFixture();
  files["app.yaml"] = [
    "displayName: sample_agent",
    "rootAgent: voice_banking_agent",
    "globalInstruction: global_instruction.txt",
    "guardrails:",
    "  - Safety Guardrail 123",
    "",
  ].join("\n");

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_GUARDRAIL_REFERENCE_MISSING"), true);
});

test("nested guardrail folders are accepted (standard CES pattern)", () => {
  const files = baseValidFixture();
  files["app.yaml"] = [
    "displayName: sample_agent",
    "rootAgent: voice_banking_agent",
    "globalInstruction: global_instruction.txt",
    "guardrails:",
    "  - Safety Guardrail 99",
    "",
  ].join("\n");
  files["guardrails/Safety_Guardrail_99/Safety_Guardrail_99.json"] = JSON.stringify(
    { displayName: "Safety Guardrail 99" },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_GUARDRAIL_NESTING_NOT_SUPPORTED"), false);
  assert.equal(hasCode(issues, "CES_GUARDRAIL_NESTING_DEPTH_EXCEEDED"), false);
  assert.equal(hasCode(issues, "CES_GUARDRAIL_REFERENCE_MISSING"), false);
});

// ── Tool inventory tests ──────────────────────────────────────────────────

test("tool inventory collects direct tools from agent tools array", () => {
  const files = baseValidFixture();
  files["agents/voice_banking_agent/voice_banking_agent.json"] = JSON.stringify(
    {
      displayName: "voice_banking_agent",
      instruction: "agents/voice_banking_agent/instruction.txt",
      childAgents: ["location_services_agent"],
      tools: ["end_session"],
    },
    null,
    2,
  );

  const rootPath = createFixture(files);
  try {
    const model = buildPackageModel(rootPath);
    assert.equal(model.directTools.has("end_session"), true);
  } finally {
    cleanupFixture(rootPath);
  }
});

test("tool inventory collects OpenAPI operations from toolIds", () => {
  const files = baseValidFixture();
  files["agents/location_services_agent/location_services_agent.json"] = JSON.stringify(
    {
      displayName: "location_services_agent",
      instruction: "agents/location_services_agent/instruction.txt",
      toolsets: [{ toolset: "location", toolIds: ["searchBranches", "getBranch"] }],
    },
    null,
    2,
  );

  const rootPath = createFixture(files);
  try {
    const model = buildPackageModel(rootPath);
    assert.equal(model.openApiOperations.has("searchBranches"), true);
    assert.equal(model.openApiOperations.has("getBranch"), true);
  } finally {
    cleanupFixture(rootPath);
  }
});

// ── Evaluation validation tests ───────────────────────────────────────────

test("evaluations directory is NOT flagged as unsupported", () => {
  const files = baseValidFixture();
  files["evaluations/test_eval/test_eval.json"] = JSON.stringify(
    {
      displayName: "test_eval",
      golden: { turns: [] },
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_UNSUPPORTED_IMPORT_DIRECTORY"), false);
});

test("evaluation displayName mismatch produces warning", () => {
  const files = baseValidFixture();
  files["evaluations/test_eval/test_eval.json"] = JSON.stringify(
    {
      displayName: "wrong_name",
      golden: { turns: [] },
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_EVALUATION_DISPLAYNAME_MISMATCH"), true);
});

test("L-01: toolCall referencing OpenAPI operation is an error", () => {
  const files = baseValidFixture();
  // Add toolIds so searchBranches is known as an OpenAPI operation
  files["agents/location_services_agent/location_services_agent.json"] = JSON.stringify(
    {
      displayName: "location_services_agent",
      instruction: "agents/location_services_agent/instruction.txt",
      toolsets: [{ toolset: "location", toolIds: ["searchBranches", "getBranch"] }],
    },
    null,
    2,
  );
  // Add direct tool so the inventory has both categories
  files["agents/voice_banking_agent/voice_banking_agent.json"] = JSON.stringify(
    {
      displayName: "voice_banking_agent",
      instruction: "agents/voice_banking_agent/instruction.txt",
      childAgents: ["location_services_agent"],
      tools: ["end_session"],
    },
    null,
    2,
  );
  // Evaluation with bad toolCall referencing an OpenAPI operation
  files["evaluations/branch_search/branch_search.json"] = JSON.stringify(
    {
      displayName: "branch_search",
      golden: {
        turns: [
          {
            steps: [
              {
                expectation: {
                  toolCall: { tool: "searchBranches" },
                },
              },
            ],
          },
        ],
      },
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_EVALUATION_TOOLCALL_OPENAPI_OPERATION"), true);
});

test("L-01: toolCall referencing unknown tool is an error", () => {
  const files = baseValidFixture();
  files["agents/voice_banking_agent/voice_banking_agent.json"] = JSON.stringify(
    {
      displayName: "voice_banking_agent",
      instruction: "agents/voice_banking_agent/instruction.txt",
      childAgents: ["location_services_agent"],
      tools: ["end_session"],
    },
    null,
    2,
  );
  files["evaluations/test_eval/test_eval.json"] = JSON.stringify(
    {
      displayName: "test_eval",
      golden: {
        turns: [
          {
            steps: [
              {
                expectation: {
                  toolCall: { tool: "nonexistent_tool" },
                },
              },
            ],
          },
        ],
      },
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_EVALUATION_TOOLCALL_UNKNOWN"), true);
});

test("L-01: toolCall referencing a valid direct tool passes", () => {
  const files = baseValidFixture();
  files["agents/voice_banking_agent/voice_banking_agent.json"] = JSON.stringify(
    {
      displayName: "voice_banking_agent",
      instruction: "agents/voice_banking_agent/instruction.txt",
      childAgents: ["location_services_agent"],
      tools: ["end_session"],
    },
    null,
    2,
  );
  files["evaluations/session_end/session_end.json"] = JSON.stringify(
    {
      displayName: "session_end",
      golden: {
        turns: [
          {
            steps: [
              {
                expectation: {
                  toolCall: { tool: "end_session" },
                },
              },
            ],
          },
        ],
      },
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_EVALUATION_TOOLCALL_OPENAPI_OPERATION"), false);
  assert.equal(hasCode(issues, "CES_EVALUATION_TOOLCALL_UNKNOWN"), false);
});

// ── Instruction parsing & validation tests ────────────────────────────────

test("instruction with all sections parses correctly", () => {
  const files = baseValidFixture();
  files["agents/voice_banking_agent/instruction.txt"] = [
    "<role>",
    "    You are the main banking agent.",
    "</role>",
    "<persona>",
    "    Friendly and professional.",
    "</persona>",
    "<constraints>",
    "    1. Be concise.",
    "</constraints>",
    "<taskflow>",
    "    <subtask name=\"Main\">",
    "        <step name=\"Greet\">",
    "            <trigger>User says hello</trigger>",
    "            <action>Greet back</action>",
    "        </step>",
    "    </subtask>",
    "</taskflow>",
    "<examples>",
    "    <example>",
    "        <user>Hello</user>",
    "        <agent>Welcome!</agent>",
    "    </example>",
    "</examples>",
  ].join("\n");

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_INSTRUCTION_MISSING_SECTION"), false);
  assert.equal(hasCode(issues, "CES_INSTRUCTION_PARSE_ERROR"), false);
});

test("instruction missing required <role> section produces warning", () => {
  const files = baseValidFixture();
  files["agents/voice_banking_agent/instruction.txt"] = [
    "<persona>",
    "    Friendly and professional.",
    "</persona>",
    "<constraints>",
    "    1. Be concise.",
    "</constraints>",
  ].join("\n");

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_INSTRUCTION_MISSING_SECTION"), true);
  const sectionIssue = issues.find((i) => i.code === "CES_INSTRUCTION_MISSING_SECTION");
  assert.ok(sectionIssue?.message.includes("<role>"));
});

test("instruction with {@AGENT:} reference to unknown agent produces error", () => {
  const files = baseValidFixture();
  files["agents/voice_banking_agent/instruction.txt"] = [
    "<role>",
    "    You are the main agent.",
    "</role>",
    "<constraints>",
    "    Transfer to {@AGENT: nonexistent_agent} for help.",
    "</constraints>",
  ].join("\n");

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_INSTRUCTION_AGENT_REF_UNKNOWN"), true);
  const refIssue = issues.find((i) => i.code === "CES_INSTRUCTION_AGENT_REF_UNKNOWN");
  assert.ok(refIssue?.message.includes("nonexistent_agent"));
});

test("instruction with {@AGENT:} reference to known agent passes", () => {
  const files = baseValidFixture();
  files["agents/voice_banking_agent/instruction.txt"] = [
    "<role>",
    "    You are the main agent.",
    "</role>",
    "<constraints>",
    "    Transfer to {@AGENT: location_services_agent} for locations.",
    "</constraints>",
  ].join("\n");

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_INSTRUCTION_AGENT_REF_UNKNOWN"), false);
});

test("instruction with {@TOOL:} reference to unknown tool produces warning", () => {
  const files = baseValidFixture();
  files["agents/voice_banking_agent/voice_banking_agent.json"] = JSON.stringify(
    {
      displayName: "voice_banking_agent",
      instruction: "agents/voice_banking_agent/instruction.txt",
      childAgents: ["location_services_agent"],
      tools: ["end_session"],
    },
    null,
    2,
  );
  files["agents/voice_banking_agent/instruction.txt"] = [
    "<role>",
    "    You are the main agent.",
    "</role>",
    "<constraints>",
    "    Use {@TOOL: unknown_tool} to do something.",
    "</constraints>",
  ].join("\n");

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_INSTRUCTION_TOOL_REF_UNKNOWN"), true);
});

test("instruction with tool_call referencing unknown toolset produces warning", () => {
  const files = baseValidFixture();
  files["agents/voice_banking_agent/instruction.txt"] = [
    "<role>",
    "    You are the main agent.",
    "</role>",
    "<examples>",
    "    <example>",
    "        <user>Search</user>",
    "        <tool_call>unknown_toolset.doSomething(query=\"test\")</tool_call>",
    "    </example>",
    "</examples>",
  ].join("\n");

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_INSTRUCTION_TOOLCALL_UNKNOWN_TOOLSET"), true);
});

test("instruction with tool_call referencing known toolset passes", () => {
  const files = baseValidFixture();
  files["agents/location_services_agent/instruction.txt"] = [
    "<role>",
    "    You are the location agent.",
    "</role>",
    "<examples>",
    "    <example>",
    "        <user>Find branches</user>",
    "        <tool_call>location.searchBranches(city=\"Berlin\")</tool_call>",
    "    </example>",
    "</examples>",
  ].join("\n");

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_INSTRUCTION_TOOLCALL_UNKNOWN_TOOLSET"), false);
});

test("instruction with unclosed section produces parse error", () => {
  const files = baseValidFixture();
  files["agents/voice_banking_agent/instruction.txt"] = [
    "<role>",
    "    You are the main agent.",
    "<constraints>",
    "    Be concise.",
    "</constraints>",
  ].join("\n");

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_INSTRUCTION_PARSE_ERROR"), true);
  const parseIssue = issues.find((i) => i.code === "CES_INSTRUCTION_PARSE_ERROR");
  assert.ok(parseIssue?.message.includes("Unclosed"));
  assert.ok(parseIssue?.message.includes("<role>"));
});

test("instruction with single-line sections parses correctly", () => {
  const files = baseValidFixture();
  files["agents/voice_banking_agent/instruction.txt"] = [
    '<role>You are a fallback agent.</role>',
    '<persona>',
    '    Be helpful.',
    '</persona>',
  ].join("\n");

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_INSTRUCTION_PARSE_ERROR"), false);
});

test("instruction model is populated on PackageModel", () => {
  const files = baseValidFixture();
  files["agents/voice_banking_agent/instruction.txt"] = [
    "<role>",
    "    You are the main agent.",
    "</role>",
    "<constraints>",
    "    Transfer to {@AGENT: location_services_agent} for locations.",
    "    Use {@TOOL: end_session} to end.",
    "</constraints>",
    "<examples>",
    "    <example>",
    "        <user>Find branches</user>",
    "        <tool_call>location.searchBranches(city=\"Berlin\")</tool_call>",
    "    </example>",
    "</examples>",
  ].join("\n");

  const rootPath = createFixture(files);
  try {
    const model = buildPackageModel(rootPath);
    assert.ok(model.instructionInfos.length > 0);
    const vba = model.instructionInfos.find((i) => i.agentName === "voice_banking_agent");
    assert.ok(vba);
    assert.equal(vba.sections.length, 3); // role, constraints, examples
    assert.equal(vba.references.length, 2); // 1 agent + 1 tool
    assert.equal(vba.toolCalls.length, 1); // location.searchBranches
    assert.equal(vba.toolCalls[0].operation, "location.searchBranches");
  } finally {
    cleanupFixture(rootPath);
  }
});
