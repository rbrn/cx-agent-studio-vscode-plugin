/*
 * Created by Augment Agent on 2026-03-28.
 * Native incremental CES deployment planning, state tracking, and run artifacts.
 */

import * as crypto from "crypto";
import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { DeploymentValidationError } from "./deployment";
import { buildPackageModel } from "./packageIndex";
import { normalizeSeparators } from "./pathUtils";
import { runRules } from "./rules";

const SCHEMA_VERSION = 1;
const KIND_ORDER: Record<DeployableComponentKind, number> = { toolset: 0, tool: 1, agent: 2 };
const CALLBACK_FIELDS = [
  "beforeAgentCallbacks",
  "beforeModelCallbacks",
  "beforeToolCallbacks",
  "afterAgentCallbacks",
  "afterModelCallbacks",
  "afterToolCallbacks",
] as const;
const AGENT_ALLOWED_UPDATE_FIELDS = [
  "displayName",
  "description",
  "instruction",
  "modelSettings",
  "tools",
  "toolsets",
  "childAgents",
  "beforeAgentCallbacks",
  "beforeModelCallbacks",
  "beforeToolCallbacks",
  "afterAgentCallbacks",
  "afterModelCallbacks",
  "afterToolCallbacks",
  "guardrails",
  "transferRules",
] as const;
const TOOL_ALLOWED_UPDATE_FIELDS = [
  "agentTool",
  "clientFunction",
  "connectorTool",
  "dataStoreTool",
  "executionType",
  "fileSearchTool",
  "googleSearchTool",
  "openApiTool",
  "pythonFunction",
  "widgetTool",
] as const;
const TOOLSET_ALLOWED_UPDATE_FIELDS = ["displayName", "description", "openApiToolset"] as const;

export type DeployableComponentKind = "toolset" | "tool" | "agent";
export type DeploymentPlanStatus = "added" | "modified" | "noop" | "removed";
export type DeploymentRunStatus = "planned" | "success" | "failed" | "noop" | "cancelled";

export interface IncrementalCesTargetOptions {
  projectId: string;
  location: string;
  appId: string;
  endpoint?: string;
}

export interface DeploymentStoragePaths {
  baseDir: string;
  stateFile: string;
  artifactsDir: string;
}

export interface DeployableComponent {
  key: string;
  kind: DeployableComponentKind;
  resourceId: string;
  displayName: string;
  sourcePath: string;
  trackedFiles: string[];
  fileHashes: Record<string, string>;
  combinedHash: string;
}

export interface DeploymentPlanSummary {
  added: number;
  modified: number;
  noop: number;
  removed: number;
  actionable: number;
}

export interface IncrementalDeploymentPlan {
  added: DeployableComponent[];
  modified: DeployableComponent[];
  noop: DeployableComponent[];
  removed: string[];
  actionable: DeployableComponent[];
  summary: DeploymentPlanSummary;
}

export interface DeploymentTrackedFile {
  path: string;
  sha256: string;
}

export interface DeploymentStateEntry {
  kind: DeployableComponentKind;
  resource_id: string;
  display_name: string;
  source_path: string;
  tracked_files: DeploymentTrackedFile[];
  combined_sha256: string;
  deployed_at: string;
  resource_name: string;
  remote_update_time?: string;
  remote_create_time?: string;
}

interface DeploymentState {
  schema_version: number;
  app_root?: string;
  project?: string;
  location?: string;
  app_id?: string;
  components: Record<string, DeploymentStateEntry>;
}

export interface DeploymentRunComponentEntry {
  key: string;
  kind: DeployableComponentKind | null;
  resource_id: string | null;
  display_name: string | null;
  source_path: string | null;
  tracked_files: DeploymentTrackedFile[];
  plan_status: DeploymentPlanStatus;
  before_combined_sha256: string | null;
  after_combined_sha256: string | null;
  before_resource_name: string | null;
  after_resource_name: string | null;
  before_remote_update_time: string | null;
  after_remote_update_time: string | null;
  before_remote_create_time: string | null;
  after_remote_create_time: string | null;
  operation: string;
  execution_status: string;
  http_status: number | null;
  state_updated: boolean;
  deployed_at: string | null;
  error: string | null;
}

interface DeploymentRunArtifact {
  run_id: string;
  started_at: string;
  completed_at: string | null;
  status: DeploymentRunStatus;
  mode: {
    validate_only: boolean;
    auto_confirm: boolean;
  };
  target: {
    project: string;
    location: string;
    app_id: string;
    app_root: string;
    state_file: string;
    artifacts_dir: string;
    endpoint: string | null;
  };
  git: {
    commit_sha: string | null;
  };
  plan: {
    summary: DeploymentPlanSummary;
    components: DeploymentRunComponentEntry[];
  };
  outcome: {
    message: string | null;
    summary: Record<string, number>;
  };
}

export interface PreparedIncrementalDeployment {
  rootPath: string;
  target: IncrementalCesTargetOptions;
  storage: DeploymentStoragePaths;
  runId: string;
  gitCommitSha: string | null;
  state: DeploymentState;
  plan: IncrementalDeploymentPlan;
  artifact: DeploymentRunArtifact;
  artifactPath: string;
}

export interface AppliedIncrementalDeploymentResult {
  status: DeploymentRunStatus;
  artifactPath: string;
  stateFile: string;
  appliedCount: number;
}

export interface DeploymentStatusSummary {
  rootPath: string;
  stateFile: string;
  artifactsDir: string;
  project?: string;
  location?: string;
  appId?: string;
  latestArtifactPath: string | null;
  latestRun: {
    runId: string;
    status: DeploymentRunStatus;
    startedAt: string | null;
    completedAt: string | null;
    gitCommitSha: string | null;
    message: string | null;
  } | null;
  latestPlan: {
    summary: DeploymentPlanSummary;
    components: DeploymentRunComponentEntry[];
  } | null;
  components: Array<{
    key: string;
    kind: DeployableComponentKind;
    resourceId: string;
    displayName: string;
    deployedAt: string;
    resourceName: string;
    remoteUpdateTime?: string;
  }>;
}

interface DeploymentRequest {
  kind: DeployableComponentKind;
  resourceName: string;
  displayName: string;
  collectionUrl: string;
  resourceUrl: string;
  createQuery: string;
  updateMask: string;
  payload: Record<string, unknown>;
}

export function getDeploymentStoragePaths(rootPath: string): DeploymentStoragePaths {
  const baseDir = path.join(rootPath, ".ces-validator");
  return {
    baseDir,
    stateFile: path.join(baseDir, "deploy-state.json"),
    artifactsDir: path.join(baseDir, "artifacts"),
  };
}

export function discoverDeployableComponents(rootPath: string): DeployableComponent[] {
  const toolsets = discoverToolsets(rootPath);
  const tools = discoverTools(rootPath);
  const agents = discoverAgents(rootPath);
  return [...toolsets, ...tools, ...agents].sort((left, right) => {
    const kindDelta = KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
    return kindDelta !== 0 ? kindDelta : left.resourceId.localeCompare(right.resourceId);
  });
}

export async function prepareIncrementalDeployment(
  rootPath: string,
  target: IncrementalCesTargetOptions,
): Promise<PreparedIncrementalDeployment> {
  validateForIncrementalDeployment(rootPath);

  const storage = getDeploymentStoragePaths(rootPath);
  const state = loadDeploymentState(storage.stateFile);
  const components = discoverDeployableComponents(rootPath);
  const plan = buildIncrementalPlan(components, state.components);
  const runId = buildRunId();
  const artifactPath = path.join(storage.artifactsDir, `${runId}.json`);
  const gitCommitSha = await getGitCommitSha(rootPath);
  const artifact = buildRunArtifact({
    runId,
    rootPath,
    target,
    storage,
    gitCommitSha,
    components,
    stateComponents: state.components,
    plan,
  });

  writeJsonFile(artifactPath, artifact);

  return {
    rootPath,
    target,
    storage,
    runId,
    gitCommitSha,
    state,
    plan,
    artifact,
    artifactPath,
  };
}

export function finalizePreparedIncrementalDeployment(
  prepared: PreparedIncrementalDeployment,
  status: DeploymentRunStatus,
  message: string,
): void {
  finalizeArtifact(prepared.artifact, status, message);
  writeJsonFile(prepared.artifactPath, prepared.artifact);
}

export async function applyPreparedIncrementalDeployment(
  prepared: PreparedIncrementalDeployment,
  onProgress?: (component: DeployableComponent, index: number, total: number) => void,
): Promise<AppliedIncrementalDeploymentResult> {
  if (prepared.plan.actionable.length === 0) {
    finalizePreparedIncrementalDeployment(prepared, "noop", "Everything is up to date.");
    return {
      status: "noop",
      artifactPath: prepared.artifactPath,
      stateFile: prepared.storage.stateFile,
      appliedCount: 0,
    };
  }

  const token = await getAccessToken();
  prepared.state.schema_version = SCHEMA_VERSION;
  prepared.state.app_root = prepared.rootPath;
  prepared.state.project = prepared.target.projectId;
  prepared.state.location = prepared.target.location;
  prepared.state.app_id = prepared.target.appId;

  for (const [index, component] of prepared.plan.actionable.entries()) {
    onProgress?.(component, index + 1, prepared.plan.actionable.length);
    const request = buildDeploymentRequest(component, prepared.rootPath, prepared.target, prepared.state.components);
    const artifactEntry = getArtifactEntry(prepared.artifact, component.key);
    const existingResourceName = await findExistingResourceName(request, token);
    artifactEntry.operation = existingResourceName ? "patch" : "create";
    if (existingResourceName) {
      artifactEntry.before_resource_name = existingResourceName;
    }

    const response = await applyRequest(request, token, existingResourceName);
    artifactEntry.http_status = response.status;

    if (response.status >= 200 && response.status < 300) {
      const metadata = remoteMetadataFromBody(response.body);
      const resourceName = metadata.name ?? existingResourceName ?? request.resourceName;
      prepared.state.components[component.key] = buildStateEntry(component, resourceName, metadata.updateTime, metadata.createTime);
      writeJsonFile(prepared.storage.stateFile, prepared.state);

      artifactEntry.execution_status = "success";
      artifactEntry.state_updated = true;
      artifactEntry.deployed_at = timestampNow();
      artifactEntry.after_resource_name = resourceName;
      artifactEntry.after_remote_update_time = metadata.updateTime ?? null;
      artifactEntry.after_remote_create_time = metadata.createTime ?? null;
      artifactEntry.error = null;
      updateOutcomeSummary(prepared.artifact);
      writeJsonFile(prepared.artifactPath, prepared.artifact);
      continue;
    }

    artifactEntry.execution_status = "failed";
    artifactEntry.state_updated = false;
    artifactEntry.deployed_at = timestampNow();
    artifactEntry.error = response.body || `HTTP ${response.status}`;
    finalizeArtifact(
      prepared.artifact,
      "failed",
      `Deployment failed for ${component.key} with HTTP ${response.status}.`,
    );
    writeJsonFile(prepared.artifactPath, prepared.artifact);
    throw new Error(response.body || `CES deployment failed with HTTP ${response.status}.`);
  }

  finalizePreparedIncrementalDeployment(
    prepared,
    "success",
    `Applied ${prepared.plan.actionable.length} incremental CES resource change(s).`,
  );
  return {
    status: "success",
    artifactPath: prepared.artifactPath,
    stateFile: prepared.storage.stateFile,
    appliedCount: prepared.plan.actionable.length,
  };
}

export function loadDeploymentStatusSummary(rootPath: string): DeploymentStatusSummary {
  const storage = getDeploymentStoragePaths(rootPath);
  const state = loadDeploymentState(storage.stateFile);
  const latestArtifactPath = getLatestArtifactPath(storage.artifactsDir);
  const latestArtifact = latestArtifactPath ? readJsonFile<DeploymentRunArtifact>(latestArtifactPath) : null;
  const components = Object.entries(state.components)
    .map(([key, entry]) => ({
      key,
      kind: entry.kind,
      resourceId: entry.resource_id,
      displayName: entry.display_name,
      deployedAt: entry.deployed_at,
      resourceName: entry.resource_name,
      remoteUpdateTime: entry.remote_update_time,
    }))
    .sort((left, right) => {
      const kindDelta = KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
      return kindDelta !== 0 ? kindDelta : left.resourceId.localeCompare(right.resourceId);
    });

  return {
    rootPath,
    stateFile: storage.stateFile,
    artifactsDir: storage.artifactsDir,
    project: state.project,
    location: state.location,
    appId: state.app_id,
    latestArtifactPath,
    latestRun: latestArtifact
      ? {
          runId: latestArtifact.run_id,
          status: latestArtifact.status,
          startedAt: latestArtifact.started_at,
          completedAt: latestArtifact.completed_at,
          gitCommitSha: latestArtifact.git.commit_sha,
          message: latestArtifact.outcome.message,
        }
      : null,
    latestPlan: latestArtifact
      ? {
          summary: latestArtifact.plan.summary,
          components: latestArtifact.plan.components,
        }
      : null,
    components,
  };
}

function validateForIncrementalDeployment(rootPath: string): void {
  const model = buildPackageModel(rootPath);
  const issues = runRules(model);
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new DeploymentValidationError(
      `Cannot push '${path.basename(rootPath)}' because ${errors.length} validation error(s) must be fixed first.`,
      issues,
    );
  }
}

function discoverTools(rootPath: string): DeployableComponent[] {
  const toolsRoot = path.join(rootPath, "tools");
  if (!fs.existsSync(toolsRoot)) {
    return [];
  }

  const components: DeployableComponent[] = [];
  for (const entry of fs.readdirSync(toolsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const manifestPath = path.join(toolsRoot, entry.name, `${entry.name}.json`);
    if (!fs.existsSync(manifestPath)) {
      continue;
    }

    const manifest = readJsonObject(manifestPath);
    const trackedFiles = [manifestPath];
    const pythonFunction = manifest.pythonFunction;
    if (isRecord(pythonFunction) && typeof pythonFunction.pythonCode === "string" && pythonFunction.pythonCode.trim().length > 0) {
      trackedFiles.push(resolveTrackedFile(rootPath, pythonFunction.pythonCode));
    }

    components.push(createComponent(rootPath, "tool", entry.name, manifest, trackedFiles));
  }

  return components;
}

function discoverToolsets(rootPath: string): DeployableComponent[] {
  const toolsetsRoot = path.join(rootPath, "toolsets");
  if (!fs.existsSync(toolsetsRoot)) {
    return [];
  }

  const components: DeployableComponent[] = [];
  for (const entry of fs.readdirSync(toolsetsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const manifestPath = path.join(toolsetsRoot, entry.name, `${entry.name}.json`);
    if (!fs.existsSync(manifestPath)) {
      continue;
    }

    const manifest = readJsonObject(manifestPath);
    const trackedFiles = [manifestPath];
    const openApiToolset = manifest.openApiToolset;
    if (isRecord(openApiToolset) && typeof openApiToolset.openApiSchema === "string" && openApiToolset.openApiSchema.trim().length > 0) {
      trackedFiles.push(resolveTrackedFile(rootPath, openApiToolset.openApiSchema));
    }

    components.push(createComponent(rootPath, "toolset", entry.name, manifest, trackedFiles));
  }

  return components;
}

function discoverAgents(rootPath: string): DeployableComponent[] {
  const agentsRoot = path.join(rootPath, "agents");
  if (!fs.existsSync(agentsRoot)) {
    return [];
  }

  const components: DeployableComponent[] = [];
  for (const entry of fs.readdirSync(agentsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const manifestPath = path.join(agentsRoot, entry.name, `${entry.name}.json`);
    if (!fs.existsSync(manifestPath)) {
      continue;
    }

    const manifest = readJsonObject(manifestPath);
    const trackedFiles = [manifestPath];
    if (typeof manifest.instruction === "string" && manifest.instruction.trim().length > 0) {
      trackedFiles.push(resolveTrackedFile(rootPath, manifest.instruction));
    }

    for (const callbackField of CALLBACK_FIELDS) {
      const callbacks = manifest[callbackField];
      if (!Array.isArray(callbacks)) {
        continue;
      }
      for (const callback of callbacks) {
        if (isRecord(callback) && typeof callback.pythonCode === "string" && callback.pythonCode.trim().length > 0) {
          trackedFiles.push(resolveTrackedFile(rootPath, callback.pythonCode));
        }
      }
    }

    components.push(createComponent(rootPath, "agent", entry.name, manifest, trackedFiles));
  }

  return components;
}

function createComponent(
  rootPath: string,
  kind: DeployableComponentKind,
  resourceId: string,
  manifest: Record<string, unknown>,
  trackedFiles: string[],
): DeployableComponent {
  const uniqueFiles = [...new Set(trackedFiles.map((trackedFile) => path.resolve(trackedFile)))];
  const { combinedHash, fileHashes } = computeCombinedHash(rootPath, uniqueFiles);
  return {
    key: componentKey(kind, resourceId),
    kind,
    resourceId,
    displayName: typeof manifest.displayName === "string" && manifest.displayName.trim().length > 0
      ? manifest.displayName
      : resourceId,
    sourcePath: path.resolve(uniqueFiles[0] ?? trackedFiles[0] ?? ""),
    trackedFiles: uniqueFiles,
    fileHashes,
    combinedHash,
  };
}

function computeCombinedHash(rootPath: string, trackedFiles: string[]): { combinedHash: string; fileHashes: Record<string, string> } {
  const digest = crypto.createHash("sha256");
  const fileHashes: Record<string, string> = {};

  for (const trackedFile of [...trackedFiles].sort((left, right) => left.localeCompare(right))) {
    const resolvedPath = path.resolve(trackedFile);
    const relativePath = normalizeSeparators(path.relative(rootPath, resolvedPath));
    const fileHash = crypto.createHash("sha256").update(fs.readFileSync(resolvedPath)).digest("hex");
    digest.update(relativePath);
    digest.update("\0");
    digest.update(fileHash);
    digest.update("\0");
    fileHashes[relativePath] = fileHash;
  }

  return {
    combinedHash: digest.digest("hex"),
    fileHashes,
  };
}

function buildIncrementalPlan(
  localComponents: DeployableComponent[],
  stateComponents: Record<string, DeploymentStateEntry>,
): IncrementalDeploymentPlan {
  const added: DeployableComponent[] = [];
  const modified: DeployableComponent[] = [];
  const noop: DeployableComponent[] = [];

  for (const component of localComponents) {
    const previous = stateComponents[component.key];
    if (!previous) {
      added.push(component);
      continue;
    }

    if (previous.combined_sha256 !== component.combinedHash) {
      modified.push(component);
      continue;
    }

    noop.push(component);
  }

  const localKeys = new Set(localComponents.map((component) => component.key));
  const removed = Object.keys(stateComponents)
    .filter((key) => !localKeys.has(key))
    .sort();
  const actionable = [...added, ...modified].sort((left, right) => {
    const kindDelta = KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
    return kindDelta !== 0 ? kindDelta : left.resourceId.localeCompare(right.resourceId);
  });

  return {
    added,
    modified,
    noop,
    removed,
    actionable,
    summary: {
      added: added.length,
      modified: modified.length,
      noop: noop.length,
      removed: removed.length,
      actionable: actionable.length,
    },
  };
}

function buildRunArtifact(input: {
  runId: string;
  rootPath: string;
  target: IncrementalCesTargetOptions;
  storage: DeploymentStoragePaths;
  gitCommitSha: string | null;
  components: DeployableComponent[];
  stateComponents: Record<string, DeploymentStateEntry>;
  plan: IncrementalDeploymentPlan;
}): DeploymentRunArtifact {
  const statusByKey = new Map<string, DeploymentPlanStatus>();
  for (const component of input.plan.added) {
    statusByKey.set(component.key, "added");
  }
  for (const component of input.plan.modified) {
    statusByKey.set(component.key, "modified");
  }
  for (const component of input.plan.noop) {
    statusByKey.set(component.key, "noop");
  }

  const componentEntries: DeploymentRunComponentEntry[] = input.components.map((component) => {
    const previous = input.stateComponents[component.key];
    const planStatus = statusByKey.get(component.key) ?? "noop";
    return {
      key: component.key,
      kind: component.kind,
      resource_id: component.resourceId,
      display_name: component.displayName,
      source_path: component.sourcePath,
      tracked_files: trackedFileEntries(component),
      plan_status: planStatus,
      before_combined_sha256: previous?.combined_sha256 ?? null,
      after_combined_sha256: component.combinedHash,
      before_resource_name: previous?.resource_name ?? null,
      after_resource_name: planStatus === "noop" ? previous?.resource_name ?? null : null,
      before_remote_update_time: previous?.remote_update_time ?? null,
      after_remote_update_time: planStatus === "noop" ? previous?.remote_update_time ?? null : null,
      before_remote_create_time: previous?.remote_create_time ?? null,
      after_remote_create_time: planStatus === "noop" ? previous?.remote_create_time ?? null : null,
      operation: planStatus === "noop" ? "noop" : "pending",
      execution_status: planStatus === "noop" ? "skipped" : "pending",
      http_status: null,
      state_updated: false,
      deployed_at: null,
      error: null,
    };
  });

  for (const key of input.plan.removed) {
    const previous = input.stateComponents[key];
    componentEntries.push({
      key,
      kind: previous?.kind ?? null,
      resource_id: previous?.resource_id ?? null,
      display_name: previous?.display_name ?? null,
      source_path: previous?.source_path ?? null,
      tracked_files: previous?.tracked_files ?? [],
      plan_status: "removed",
      before_combined_sha256: previous?.combined_sha256 ?? null,
      after_combined_sha256: null,
      before_resource_name: previous?.resource_name ?? null,
      after_resource_name: null,
      before_remote_update_time: previous?.remote_update_time ?? null,
      after_remote_update_time: null,
      before_remote_create_time: previous?.remote_create_time ?? null,
      after_remote_create_time: null,
      operation: "none",
      execution_status: "not_applicable",
      http_status: null,
      state_updated: false,
      deployed_at: null,
      error: null,
    });
  }

  const artifact: DeploymentRunArtifact = {
    run_id: input.runId,
    started_at: timestampNow(),
    completed_at: null,
    status: "planned",
    mode: {
      validate_only: false,
      auto_confirm: false,
    },
    target: {
      project: input.target.projectId,
      location: input.target.location,
      app_id: input.target.appId,
      app_root: input.rootPath,
      state_file: input.storage.stateFile,
      artifacts_dir: input.storage.artifactsDir,
      endpoint: input.target.endpoint ?? null,
    },
    git: {
      commit_sha: input.gitCommitSha,
    },
    plan: {
      summary: input.plan.summary,
      components: componentEntries,
    },
    outcome: {
      message: null,
      summary: {},
    },
  };
  updateOutcomeSummary(artifact);
  return artifact;
}

function trackedFileEntries(component: DeployableComponent): DeploymentTrackedFile[] {
  return Object.entries(component.fileHashes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relativePath, sha256]) => ({ path: relativePath, sha256 }));
}

function buildStateEntry(
  component: DeployableComponent,
  resourceName: string,
  remoteUpdateTime?: string,
  remoteCreateTime?: string,
): DeploymentStateEntry {
  return {
    kind: component.kind,
    resource_id: component.resourceId,
    display_name: component.displayName,
    source_path: component.sourcePath,
    tracked_files: trackedFileEntries(component),
    combined_sha256: component.combinedHash,
    deployed_at: timestampNow(),
    resource_name: resourceName,
    ...(remoteUpdateTime ? { remote_update_time: remoteUpdateTime } : {}),
    ...(remoteCreateTime ? { remote_create_time: remoteCreateTime } : {}),
  };
}

function getArtifactEntry(artifact: DeploymentRunArtifact, key: string): DeploymentRunComponentEntry {
  const entry = artifact.plan.components.find((component) => component.key === key);
  if (!entry) {
    throw new Error(`Artifact is missing component entry for ${key}.`);
  }
  return entry;
}

function updateOutcomeSummary(artifact: DeploymentRunArtifact): void {
  const summary: Record<string, number> = {};
  for (const component of artifact.plan.components) {
    summary[component.execution_status] = (summary[component.execution_status] ?? 0) + 1;
  }
  artifact.outcome.summary = summary;
}

function finalizeArtifact(artifact: DeploymentRunArtifact, status: DeploymentRunStatus, message: string): void {
  artifact.status = status;
  artifact.completed_at = timestampNow();
  artifact.outcome.message = message;
  updateOutcomeSummary(artifact);
}

function loadDeploymentState(stateFile: string): DeploymentState {
  if (!fs.existsSync(stateFile)) {
    return {
      schema_version: SCHEMA_VERSION,
      components: {},
    };
  }

  const parsed = readJsonFile<Partial<DeploymentState>>(stateFile);
  return {
    schema_version: typeof parsed.schema_version === "number" ? parsed.schema_version : SCHEMA_VERSION,
    app_root: typeof parsed.app_root === "string" ? parsed.app_root : undefined,
    project: typeof parsed.project === "string" ? parsed.project : undefined,
    location: typeof parsed.location === "string" ? parsed.location : undefined,
    app_id: typeof parsed.app_id === "string" ? parsed.app_id : undefined,
    components: isRecord(parsed.components) ? parsed.components as Record<string, DeploymentStateEntry> : {},
  };
}

function getLatestArtifactPath(artifactsDir: string): string | null {
  if (!fs.existsSync(artifactsDir)) {
    return null;
  }

  const artifactPaths = fs.readdirSync(artifactsDir)
    .filter((entry) => entry.endsWith(".json"))
    .sort();
  const latest = artifactPaths[artifactPaths.length - 1];
  return latest ? path.join(artifactsDir, latest) : null;
}

function writeJsonFile(targetPath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, targetPath);
}

function readJsonFile<T>(targetPath: string): T {
  const raw = fs.readFileSync(targetPath, "utf8");
  return JSON.parse(raw) as T;
}

function readJsonObject(targetPath: string): Record<string, unknown> {
  const parsed = readJsonFile<unknown>(targetPath);
  if (!isRecord(parsed)) {
    throw new Error(`Expected JSON object in ${targetPath}.`);
  }
  return parsed;
}

function resolveTrackedFile(rootPath: string, relativePath: string): string {
  const targetPath = path.resolve(rootPath, relativePath);
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Referenced file does not exist: ${relativePath}`);
  }
  return targetPath;
}

function buildDeploymentRequest(
  component: DeployableComponent,
  rootPath: string,
  target: IncrementalCesTargetOptions,
  stateComponents: Record<string, DeploymentStateEntry>,
): DeploymentRequest {
  const manifest = readJsonObject(component.sourcePath);
  const endpoint = resolveCesEndpoint(target.location, target.endpoint);
  const appName = `projects/${target.projectId}/locations/${target.location}/apps/${target.appId}`;
  const { agentNames, toolNames, toolsetNames } = resolveResourceMaps(stateComponents);

  switch (component.kind) {
    case "agent": {
      const payload = convertAgentManifest(manifest, rootPath, target, agentNames, toolNames, toolsetNames);
      return {
        kind: component.kind,
        resourceName: fullAgentName(target, component.resourceId),
        displayName: typeof payload.displayName === "string" ? payload.displayName : component.displayName,
        collectionUrl: `${endpoint}/v1/${appName}/agents`,
        resourceUrl: `${endpoint}/v1/${fullAgentName(target, component.resourceId)}`,
        createQuery: `agentId=${encodeURIComponent(component.resourceId)}`,
        updateMask: buildUpdateMask(payload, AGENT_ALLOWED_UPDATE_FIELDS),
        payload,
      };
    }
    case "tool": {
      const payload = convertToolManifest(manifest, rootPath);
      return {
        kind: component.kind,
        resourceName: fullToolName(target, component.resourceId),
        displayName: typeof payload.displayName === "string" ? payload.displayName : component.displayName,
        collectionUrl: `${endpoint}/v1/${appName}/tools`,
        resourceUrl: `${endpoint}/v1/${fullToolName(target, component.resourceId)}`,
        createQuery: `toolId=${encodeURIComponent(component.resourceId)}`,
        updateMask: buildUpdateMask(payload, TOOL_ALLOWED_UPDATE_FIELDS),
        payload,
      };
    }
    case "toolset": {
      const payload = convertToolsetManifest(manifest, rootPath);
      return {
        kind: component.kind,
        resourceName: fullToolsetName(target, component.resourceId),
        displayName: typeof payload.displayName === "string" ? payload.displayName : component.displayName,
        collectionUrl: `${endpoint}/v1/${appName}/toolsets`,
        resourceUrl: `${endpoint}/v1/${fullToolsetName(target, component.resourceId)}`,
        createQuery: `toolsetId=${encodeURIComponent(component.resourceId)}`,
        updateMask: buildUpdateMask(payload, TOOLSET_ALLOWED_UPDATE_FIELDS),
        payload,
      };
    }
  }

  throw new Error(`Unsupported deployable component kind: ${String(component.kind)}`);
}

function convertAgentManifest(
  manifest: Record<string, unknown>,
  rootPath: string,
  target: IncrementalCesTargetOptions,
  agentNames: Record<string, string>,
  toolNames: Record<string, string>,
  toolsetNames: Record<string, string>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...manifest };
  if (typeof payload.instruction === "string" && payload.instruction.trim().length > 0) {
    payload.instruction = fs.readFileSync(resolveTrackedFile(rootPath, payload.instruction), "utf8");
  }

  if (Array.isArray(payload.childAgents)) {
    payload.childAgents = payload.childAgents
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => agentNames[value] ?? fullAgentName(target, value));
  }

  if (Array.isArray(payload.tools)) {
    payload.tools = payload.tools
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => toolNames[value] ?? fullToolName(target, value));
  }

  if (Array.isArray(payload.toolsets)) {
    payload.toolsets = payload.toolsets
      .filter(isRecord)
      .map((toolsetEntry) => {
        const entry = { ...toolsetEntry };
        if (typeof entry.toolset === "string" && entry.toolset.trim().length > 0) {
          entry.toolset = toolsetNames[entry.toolset] ?? fullToolsetName(target, entry.toolset);
        }
        return entry;
      });
  }

  for (const callbackField of CALLBACK_FIELDS) {
    if (Array.isArray(payload[callbackField])) {
      payload[callbackField] = payload[callbackField]
        .filter(isRecord)
        .map((callback) => {
          const entry = { ...callback };
          if (typeof entry.pythonCode === "string" && entry.pythonCode.trim().length > 0) {
            entry.pythonCode = fs.readFileSync(resolveTrackedFile(rootPath, entry.pythonCode), "utf8");
          }
          return entry;
        });
    }
  }

  return payload;
}

function convertToolManifest(manifest: Record<string, unknown>, rootPath: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (typeof manifest.displayName === "string") {
    payload.displayName = manifest.displayName;
  }
  if (typeof manifest.executionType === "string") {
    payload.executionType = manifest.executionType;
  }

  if (isRecord(manifest.pythonFunction)) {
    const pythonFunction: Record<string, unknown> = {};
    if (typeof manifest.pythonFunction.name === "string" && manifest.pythonFunction.name.trim().length > 0) {
      pythonFunction.name = manifest.pythonFunction.name;
    }
    if (typeof manifest.pythonFunction.pythonCode === "string" && manifest.pythonFunction.pythonCode.trim().length > 0) {
      pythonFunction.pythonCode = fs.readFileSync(resolveTrackedFile(rootPath, manifest.pythonFunction.pythonCode), "utf8");
    }
    if (typeof manifest.pythonFunction.description === "string" && manifest.pythonFunction.description.trim().length > 0) {
      pythonFunction.description = manifest.pythonFunction.description;
    }
    if (Object.keys(pythonFunction).length > 0) {
      payload.pythonFunction = pythonFunction;
    }
  }

  for (const field of [
    "agentTool",
    "clientFunction",
    "connectorTool",
    "dataStoreTool",
    "fileSearchTool",
    "googleSearchTool",
    "openApiTool",
    "widgetTool",
  ]) {
    if (field in manifest) {
      payload[field] = manifest[field];
    }
  }
  return payload;
}

function convertToolsetManifest(manifest: Record<string, unknown>, rootPath: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (typeof manifest.displayName === "string") {
    payload.displayName = manifest.displayName;
  }
  if (typeof manifest.description === "string") {
    payload.description = manifest.description;
  }
  if (isRecord(manifest.openApiToolset)) {
    const openApiToolset = { ...manifest.openApiToolset };
    if (typeof openApiToolset.openApiSchema === "string" && openApiToolset.openApiSchema.trim().length > 0) {
      openApiToolset.openApiSchema = fs.readFileSync(resolveTrackedFile(rootPath, openApiToolset.openApiSchema), "utf8");
    }
    payload.openApiToolset = openApiToolset;
  }
  return payload;
}

function buildUpdateMask(payload: Record<string, unknown>, allowedFields: readonly string[]): string {
  const fields = allowedFields.filter((field) => field in payload);
  if (fields.length === 0) {
    throw new Error("Payload does not contain any patchable CES fields.");
  }
  return fields.join(",");
}

function resolveResourceMaps(stateComponents: Record<string, DeploymentStateEntry>): {
  agentNames: Record<string, string>;
  toolNames: Record<string, string>;
  toolsetNames: Record<string, string>;
} {
  const agentNames: Record<string, string> = {};
  const toolNames: Record<string, string> = {};
  const toolsetNames: Record<string, string> = {};

  for (const entry of Object.values(stateComponents)) {
    const targetMap = entry.kind === "agent" ? agentNames : entry.kind === "tool" ? toolNames : toolsetNames;
    targetMap[entry.resource_id] = entry.resource_name;
    targetMap[entry.display_name] = entry.resource_name;
  }

  return { agentNames, toolNames, toolsetNames };
}

async function findExistingResourceName(request: DeploymentRequest, token: string): Promise<string | null> {
  const directResponse = await httpRequest("GET", request.resourceUrl, token);
  if (directResponse.status === 200) {
    const parsed = parseJsonObject(directResponse.body);
    if (parsed && typeof parsed.name === "string" && parsed.name.length > 0) {
      return parsed.name;
    }
    return request.resourceName;
  }

  if (directResponse.status !== 404) {
    throw new Error(`Failed to determine whether resource exists (${directResponse.status}) at ${request.resourceUrl}.`);
  }

  let pageToken = "";
  while (true) {
    const listUrl = pageToken
      ? `${request.collectionUrl}?pageToken=${encodeURIComponent(pageToken)}`
      : request.collectionUrl;
    const listResponse = await httpRequest("GET", listUrl, token);
    if (listResponse.status !== 200) {
      throw new Error(`Failed to list existing ${request.kind} resources (${listResponse.status}) at ${request.collectionUrl}.`);
    }

    const payload = parseJsonObject(listResponse.body) ?? {};
    const responseField = request.kind === "agent" ? "agents" : request.kind === "tool" ? "tools" : "toolsets";
    const matches = (Array.isArray(payload[responseField]) ? payload[responseField] : [])
      .filter(isRecord)
      .filter((entry) => entry.displayName === request.displayName)
      .map((entry) => typeof entry.name === "string" ? entry.name : "")
      .filter((name) => name.length > 0);

    if (matches.length > 1) {
      throw new Error(`Found multiple existing ${request.kind} resources with displayName '${request.displayName}'. Refusing to guess.`);
    }
    if (matches.length === 1) {
      return matches[0] ?? null;
    }

    const nextPageToken = typeof payload.nextPageToken === "string" ? payload.nextPageToken : "";
    if (!nextPageToken) {
      return null;
    }
    pageToken = nextPageToken;
  }
}

async function applyRequest(
  request: DeploymentRequest,
  token: string,
  existingResourceName: string | null,
): Promise<{ status: number; body: string }> {
  if (existingResourceName) {
    const url = `${buildResourceUrl(request.collectionUrl, existingResourceName)}?updateMask=${encodeURIComponent(request.updateMask).replace(/%2C/g, ",")}`;
    return httpRequest("PATCH", url, token, request.payload);
  }

  return httpRequest("POST", `${request.collectionUrl}?${request.createQuery}`, token, request.payload);
}

function buildResourceUrl(collectionUrl: string, resourceName: string): string {
  const marker = "/v1/";
  const markerIndex = collectionUrl.indexOf(marker);
  if (markerIndex < 0) {
    return collectionUrl;
  }
  return `${collectionUrl.slice(0, markerIndex + marker.length)}${resourceName}`;
}

function remoteMetadataFromBody(body: string): { name?: string; updateTime?: string; createTime?: string } {
  const payload = parseJsonObject(body, false);
  return {
    name: typeof payload?.name === "string" ? payload.name : undefined,
    updateTime: typeof payload?.updateTime === "string" ? payload.updateTime : undefined,
    createTime: typeof payload?.createTime === "string" ? payload.createTime : undefined,
  };
}

async function httpRequest(
  method: string,
  url: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: string }> {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    body: await response.text(),
  };
}

async function getAccessToken(): Promise<string> {
  const primary = (await tryExecFile("gcloud", ["auth", "print-access-token"]))?.trim();
  if (primary) {
    return primary;
  }

  const fallback = (await tryExecFile("gcloud", ["auth", "application-default", "print-access-token"]))?.trim();
  if (fallback) {
    return fallback;
  }

  throw new Error("Failed to obtain a Google Cloud access token. Run 'gcloud auth login' or 'gcloud auth application-default login' first.");
}

function resolveCesEndpoint(location: string, endpoint?: string): string {
  if (endpoint && endpoint.trim().length > 0) {
    return endpoint.replace(/\/+$/, "");
  }

  switch (location) {
    case "us":
      return "https://ces.us.rep.googleapis.com";
    case "eu":
      return "https://ces.eu.rep.googleapis.com";
    default:
      return "https://ces.googleapis.com";
  }
}

function fullAgentName(target: IncrementalCesTargetOptions, agentId: string): string {
  return `projects/${target.projectId}/locations/${target.location}/apps/${target.appId}/agents/${agentId}`;
}

function fullToolName(target: IncrementalCesTargetOptions, toolId: string): string {
  return `projects/${target.projectId}/locations/${target.location}/apps/${target.appId}/tools/${toolId}`;
}

function fullToolsetName(target: IncrementalCesTargetOptions, toolsetId: string): string {
  return `projects/${target.projectId}/locations/${target.location}/apps/${target.appId}/toolsets/${toolsetId}`;
}

function componentKey(kind: DeployableComponentKind, resourceId: string): string {
  return `${kind}:${resourceId}`;
}

function parseJsonObject(rawBody: string, throwOnInvalid = true): Record<string, unknown> | null {
  if (rawBody.trim().length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawBody);
    if (isRecord(parsed)) {
      return parsed;
    }
    if (throwOnInvalid) {
      throw new Error("Expected object JSON response from CES API.");
    }
    return null;
  } catch (error) {
    if (throwOnInvalid) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    return null;
  }
}

function timestampNow(): string {
  return new Date().toISOString();
}

function buildRunId(): string {
  const now = new Date();
  const pad = (value: number, width = 2): string => value.toString().padStart(width, "0");
  const timestamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}${pad(now.getUTCMilliseconds(), 3)}Z`;
  return `${timestamp}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

async function getGitCommitSha(cwd: string): Promise<string | null> {
  const stdout = await tryExecFile("git", ["-C", cwd, "rev-parse", "HEAD"]);
  const sha = stdout?.trim();
  return sha && sha.length > 0 ? sha : null;
}

function tryExecFile(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve(typeof stdout === "string" ? stdout : String(stdout));
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
