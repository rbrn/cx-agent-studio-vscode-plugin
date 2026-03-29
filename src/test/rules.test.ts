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

function fullGlobalInstructionFixture(): string {
  return [
    "<persona>",
    "Global banking persona.",
    "</persona>",
    "<constraints>",
    "1. Be concise.",
    "</constraints>",
  ].join("\n");
}

function fullAgentInstructionFixture(): string {
  return [
    "<role>",
    "    You are the agent.",
    "</role>",
    "<persona>",
    "    Helpful and concise.",
    "</persona>",
    "<constraints>",
    "    1. Stay in scope.",
    "</constraints>",
    "<taskflow>",
    "    <subtask name=\"Main\">",
    "        <step name=\"Help\">",
    "            <action>Help the caller.</action>",
    "        </step>",
    "    </subtask>",
    "</taskflow>",
  ].join("\n");
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
    "global_instruction.txt": fullGlobalInstructionFixture(),
    "agents/voice_banking_agent/voice_banking_agent.json": JSON.stringify(
      {
        displayName: "voice_banking_agent",
        instruction: "agents/voice_banking_agent/instruction.txt",
        childAgents: ["location_services_agent"],
      },
      null,
      2,
    ),
    "agents/voice_banking_agent/instruction.txt": fullAgentInstructionFixture(),
    "agents/location_services_agent/location_services_agent.json": JSON.stringify(
      {
        displayName: "location_services_agent",
        instruction: "agents/location_services_agent/instruction.txt",
        toolsets: [{ toolset: "location", toolIds: ["searchBranches", "getBranch"] }],
      },
      null,
      2,
    ),
    "agents/location_services_agent/instruction.txt": fullAgentInstructionFixture(),
    "toolsets/location/location.json": JSON.stringify(
      {
        displayName: "location",
        toolIds: ["searchBranches", "getBranch"],
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

test("manifest import compatibility accepts integer semantic similarity threshold", () => {
  const files = baseValidFixture();
  files["app.yaml"] = [
    "displayName: sample_agent",
    "rootAgent: voice_banking_agent",
    "globalInstruction: global_instruction.txt",
    "guardrails: []",
    "evaluationMetricsThresholds:",
    "  goldenEvaluationMetricsThresholds:",
    "    turnLevelMetricsThresholds:",
    "      semanticSimilaritySuccessThreshold: 3",
    "",
  ].join("\n");

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_MANIFEST_IMPORT_INT32_INVALID"), false);
});

test("manifest import compatibility rejects decimal semantic similarity threshold in app.json", () => {
  const files = baseValidFixture();
  delete files["app.yaml"];
  files["app.json"] = JSON.stringify(
    {
      displayName: "sample_agent",
      rootAgent: "voice_banking_agent",
      globalInstruction: "global_instruction.txt",
      guardrails: [],
      evaluationMetricsThresholds: {
        goldenEvaluationMetricsThresholds: {
          turnLevelMetricsThresholds: {
            semanticSimilaritySuccessThreshold: 2.5,
          },
        },
      },
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_MANIFEST_IMPORT_INT32_INVALID"), true);
  const issue = issues.find((i) => i.code === "CES_MANIFEST_IMPORT_INT32_INVALID");
  assert.ok(issue?.message.includes("semanticSimilaritySuccessThreshold"));
});

test("manifest import compatibility rejects float-like integer literals in app.yaml", () => {
  const files = baseValidFixture();
  files["app.yaml"] = [
    "displayName: sample_agent",
    "rootAgent: voice_banking_agent",
    "globalInstruction: global_instruction.txt",
    "guardrails: []",
    "evaluationMetricsThresholds:",
    "  goldenEvaluationMetricsThresholds:",
    "    turnLevelMetricsThresholds:",
    "      semanticSimilaritySuccessThreshold: 3.0",
    "",
  ].join("\n");

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_MANIFEST_IMPORT_INT32_INVALID"), true);
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

test("global instruction that violates the shared section contract is reported", () => {
  const files = baseValidFixture();
  files["global_instruction.txt"] = [
    "<persona>",
    "Global banking persona.",
    "</persona>",
    "<constraints>",
    "1. Be concise.",
    "</constraints>",
    "<taskflow>",
    "<subtask name=\"Bad\">",
    "<step name=\"Bad\">",
    "<action>Should not exist.</action>",
    "</step>",
    "</subtask>",
    "</taskflow>",
  ].join("\n");

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_INSTRUCTION_UNEXPECTED_SECTION"), true);
});

test("instruction with empty examples section is reported", () => {
  const files = baseValidFixture();
  files["agents/location_services_agent/instruction.txt"] = [
    "<role>",
    "You are the location agent.",
    "</role>",
    "<persona>",
    "Helpful and concise.",
    "</persona>",
    "<constraints>",
    "1. Stay in scope.",
    "</constraints>",
    "<taskflow>",
    "<subtask name=\"Search\">",
    "<step name=\"Search\">",
    "<action>Search for branches.</action>",
    "</step>",
    "</subtask>",
    "</taskflow>",
    "<examples>",
    "</examples>",
  ].join("\n");

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_INSTRUCTION_EXAMPLES_EMPTY"), true);
});

test("instruction with tool_call referencing undeclared attached operation produces error", () => {
  const files = baseValidFixture();
  files["agents/location_services_agent/instruction.txt"] = [
    "<role>",
    "    You are the location agent.",
    "</role>",
    "<persona>",
    "    Helpful and concise.",
    "</persona>",
    "<constraints>",
    "    1. Stay in scope.",
    "</constraints>",
    "<taskflow>",
    "    <subtask name=\"Search\">",
    "        <step name=\"Search\">",
    "            <action>Search for branches.</action>",
    "        </step>",
    "    </subtask>",
    "</taskflow>",
    "<examples>",
    "    <example>",
    "        <user>Find branches</user>",
    "        <tool_call>location.lookupByCoordinates(lat=\"1\", lng=\"2\")</tool_call>",
    "    </example>",
    "</examples>",
  ].join("\n");

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_INSTRUCTION_TOOLCALL_UNKNOWN_OPERATION"), true);
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
    assert.equal(vba.exampleCount, 1);
    assert.equal(vba.toolCalls[0].operation, "location.searchBranches");
  } finally {
    cleanupFixture(rootPath);
  }
});

// ── Python function tools tests ───────────────────────────────────────────

test("valid Python function tool passes", () => {
  const files = baseValidFixture();
  files["tools/get_balance/get_balance.json"] = JSON.stringify(
    {
      displayName: "get_balance",
      pythonFunction: {
        pythonCode: "tools/get_balance/get_balance.py",
      },
    },
    null,
    2,
  );
  files["tools/get_balance/get_balance.py"] = "def get_balance(): pass";

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_PYTHON_TOOL_MANIFEST_INVALID"), false);
  assert.equal(hasCode(issues, "CES_PYTHON_TOOL_MISSING_FUNCTION"), false);
  assert.equal(hasCode(issues, "CES_PYTHON_TOOL_MISSING_CODE_PATH"), false);
  assert.equal(hasCode(issues, "CES_PYTHON_TOOL_CODE_MISSING"), false);
});

test("Python tool with missing pythonCode file is reported", () => {
  const files = baseValidFixture();
  files["tools/get_balance/get_balance.json"] = JSON.stringify(
    {
      displayName: "get_balance",
      pythonFunction: {
        pythonCode: "tools/get_balance/missing.py",
      },
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_PYTHON_TOOL_CODE_MISSING"), true);
});

test("Python tool without pythonFunction object is reported", () => {
  const files = baseValidFixture();
  files["tools/get_balance/get_balance.json"] = JSON.stringify(
    {
      displayName: "get_balance",
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_PYTHON_TOOL_MISSING_FUNCTION"), true);
});

test("Python tool without pythonCode path is reported", () => {
  const files = baseValidFixture();
  files["tools/get_balance/get_balance.json"] = JSON.stringify(
    {
      displayName: "get_balance",
      pythonFunction: {},
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_PYTHON_TOOL_MISSING_CODE_PATH"), true);
});

test("Python function tools are registered as direct tools", () => {
  const files = baseValidFixture();
  files["tools/get_balance/get_balance.json"] = JSON.stringify(
    {
      displayName: "get_balance",
      pythonFunction: {
        pythonCode: "tools/get_balance/get_balance.py",
      },
    },
    null,
    2,
  );
  files["tools/get_balance/get_balance.py"] = "def get_balance(): pass";

  const rootPath = createFixture(files);
  try {
    const model = buildPackageModel(rootPath);
    assert.equal(model.directTools.has("get_balance"), true);
  } finally {
    cleanupFixture(rootPath);
  }
});

// ── Namespaced OpenAPI operation tests ────────────────────────────────────

test("L-01: namespaced toolCall (toolset.operationId) is caught as OpenAPI operation", () => {
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
  files["evaluations/branch_search/branch_search.json"] = JSON.stringify(
    {
      displayName: "branch_search",
      golden: {
        turns: [
          {
            steps: [
              {
                expectation: {
                  toolCall: { tool: "location.searchBranches" },
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
  const issue = issues.find((i) => i.code === "CES_EVALUATION_TOOLCALL_OPENAPI_OPERATION");
  assert.ok(issue?.message.includes("location.searchBranches"));
});

test("namespaced OpenAPI operations are built in model", () => {
  const files = baseValidFixture();
  files["agents/location_services_agent/location_services_agent.json"] = JSON.stringify(
    {
      displayName: "location_services_agent",
      instruction: "agents/location_services_agent/instruction.txt",
      toolsets: [{ toolset: "location", toolIds: ["searchBranches"] }],
    },
    null,
    2,
  );

  const rootPath = createFixture(files);
  try {
    const model = buildPackageModel(rootPath);
    assert.equal(model.openApiNamespacedOperations.has("location.searchBranches"), true);
  } finally {
    cleanupFixture(rootPath);
  }
});

// ── Callback pythonCode validation tests ──────────────────────────────────

test("valid callback pythonCode passes", () => {
  const files = baseValidFixture();
  files["agents/voice_banking_agent/voice_banking_agent.json"] = JSON.stringify(
    {
      displayName: "voice_banking_agent",
      instruction: "agents/voice_banking_agent/instruction.txt",
      childAgents: ["location_services_agent"],
      afterAgentCallbacks: [
        {
          pythonCode: "agents/voice_banking_agent/after_agent_callbacks/after_agent_callbacks_01/python_code.py",
          description: "Track inactivity",
        },
      ],
    },
    null,
    2,
  );
  files["agents/voice_banking_agent/after_agent_callbacks/after_agent_callbacks_01/python_code.py"] = "def callback(): pass";

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_CALLBACK_CODE_MISSING"), false);
  assert.equal(hasCode(issues, "CES_CALLBACK_MISSING_CODE_PATH"), false);
});

test("missing callback pythonCode file is reported", () => {
  const files = baseValidFixture();
  files["agents/voice_banking_agent/voice_banking_agent.json"] = JSON.stringify(
    {
      displayName: "voice_banking_agent",
      instruction: "agents/voice_banking_agent/instruction.txt",
      childAgents: ["location_services_agent"],
      beforeModelCallbacks: [
        {
          pythonCode: "agents/voice_banking_agent/before_model_callbacks/missing.py",
          description: "Missing callback",
        },
      ],
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_CALLBACK_CODE_MISSING"), true);
});

test("callback without pythonCode path produces warning", () => {
  const files = baseValidFixture();
  files["agents/voice_banking_agent/voice_banking_agent.json"] = JSON.stringify(
    {
      displayName: "voice_banking_agent",
      instruction: "agents/voice_banking_agent/instruction.txt",
      childAgents: ["location_services_agent"],
      afterToolCallbacks: [
        {
          description: "No code path",
        },
      ],
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_CALLBACK_MISSING_CODE_PATH"), true);
});

// ── Agent tools[] existence tests ─────────────────────────────────────────

test("agent tool referencing existing Python function tool passes", () => {
  const files = baseValidFixture();
  files["agents/voice_banking_agent/voice_banking_agent.json"] = JSON.stringify(
    {
      displayName: "voice_banking_agent",
      instruction: "agents/voice_banking_agent/instruction.txt",
      childAgents: ["location_services_agent"],
      tools: ["greeting", "end_session"],
    },
    null,
    2,
  );
  files["tools/greeting/greeting.json"] = JSON.stringify(
    {
      displayName: "greeting",
      pythonFunction: { pythonCode: "tools/greeting/python_function/python_code.py" },
    },
    null,
    2,
  );
  files["tools/greeting/python_function/python_code.py"] = "def greeting(): pass";

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_AGENT_TOOL_NOT_FOUND"), false);
});

test("agent tool referencing Python tool displayName alias passes", () => {
  const files = baseValidFixture();
  files["agents/voice_banking_agent/voice_banking_agent.json"] = JSON.stringify(
    {
      displayName: "voice_banking_agent",
      instruction: "agents/voice_banking_agent/instruction.txt",
      childAgents: ["location_services_agent"],
      tools: ["friendly_greeting", "end_session"],
    },
    null,
    2,
  );
  files["tools/greeting/greeting.json"] = JSON.stringify(
    {
      displayName: "friendly_greeting",
      pythonFunction: { pythonCode: "tools/greeting/python_function/python_code.py" },
    },
    null,
    2,
  );
  files["tools/greeting/python_function/python_code.py"] = "def greeting(): pass";

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_AGENT_TOOL_NOT_FOUND"), false);
});

test("agent tool referencing built-in end_session passes", () => {
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

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_AGENT_TOOL_NOT_FOUND"), false);
});

test("agent tool referencing missing tool is reported", () => {
  const files = baseValidFixture();
  files["agents/voice_banking_agent/voice_banking_agent.json"] = JSON.stringify(
    {
      displayName: "voice_banking_agent",
      instruction: "agents/voice_banking_agent/instruction.txt",
      childAgents: ["location_services_agent"],
      tools: ["nonexistent_tool"],
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_AGENT_TOOL_NOT_FOUND"), true);
  const issue = issues.find((i) => i.code === "CES_AGENT_TOOL_NOT_FOUND");
  assert.ok(issue?.message.includes("nonexistent_tool"));
});

test("agent toolset referencing existing toolset displayName alias passes", () => {
  const files = baseValidFixture();
  files["agents/location_services_agent/location_services_agent.json"] = JSON.stringify(
    {
      displayName: "location_services_agent",
      instruction: "agents/location_services_agent/instruction.txt",
      toolsets: [{ toolset: "branch_locator", toolIds: ["searchBranches", "getBranch"] }],
    },
    null,
    2,
  );
  files["toolsets/location/location.json"] = JSON.stringify(
    {
      displayName: "branch_locator",
      toolIds: ["searchBranches", "getBranch"],
      openApiToolset: {
        openApiSchema: "toolsets/location/open_api_toolset/open_api_schema.yaml",
      },
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_AGENT_TOOLSET_REFERENCE_MISSING"), false);
});

// ── Environment.json toolset cross-reference tests ────────────────────────

test("environment.json toolset matching existing toolset passes", () => {
  const files = baseValidFixture();
  // default fixture already has environment.json with "location" -> toolsets/location
  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_ENVIRONMENT_TOOLSET_NOT_FOUND"), false);
});

test("environment.json toolset matching toolset displayName alias passes", () => {
  const files = baseValidFixture();
  files["toolsets/location/location.json"] = JSON.stringify(
    {
      displayName: "branch_locator",
      toolIds: ["searchBranches", "getBranch"],
      openApiToolset: {
        openApiSchema: "toolsets/location/open_api_toolset/open_api_schema.yaml",
      },
    },
    null,
    2,
  );
  files["environment.json"] = JSON.stringify(
    {
      toolsets: {
        branch_locator: {
          openApiToolset: {
            url: "https://api.example.com",
          },
        },
      },
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_ENVIRONMENT_TOOLSET_NOT_FOUND"), false);
});

test("environment.json toolset referencing missing toolset is reported", () => {
  const files = baseValidFixture();
  files["environment.json"] = JSON.stringify(
    {
      toolsets: {
        nonexistent_service: {
          openApiToolset: { url: "https://api.example.com" },
        },
      },
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_ENVIRONMENT_TOOLSET_NOT_FOUND"), true);
  const issue = issues.find((i) => i.code === "CES_ENVIRONMENT_TOOLSET_NOT_FOUND");
  assert.ok(issue?.message.includes("nonexistent_service"));
});

test("environment.json with only app section (no toolsets) passes", () => {
  const files = baseValidFixture();
  delete files["toolsets/location/location.json"];
  delete files["toolsets/location/open_api_toolset/open_api_schema.yaml"];
  files["agents/location_services_agent/location_services_agent.json"] = JSON.stringify(
    {
      displayName: "location_services_agent",
      instruction: "agents/location_services_agent/instruction.txt",
    },
    null,
    2,
  );
  files["environment.json"] = JSON.stringify(
    {
      app: {
        loggingSettings: {
          audioRecordingConfig: { gcsBucket: "gs://my-bucket" },
        },
      },
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_ENVIRONMENT_TOOLSETS_INVALID"), false);
  assert.equal(hasCode(issues, "CES_ENVIRONMENT_APP_INVALID"), false);
});

test("environment.json unknown top-level key produces warning", () => {
  const files = baseValidFixture();
  files["environment.json"] = JSON.stringify(
    {
      toolsets: {
        location: { openApiToolset: { url: "https://api.example.com" } },
      },
      unknownSection: { foo: "bar" },
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_ENVIRONMENT_UNKNOWN_KEY"), true);
  const issue = issues.find((i) => i.code === "CES_ENVIRONMENT_UNKNOWN_KEY");
  assert.ok(issue?.message.includes("unknownSection"));
});

test("environment.json invalid app section produces error", () => {
  const files = baseValidFixture();
  files["environment.json"] = JSON.stringify(
    {
      toolsets: {
        location: { openApiToolset: { url: "https://api.example.com" } },
      },
      app: "not_an_object",
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_ENVIRONMENT_APP_INVALID"), true);
});

test("environment.json invalid app.loggingSettings produces error", () => {
  const files = baseValidFixture();
  files["environment.json"] = JSON.stringify(
    {
      toolsets: {
        location: { openApiToolset: { url: "https://api.example.com" } },
      },
      app: { loggingSettings: "not_an_object" },
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_ENVIRONMENT_APP_LOGGING_INVALID"), true);
});

test("$env_var in agent manifest without environment.json produces error", () => {
  const files = baseValidFixture();
  delete files["environment.json"];
  files["agents/voice_banking_agent/voice_banking_agent.json"] = JSON.stringify(
    {
      displayName: "voice_banking_agent",
      instruction: "agents/voice_banking_agent/instruction.txt",
      childAgents: ["location_services_agent"],
      authConfig: { apiKey: "$env_var" },
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_ENV_VAR_NO_ENVIRONMENT"), true);
});

test("$env_var in agent manifest with environment.json present passes", () => {
  const files = baseValidFixture();
  files["agents/voice_banking_agent/voice_banking_agent.json"] = JSON.stringify(
    {
      displayName: "voice_banking_agent",
      instruction: "agents/voice_banking_agent/instruction.txt",
      childAgents: ["location_services_agent"],
      authConfig: { apiKey: "$env_var" },
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_ENV_VAR_NO_ENVIRONMENT"), false);

// ── $env_var placeholder validation tests ────────────────────────────────

test("$env_var placeholder in environment.json produces warning", () => {
  const files = baseValidFixture();
  files["environment.json"] = JSON.stringify(
    {
      toolsets: {
        location: {
          openApiToolset: {
            url: "$API_BASE_URL",
          },
        },
      },
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_ENV_VAR_PLACEHOLDER"), true);
  const issue = issues.find((i) => i.code === "CES_ENV_VAR_PLACEHOLDER");
  assert.ok(issue?.message.includes("$API_BASE_URL"));
});

test("$env_var placeholder in agent manifest produces warning", () => {
  const files = baseValidFixture();
  files["agents/voice_banking_agent/voice_banking_agent.json"] = JSON.stringify(
    {
      displayName: "voice_banking_agent",
      instruction: "agents/voice_banking_agent/instruction.txt",
      childAgents: ["location_services_agent"],
      someConfig: "$MY_SECRET_KEY",
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_ENV_VAR_PLACEHOLDER"), true);
  const issue = issues.find((i) => i.code === "CES_ENV_VAR_PLACEHOLDER");
  assert.ok(issue?.message.includes("$MY_SECRET_KEY"));
});

test("valid package fixture with no $env_var placeholders produces no placeholder warning", () => {
  const issues = runValidation(baseValidFixture());
  assert.equal(hasCode(issues, "CES_ENV_VAR_PLACEHOLDER"), false);
});

test("JSON Schema keywords like $ref and $schema are not flagged as env var placeholders", () => {
  const files = baseValidFixture();
  files["toolsets/location/location.json"] = JSON.stringify(
    {
      displayName: "location",
      openApiToolset: {
        openApiSchema: "toolsets/location/open_api_toolset/open_api_schema.yaml",
        $ref: "#/definitions/something",
        $schema: "http://json-schema.org/draft-07/schema",
      },
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_ENV_VAR_PLACEHOLDER"), false);
});

test("multiple $env_var placeholders in same file each produce a warning", () => {
  const files = baseValidFixture();
  files["environment.json"] = JSON.stringify(
    {
      toolsets: {
        location: {
          openApiToolset: {
            url: "$API_BASE_URL",
            apiKey: "$API_KEY",
          },
        },
      },
    },
    null,
    2,
  );

  const issues = runValidation(files);
  const placeholderIssues = issues.filter((i) => i.code === "CES_ENV_VAR_PLACEHOLDER");
  assert.ok(placeholderIssues.length >= 2);
  const messages = placeholderIssues.map((i) => i.message);
  assert.ok(messages.some((m) => m.includes("$API_BASE_URL")));
  assert.ok(messages.some((m) => m.includes("$API_KEY")));
});
});

test("valid app section in environment.json passes", () => {
  const files = baseValidFixture();
  files["environment.json"] = JSON.stringify(
    {
      toolsets: {
        location: { openApiToolset: { url: "https://api.example.com" } },
      },
      app: {
        loggingSettings: {
          audioRecordingConfig: { gcsBucket: "gs://my-bucket" },
          bigqueryExportSettings: { project: "my-project" },
        },
      },
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_ENVIRONMENT_APP_INVALID"), false);
  assert.equal(hasCode(issues, "CES_ENVIRONMENT_APP_LOGGING_INVALID"), false);
  assert.equal(hasCode(issues, "CES_ENVIRONMENT_UNKNOWN_KEY"), false);
});

// ── Evaluation agentResponse.role validation tests ────────────────────────

test("golden eval with valid agentResponse.role passes", () => {
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
  files["evaluations/greet_eval/greet_eval.json"] = JSON.stringify(
    {
      displayName: "greet_eval",
      golden: {
        turns: [
          {
            steps: [
              { userInput: { text: "hi" } },
              {
                expectation: {
                  agentResponse: {
                    role: "voice_banking_agent",
                    chunks: [{ text: "Hello!" }],
                  },
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
  assert.equal(hasCode(issues, "CES_EVALUATION_AGENT_ROLE_UNKNOWN"), false);
});

test("golden eval with unknown agentResponse.role produces warning", () => {
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
  files["evaluations/bad_role/bad_role.json"] = JSON.stringify(
    {
      displayName: "bad_role",
      golden: {
        turns: [
          {
            steps: [
              { userInput: { text: "hi" } },
              {
                expectation: {
                  agentResponse: {
                    role: "agent",
                    chunks: [{ text: "Hello!" }],
                  },
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
  assert.equal(hasCode(issues, "CES_EVALUATION_AGENT_ROLE_UNKNOWN"), true);
  const issue = issues.find((i) => i.code === "CES_EVALUATION_AGENT_ROLE_UNKNOWN");
  assert.ok(issue?.message.includes("agent"));
});

// ── Scenario evaluation tool reference tests ──────────────────────────────

test("scenario eval with valid expectedToolCall passes", () => {
  const files = baseValidFixture();
  files["agents/voice_banking_agent/voice_banking_agent.json"] = JSON.stringify(
    {
      displayName: "voice_banking_agent",
      instruction: "agents/voice_banking_agent/instruction.txt",
      childAgents: ["location_services_agent"],
      tools: ["end_session", "update_cart"],
    },
    null,
    2,
  );
  files["tools/update_cart/update_cart.json"] = JSON.stringify(
    {
      displayName: "update_cart",
      pythonFunction: { pythonCode: "tools/update_cart/python_function/python_code.py" },
    },
    null,
    2,
  );
  files["tools/update_cart/python_function/python_code.py"] = "def update_cart(): pass";
  files["evaluations/cart_test/cart_test.json"] = JSON.stringify(
    {
      displayName: "cart_test",
      scenario: {
        task: "Test cart update",
        scenarioExpectations: [
          {
            toolExpectation: {
              expectedToolCall: { tool: "update_cart" },
            },
          },
        ],
      },
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_EVALUATION_SCENARIO_TOOL_UNKNOWN"), false);
});

test("scenario eval with unknown expectedToolCall is reported", () => {
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
  files["evaluations/bad_scenario/bad_scenario.json"] = JSON.stringify(
    {
      displayName: "bad_scenario",
      scenario: {
        task: "Test unknown tool",
        scenarioExpectations: [
          {
            toolExpectation: {
              expectedToolCall: { tool: "totally_fake_tool" },
            },
          },
        ],
      },
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_EVALUATION_SCENARIO_TOOL_UNKNOWN"), true);
});

test("scenario eval with unknown mockToolResponse is reported", () => {
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
  files["evaluations/bad_mock/bad_mock.json"] = JSON.stringify(
    {
      displayName: "bad_mock",
      scenario: {
        task: "Test mock response",
        scenarioExpectations: [
          {
            toolExpectation: {
              expectedToolCall: { tool: "end_session" },
              mockToolResponse: { tool: "ghost_tool", response: {} },
            },
          },
        ],
      },
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_EVALUATION_SCENARIO_MOCK_TOOL_UNKNOWN"), true);
});

// ── Google Search Tool validation tests ───────────────────────────────────

test("googleSearchTool with dataStoreId passes validation", () => {
  const files = baseValidFixture();
  files["agents/voice_banking_agent/voice_banking_agent.json"] = JSON.stringify(
    {
      displayName: "voice_banking_agent",
      instruction: "agents/voice_banking_agent/instruction.txt",
      childAgents: ["location_services_agent"],
      tools: ["end_session", "fee_schedule_lookup"],
    },
    null,
    2,
  );
  files["tools/fee_schedule_lookup/fee_schedule_lookup.json"] = JSON.stringify(
    {
      googleSearchTool: {
        name: "fee_schedule_lookup",
        description: "Searches fee schedule",
        dataStoreId: "projects/my-project/locations/global/collections/default_collection/dataStores/my-store-123",
      },
      displayName: "fee_schedule_lookup",
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_GOOGLE_SEARCH_TOOL_MISSING_SOURCE"), false);
  assert.equal(hasCode(issues, "CES_GOOGLE_SEARCH_TOOL_DATASTORE_FORMAT"), false);
  assert.equal(hasCode(issues, "CES_PYTHON_TOOL_MISSING_FUNCTION"), false);
});

test("googleSearchTool with contextUrls passes validation", () => {
  const files = baseValidFixture();
  files["tools/fee_lookup/fee_lookup.json"] = JSON.stringify(
    {
      googleSearchTool: {
        name: "fee_lookup",
        description: "Searches fees",
        contextUrls: ["https://example.com/fees.pdf"],
      },
      displayName: "fee_lookup",
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_GOOGLE_SEARCH_TOOL_MISSING_SOURCE"), false);
  assert.equal(hasCode(issues, "CES_PYTHON_TOOL_MISSING_FUNCTION"), false);
});

test("googleSearchTool with no contextUrls or dataStoreId produces error", () => {
  const files = baseValidFixture();
  files["tools/fee_lookup/fee_lookup.json"] = JSON.stringify(
    {
      googleSearchTool: {
        name: "fee_lookup",
        description: "Searches fees",
      },
      displayName: "fee_lookup",
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_GOOGLE_SEARCH_TOOL_MISSING_SOURCE"), true);
});

test("googleSearchTool with both contextUrls and dataStoreId produces warning", () => {
  const files = baseValidFixture();
  files["tools/fee_lookup/fee_lookup.json"] = JSON.stringify(
    {
      googleSearchTool: {
        name: "fee_lookup",
        description: "Searches fees",
        contextUrls: ["https://example.com/fees.pdf"],
        dataStoreId: "projects/my-project/locations/global/collections/default_collection/dataStores/store-1",
      },
      displayName: "fee_lookup",
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_GOOGLE_SEARCH_TOOL_DUAL_SOURCE"), true);
});

test("googleSearchTool with invalid dataStoreId format produces warning", () => {
  const files = baseValidFixture();
  files["tools/fee_lookup/fee_lookup.json"] = JSON.stringify(
    {
      googleSearchTool: {
        name: "fee_lookup",
        description: "Searches fees",
        dataStoreId: "bad-format-store-id",
      },
      displayName: "fee_lookup",
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_GOOGLE_SEARCH_TOOL_DATASTORE_FORMAT"), true);
});

test("googleSearchTool with empty contextUrls entry produces error", () => {
  const files = baseValidFixture();
  files["tools/fee_lookup/fee_lookup.json"] = JSON.stringify(
    {
      googleSearchTool: {
        name: "fee_lookup",
        description: "Searches fees",
        contextUrls: ["https://example.com/fees.pdf", ""],
      },
      displayName: "fee_lookup",
    },
    null,
    2,
  );

  const issues = runValidation(files);
  assert.equal(hasCode(issues, "CES_GOOGLE_SEARCH_TOOL_INVALID_URL"), true);
});

test("googleSearchToolNames are tracked in package model", () => {
  const files = baseValidFixture();
  files["tools/fee_lookup/fee_lookup.json"] = JSON.stringify(
    {
      googleSearchTool: {
        name: "fee_lookup",
        description: "Searches fees",
        dataStoreId: "projects/p/locations/l/collections/c/dataStores/d",
      },
      displayName: "fee_lookup",
    },
    null,
    2,
  );

  const rootPath = createFixture(files);
  try {
    const model = buildPackageModel(rootPath);
    assert.equal(model.googleSearchToolNames.has("fee_lookup"), true);
  } finally {
    cleanupFixture(rootPath);
  }
});

test("L-01: golden eval toolCall referencing googleSearchTool is an error", () => {
  const files = baseValidFixture();
  files["agents/voice_banking_agent/voice_banking_agent.json"] = JSON.stringify(
    {
      displayName: "voice_banking_agent",
      instruction: "agents/voice_banking_agent/instruction.txt",
      childAgents: ["location_services_agent"],
      tools: ["end_session", "fee_lookup"],
    },
    null,
    2,
  );
  files["tools/fee_lookup/fee_lookup.json"] = JSON.stringify(
    {
      googleSearchTool: {
        name: "fee_lookup",
        description: "Searches fees",
        dataStoreId: "projects/p/locations/l/collections/c/dataStores/d",
      },
      displayName: "fee_lookup",
    },
    null,
    2,
  );
  files["evaluations/fee_test/fee_test.json"] = JSON.stringify(
    {
      displayName: "fee_test",
      golden: {
        turns: [
          {
            steps: [
              {
                expectation: {
                  toolCall: { tool: "fee_lookup" },
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
  assert.equal(hasCode(issues, "CES_EVALUATION_TOOLCALL_GOOGLE_SEARCH"), true);
});

test("golden eval with agentResponse for googleSearchTool passes (no L-01 error)", () => {
  const files = baseValidFixture();
  files["agents/voice_banking_agent/voice_banking_agent.json"] = JSON.stringify(
    {
      displayName: "voice_banking_agent",
      instruction: "agents/voice_banking_agent/instruction.txt",
      childAgents: ["location_services_agent"],
      tools: ["end_session", "fee_lookup"],
    },
    null,
    2,
  );
  files["tools/fee_lookup/fee_lookup.json"] = JSON.stringify(
    {
      googleSearchTool: {
        name: "fee_lookup",
        description: "Searches fees",
        dataStoreId: "projects/p/locations/l/collections/c/dataStores/d",
      },
      displayName: "fee_lookup",
    },
    null,
    2,
  );
  files["evaluations/fee_test/fee_test.json"] = JSON.stringify(
    {
      displayName: "fee_test",
      golden: {
        turns: [
          {
            steps: [
              {
                expectation: {
                  agentResponse: {
                    role: "voice_banking_agent",
                    chunks: [{ text: "The fee is 5 EUR" }],
                  },
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
  assert.equal(hasCode(issues, "CES_EVALUATION_TOOLCALL_GOOGLE_SEARCH"), false);
  assert.equal(hasCode(issues, "CES_EVALUATION_TOOLCALL_UNKNOWN"), false);
});
