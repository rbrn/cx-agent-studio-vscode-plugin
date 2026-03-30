/*
 * Created by GitHub Copilot on 2026-03-30.
 * Tests for project-root .env-backed deployment defaults.
 */

import { strict as assert } from "assert";
import * as path from "path";
import test from "node:test";
import { loadDeploymentEnvDefaults, parseDotEnv } from "../core/envDefaults";
import { cleanupFixture, createFixture } from "./helpers";

test("parseDotEnv ignores comments and preserves key value pairs", () => {
  const values = parseDotEnv([
    "# comment",
    "GCP_PROJECT_ID=voice-banking-poc",
    "GCP_LOCATION='EU'",
    "CES_APP_ID=demo-app",
    "",
  ].join("\n"));

  assert.deepEqual(values, {
    GCP_PROJECT_ID: "voice-banking-poc",
    GCP_LOCATION: "EU",
    CES_APP_ID: "demo-app",
  });
});

test("loadDeploymentEnvDefaults reads defaults from the workspace root .env", () => {
  const workspaceRoot = createFixture({
    ".env": [
      "GCP_PROJECT_ID=voice-banking-poc",
      "GCP_LOCATION=eu",
      "CES_APP_ID=e88e13e5-14d0-4f87-93cd-0ee92ec318eb",
    ].join("\n"),
    "packages/sample-agent/app.yaml": "displayName: sample_agent\n",
  });

  try {
    const packageRoot = path.join(workspaceRoot, "packages/sample-agent");
    const defaults = loadDeploymentEnvDefaults(packageRoot, workspaceRoot);
    assert.deepEqual(defaults, {
      projectId: "voice-banking-poc",
      location: "eu",
      appId: "e88e13e5-14d0-4f87-93cd-0ee92ec318eb",
    });
  } finally {
    cleanupFixture(workspaceRoot);
  }
});

test("loadDeploymentEnvDefaults falls back to searching parent directories for .env", () => {
  const workspaceRoot = createFixture({
    ".env": [
      "GCP_PROJECT_ID=voice-banking-poc",
      "GCP_LOCATION=EU",
    ].join("\n"),
    "packages/sample-agent/app.yaml": "displayName: sample_agent\n",
  });

  try {
    const packageRoot = path.join(workspaceRoot, "packages/sample-agent");
    const defaults = loadDeploymentEnvDefaults(packageRoot);
    assert.deepEqual(defaults, {
      projectId: "voice-banking-poc",
      location: "eu",
      appId: undefined,
    });
  } finally {
    cleanupFixture(workspaceRoot);
  }
});
