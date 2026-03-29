/*
 * Created by Augment Agent on 2026-03-28.
 * Tests for incremental CES deployment planning and local state artifacts.
 */

import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import test from "node:test";
import {
  applyPreparedIncrementalDeployment,
  discoverDeployableComponents,
  finalizePreparedIncrementalDeployment,
  getDeploymentStoragePaths,
  loadDeploymentStatusSummary,
  prepareIncrementalDeployment,
  reconcileNoopComponentsWithRemote,
} from "../core/incrementalDeployment";
import { cleanupFixture, createFixture } from "./helpers";

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

function fullAgentInstructionFixture(summary = "Handle the request."): string {
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
    `            <action>${summary}</action>`,
    "        </step>",
    "    </subtask>",
    "</taskflow>",
  ].join("\n");
}

function incrementalFixture(): Record<string, string> {
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
        tools: ["customer_lookup"],
        toolsets: [{ toolset: "account_api", toolIds: ["listAccounts"] }],
      },
      null,
      2,
    ),
    "agents/voice_banking_agent/instruction.txt": fullAgentInstructionFixture(),
    "tools/customer_lookup/customer_lookup.json": JSON.stringify(
      {
        displayName: "customer_lookup",
        executionType: "SERVER",
        pythonFunction: {
          name: "customer_lookup",
          pythonCode: "tools/customer_lookup/python_code.py",
        },
      },
      null,
      2,
    ),
    "tools/customer_lookup/python_code.py": "def customer_lookup():\n    return {'ok': True}\n",
    "toolsets/account_api/account_api.json": JSON.stringify(
      {
        displayName: "account_api",
        description: "Account REST API",
        openApiToolset: {
          openApiSchema: "toolsets/account_api/openapi.json",
        },
      },
      null,
      2,
    ),
    "toolsets/account_api/openapi.json": JSON.stringify(
      {
        openapi: "3.0.0",
        info: { title: "Accounts API", version: "1.0.0" },
        paths: {
          "/accounts": {
            get: {
              operationId: "listAccounts",
              responses: { "200": { description: "OK" } },
            },
          },
        },
      },
      null,
      2,
    ),
  };
}

function writeStateFromComponents(rootPath: string): void {
  const storage = getDeploymentStoragePaths(rootPath);
  const components = discoverDeployableComponents(rootPath);
  const componentEntries = Object.fromEntries(
    components.map((component) => [
      component.key,
      {
        kind: component.kind,
        resource_id: component.resourceId,
        display_name: component.displayName,
        source_path: component.sourcePath,
        tracked_files: Object.entries(component.fileHashes).map(([trackedPath, sha256]) => ({ path: trackedPath, sha256 })),
        combined_sha256: component.combinedHash,
        deployed_at: "2026-03-28T00:00:00.000Z",
        resource_name: `projects/test-project/locations/us/apps/demo-app/${component.kind === "agent" ? "agents" : component.kind === "tool" ? "tools" : "toolsets"}/${component.resourceId}`,
      },
    ]),
  );

  componentEntries["tool:legacy_tool"] = {
    kind: "tool",
    resource_id: "legacy_tool",
    display_name: "legacy_tool",
    source_path: path.join(rootPath, "tools/legacy_tool/legacy_tool.json"),
    tracked_files: [],
    combined_sha256: "legacy",
    deployed_at: "2026-03-27T00:00:00.000Z",
    resource_name: "projects/test-project/locations/us/apps/demo-app/tools/legacy_tool",
  };

  fs.mkdirSync(path.dirname(storage.stateFile), { recursive: true });
  fs.writeFileSync(storage.stateFile, `${JSON.stringify({ schema_version: 1, components: componentEntries }, null, 2)}\n`, "utf8");
}

test("discoverDeployableComponents tracks manifests, code, and instruction files in dependency order", () => {
  const rootPath = createFixture(incrementalFixture());

  try {
    const components = discoverDeployableComponents(rootPath);
    assert.deepEqual(components.map((component) => component.key), [
      "toolset:account_api",
      "tool:customer_lookup",
      "agent:voice_banking_agent",
    ]);

    const toolset = components[0];
    const tool = components[1];
    const agent = components[2];
    assert.equal(toolset?.trackedFiles.some((filePath) => filePath.endsWith("toolsets/account_api/openapi.json")), true);
    assert.equal(tool?.trackedFiles.some((filePath) => filePath.endsWith("tools/customer_lookup/python_code.py")), true);
    assert.equal(agent?.trackedFiles.some((filePath) => filePath.endsWith("agents/voice_banking_agent/instruction.txt")), true);
  } finally {
    cleanupFixture(rootPath);
  }
});

test("prepareIncrementalDeployment classifies modified, noop, and removed components and writes an artifact", async () => {
  const rootPath = createFixture(incrementalFixture());

  try {
    writeStateFromComponents(rootPath);
    fs.writeFileSync(
      path.join(rootPath, "agents/voice_banking_agent/instruction.txt"),
      fullAgentInstructionFixture("Handle the updated request."),
      "utf8",
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/toolsets/account_api")) {
        return new Response(JSON.stringify({ name: "projects/test/toolsets/account_api" }), { status: 200 });
      }
      if (url.includes("/tools/customer_lookup")) {
        return new Response(JSON.stringify({ name: "projects/test/tools/customer_lookup" }), { status: 200 });
      }
      if (url.includes("/agents/voice_banking_agent")) {
        return new Response(JSON.stringify({ name: "projects/test/agents/voice_banking_agent" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    try {
      const prepared = await prepareIncrementalDeployment(rootPath, {
        projectId: "test-project",
        location: "us",
        appId: "demo-app",
      });

      assert.equal(prepared.plan.summary.added, 0);
      assert.equal(prepared.plan.summary.modified, 1);
      assert.equal(prepared.plan.summary.noop, 2);
      assert.equal(prepared.plan.summary.removed, 1);
      assert.equal(prepared.plan.summary.actionable, 1);
      assert.deepEqual(prepared.plan.modified.map((component) => component.key), ["agent:voice_banking_agent"]);
      assert.equal(fs.existsSync(prepared.artifactPath), true);

      finalizePreparedIncrementalDeployment(prepared, "cancelled", "User cancelled deployment.");
      const status = loadDeploymentStatusSummary(rootPath);
      assert.equal(status.latestRun?.status, "cancelled");
      assert.equal(status.latestRun?.message, "User cancelled deployment.");
      assert.equal(status.latestPlan?.summary.modified, 1);
      assert.equal(status.latestPlan?.summary.removed, 1);
      assert.deepEqual(status.latestPlan?.components.map((component) => component.plan_status), [
        "noop",
        "noop",
        "modified",
        "removed",
      ]);
      assert.equal(status.components.length, 4);
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    cleanupFixture(rootPath);
  }
});

test("reconcileNoopComponentsWithRemote reclassifies missing remote resources as added", async () => {
  const rootPath = createFixture(incrementalFixture());

  try {
    writeStateFromComponents(rootPath);
    const components = discoverDeployableComponents(rootPath);
    const storage = getDeploymentStoragePaths(rootPath);
    const state = JSON.parse(fs.readFileSync(storage.stateFile, "utf8")) as { components: Record<string, unknown> };
    const plan = {
      added: [],
      modified: [],
      noop: components,
      removed: [],
      actionable: [],
      summary: { added: 0, modified: 0, noop: components.length, removed: 0, actionable: 0 },
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/toolsets/account_api")) {
        return new Response(JSON.stringify({ name: "projects/test/toolsets/account_api" }), { status: 200 });
      }
      if (url.includes("/tools/customer_lookup")) {
        return new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 });
      }
      if (url.includes("/apps/demo-app/tools")) {
        return new Response(JSON.stringify({ tools: [] }), { status: 200 });
      }
      if (url.includes("/agents/voice_banking_agent")) {
        return new Response(JSON.stringify({ name: "projects/test/agents/voice_banking_agent" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    try {
      const reconciled = await reconcileNoopComponentsWithRemote(
        rootPath,
        { projectId: "test-project", location: "us", appId: "demo-app" },
        state.components as never,
        plan,
        "token",
      );

      assert.deepEqual(reconciled.staleComponents.map((component) => component.key), ["tool:customer_lookup"]);
      assert.deepEqual(reconciled.plan.added.map((component) => component.key), ["tool:customer_lookup"]);
      assert.deepEqual(reconciled.plan.noop.map((component) => component.key), ["toolset:account_api", "agent:voice_banking_agent"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    cleanupFixture(rootPath);
  }
});

test("applyPreparedIncrementalDeployment returns noop after remote reconciliation confirms no actionable changes", async () => {
  const rootPath = createFixture(incrementalFixture());

  try {
    writeStateFromComponents(rootPath);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ name: "projects/test/existing" }), { status: 200 })) as typeof fetch;

    try {
      const prepared = await prepareIncrementalDeployment(rootPath, {
        projectId: "test-project",
        location: "us",
        appId: "demo-app",
      });

      const result = await applyPreparedIncrementalDeployment(prepared);
      assert.equal(result.status, "noop");
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    cleanupFixture(rootPath);
  }
});
