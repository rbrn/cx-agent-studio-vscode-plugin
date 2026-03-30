/*
 * Created by GitHub Copilot on 2026-03-24.
 * CES package packaging, archive validation, and remote import helpers.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { CALLBACK_KEYS } from "./callbacks";
import { buildPackageModel } from "./packageIndex";
import { parseFileByExtension } from "./parsers";
import { isLikelyInlineGlobalInstruction, normalizeSeparators, toRelativePath } from "./pathUtils";
import { PackageModel, ValidationIssue } from "./types";
import { runRules } from "./rules";

const BUILTIN_TOOLS = new Set(["end_session"]);
const ZIP_MAX_BUFFER = 20 * 1024 * 1024;

export interface PackageBundleResult {
  zipFile: string;
  latestZipFile: string;
  zipSizeBytes: number;
  sha256: string;
  validationIssues: ValidationIssue[];
}

export interface CesImportOptions {
  projectId: string;
  location: string;
  appId?: string;
  displayName?: string;
  importStrategy: "REPLACE" | "OVERWRITE";
  ignoreAppLock?: boolean;
  pollIntervalSeconds?: number;
  pollTimeoutSeconds?: number;
}

export interface CesImportResult {
  endpoint: string;
  parent: string;
  operationName: string;
  importedAppName?: string;
  warnings: string[];
  appExists: boolean;
}

export class DeploymentValidationError extends Error {
  public constructor(
    message: string,
    public readonly issues: ValidationIssue[],
  ) {
    super(message);
    this.name = "DeploymentValidationError";
  }
}

export function collectRequiredArchiveMembers(rootPath: string): string[] {
  const model = buildPackageModel(rootPath);
  const required = new Set<string>();
  const toolManifestPaths = buildToolManifestReferenceMap(model, rootPath);

  if (model.manifestPath) {
    addExistingRelativePath(required, rootPath, model.manifestPath);
  }

  if (model.environment) {
    addExistingRelativePath(required, rootPath, model.environment.filePath);
  }

  collectManifestReferencedMembers(model, required);

  for (const agentInfo of model.agentInfos) {
    addExistingRelativePath(required, rootPath, agentInfo.manifestPath);

    if (!isRecord(agentInfo.manifestData)) {
      continue;
    }

    addReferencedPath(required, rootPath, agentInfo.manifestData.instruction);
    addCallbackPaths(required, rootPath, agentInfo.manifestData);

    const childAgents = agentInfo.manifestData.childAgents;
    if (Array.isArray(childAgents)) {
      for (const childAgent of childAgents) {
        if (typeof childAgent === "string" && childAgent.trim().length > 0) {
          required.add(normalizeSeparators(`agents/${childAgent}/${childAgent}.json`));
        }
      }
    }

    const tools = agentInfo.manifestData.tools;
    if (Array.isArray(tools)) {
      for (const tool of tools) {
        if (typeof tool === "string" && tool.trim().length > 0 && !BUILTIN_TOOLS.has(tool)) {
          const resolvedManifestPath = toolManifestPaths.get(tool.trim());
          if (resolvedManifestPath) {
            required.add(resolvedManifestPath);
          } else {
            required.add(normalizeSeparators(`tools/${tool}/${tool}.json`));
          }
        }
      }
    }
  }

  for (const toolInfo of model.pythonToolInfos) {
    addExistingRelativePath(required, rootPath, toolInfo.manifestPath);

    if (!isRecord(toolInfo.manifestData)) {
      continue;
    }

    const pythonFunction = toolInfo.manifestData.pythonFunction;
    if (isRecord(pythonFunction)) {
      addReferencedPath(required, rootPath, pythonFunction.pythonCode);
    }
  }

  for (const toolsetInfo of model.toolsetInfos) {
    addExistingRelativePath(required, rootPath, toolsetInfo.manifestPath);

    if (isRecord(toolsetInfo.manifestData) && isRecord(toolsetInfo.manifestData.openApiToolset)) {
      addReferencedPath(required, rootPath, toolsetInfo.manifestData.openApiToolset.openApiSchema);
    } else if (toolsetInfo.autoDetectedSchemaPath) {
      addExistingRelativePath(required, rootPath, toolsetInfo.autoDetectedSchemaPath);
    }
  }

  for (const evaluationInfo of model.evaluationInfos) {
    addExistingRelativePath(required, rootPath, evaluationInfo.manifestPath);
  }

  return [...required].sort();
}

function buildToolManifestReferenceMap(model: PackageModel, rootPath: string): Map<string, string> {
  const references = new Map<string, string>();

  for (const toolInfo of model.pythonToolInfos) {
    const manifestRelativePath = normalizeSeparators(toRelativePath(rootPath, toolInfo.manifestPath));
    references.set(toolInfo.name, manifestRelativePath);

    const displayName = toolInfo.manifestData?.displayName;
    if (typeof displayName === "string" && displayName.trim().length > 0) {
      references.set(displayName.trim(), manifestRelativePath);
    }
  }

  return references;
}

export function findMissingArchiveMembers(rootPath: string, archiveEntries: Iterable<string>): string[] {
  const packageName = path.basename(rootPath);
  const normalizedEntries = new Set<string>();

  for (const entry of archiveEntries) {
    const normalized = normalizeSeparators(entry).replace(/\/+$/, "");
    if (normalized.length > 0) {
      normalizedEntries.add(normalized);
    }
  }

  const wrapperPrefix = `${packageName}/`;
  const hasWrapperDirectory = [...normalizedEntries].some((entry) => entry.startsWith(wrapperPrefix));
  const missing: string[] = [];

  if (!hasWrapperDirectory) {
    missing.push(wrapperPrefix);
  }

  for (const relativePath of collectRequiredArchiveMembers(rootPath)) {
    const expectedEntry = `${packageName}/${normalizeSeparators(relativePath)}`;
    if (!normalizedEntries.has(expectedEntry)) {
      missing.push(expectedEntry);
    }
  }

  return missing.sort();
}

export function findUnsupportedRootArchiveMembers(rootPath: string, archiveEntries: Iterable<string>): string[] {
  const packageName = path.basename(rootPath);
  const model = buildPackageModel(rootPath);
  const normalizedEntries = new Set<string>();

  for (const entry of archiveEntries) {
    const normalized = normalizeSeparators(entry).replace(/\/+$/, "");
    if (normalized.length > 0) {
      normalizedEntries.add(normalized);
    }
  }

  const allowedRootEntries = getAllowedRootEntries(model);

  const prefix = `${packageName}/`;
  const unsupported: string[] = [];
  for (const entry of normalizedEntries) {
    if (!entry.startsWith(prefix)) {
      continue;
    }
    const relativeEntry = entry.slice(prefix.length);
    if (!relativeEntry) {
      continue;
    }
    const rootName = relativeEntry.split("/", 1)[0] ?? "";
    if (!allowedRootEntries.has(rootName)) {
      unsupported.push(entry);
    }
  }

  return unsupported.sort();
}

function listUnsupportedRootSourceMembers(rootPath: string): string[] {
  const packageName = path.basename(rootPath);
  const sourceEntries = fs.readdirSync(rootPath).map((entryName) => `${packageName}/${normalizeSeparators(entryName)}`);
  return findUnsupportedRootArchiveMembers(rootPath, [`${packageName}/`, ...sourceEntries]);
}

function getAllowedRootEntries(model: PackageModel): Set<string> {
  const manifestBasename = model.manifestPath ? path.basename(model.manifestPath) : "app.yaml";
  const allowedRootEntries = new Set([
    manifestBasename,
    "environment.json",
    "agents",
    "tools",
    "toolsets",
    "guardrails",
    "evaluations",
  ]);

  const globalInstruction = model.manifestData?.globalInstruction;
  if (typeof globalInstruction === "string" && !isLikelyInlineGlobalInstruction(globalInstruction)) {
    const normalizedInstruction = normalizeSeparators(globalInstruction.trim());
    if (normalizedInstruction.length > 0 && !normalizedInstruction.includes("/")) {
      allowedRootEntries.add(normalizedInstruction);
    }
  }

  return allowedRootEntries;
}

export async function packageCesPackage(rootPath: string): Promise<PackageBundleResult> {
  const validationIssues = validatePackageForDeployment(rootPath);
  const packageName = path.basename(rootPath);
  const version = formatTimestamp(new Date());
  const zipFile = path.join(path.dirname(rootPath), `${packageName}-${version}.zip`);
  const latestZipFile = path.join(path.dirname(rootPath), `${packageName}.zip`);
  const unsupportedRootMembers = listUnsupportedRootSourceMembers(rootPath);

  fs.rmSync(zipFile, { force: true });

  const zipArgs = ["-r", zipFile, packageName, "-x", `${packageName}/**/__pycache__/*`];
  for (const unsupportedMember of unsupportedRootMembers) {
    zipArgs.push(unsupportedMember, `${unsupportedMember}/*`, `${unsupportedMember}/**`);
  }

  await runCommand("zip", zipArgs, path.dirname(rootPath));
  fs.copyFileSync(zipFile, latestZipFile);

  const archiveEntries = await listArchiveEntries(zipFile);
  const missingMembers = findMissingArchiveMembers(rootPath, archiveEntries);
  if (missingMembers.length > 0) {
    throw new Error(
      `Archive validation failed. Missing required package member(s): ${missingMembers.slice(0, 5).join(", ")}${missingMembers.length > 5 ? ` (+${missingMembers.length - 5} more)` : ""}`,
    );
  }

  const unsupportedMembers = findUnsupportedRootArchiveMembers(rootPath, archiveEntries);
  if (unsupportedMembers.length > 0) {
    throw new Error(
      `Archive validation failed. Unsupported root-level package member(s): ${unsupportedMembers.slice(0, 5).join(", ")}${unsupportedMembers.length > 5 ? ` (+${unsupportedMembers.length - 5} more)` : ""}`,
    );
  }

  const archiveBuffer = fs.readFileSync(zipFile);
  const sha256 = crypto.createHash("sha256").update(archiveBuffer).digest("hex");

  return {
    zipFile,
    latestZipFile,
    zipSizeBytes: archiveBuffer.length,
    sha256,
    validationIssues,
  };
}

export async function validateArchiveContents(rootPath: string, zipFile: string): Promise<string[]> {
  const archiveEntries = await listArchiveEntries(zipFile);
  return findMissingArchiveMembers(rootPath, archiveEntries);
}

export async function importPackageToCes(zipFile: string, options: CesImportOptions): Promise<CesImportResult> {
  if (!fs.existsSync(zipFile)) {
    throw new Error(`ZIP file not found: ${zipFile}`);
  }

  if (options.importStrategy !== "REPLACE" && options.importStrategy !== "OVERWRITE") {
    throw new Error("Import strategy must be REPLACE or OVERWRITE.");
  }

  if (options.appId) {
    validateAppId(options.appId);
  }

  const accessToken = await getAccessToken();
  const endpoint = getCesEndpoint(options.location);
  const parent = `projects/${options.projectId}/locations/${options.location}`;
  let appExists = false;

  if (options.appId) {
    const appUrl = `${endpoint}/v1/${parent}/apps/${options.appId}`;
    const appResponse = await fetch(appUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (appResponse.status === 200) {
      appExists = true;
    } else if (appResponse.status === 404) {
      appExists = false;
    } else {
      const errorBody = await appResponse.text();
      throw new Error(`Failed to determine whether app '${options.appId}' exists (HTTP ${appResponse.status}): ${errorBody}`);
    }

    if (appExists && options.displayName) {
      throw new Error("displayName cannot be used when reimporting an existing app ID. Omit displayName or choose a new app ID.");
    }
  }

  const payload: Record<string, unknown> = {
    appContent: fs.readFileSync(zipFile).toString("base64"),
  };

  if (options.appId) {
    payload.appId = options.appId;
  }

  if (options.displayName) {
    payload.displayName = options.displayName;
  }

  payload.importOptions = {
    conflictResolutionStrategy: options.importStrategy,
  };

  if (options.ignoreAppLock) {
    payload.ignoreAppLock = true;
  }

  const importResponse = await fetch(`${endpoint}/v1/${parent}/apps:importApp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "x-goog-request-params": `parent=${parent}`,
    },
    body: JSON.stringify(payload),
  });

  const importJson = await readJsonResponse(importResponse, "CES import request failed");
  const operationName = typeof importJson.name === "string" ? importJson.name : "";
  if (!operationName) {
    throw new Error("CES import response did not include an operation name.");
  }

  const pollIntervalMs = Math.max(1, options.pollIntervalSeconds ?? 5) * 1000;
  const timeoutMs = Math.max(1, options.pollTimeoutSeconds ?? 300) * 1000;
  const pollStarted = Date.now();
  let statusJson = importJson;

  while (statusJson.done !== true) {
    if (Date.now() - pollStarted > timeoutMs) {
      throw new Error(`Timed out waiting for CES import to finish after ${Math.round(timeoutMs / 1000)}s (${operationName}).`);
    }

    await delay(pollIntervalMs);
    const statusResponse = await fetch(`${endpoint}/v1/${operationName}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    statusJson = await readJsonResponse(statusResponse, "Failed to poll CES import operation");
  }

  if (isRecord(statusJson.error)) {
    throw new Error(`CES import failed: ${JSON.stringify(statusJson.error)}`);
  }

  const response = isRecord(statusJson.response) ? statusJson.response : null;
  const warnings = Array.isArray(response?.warnings)
    ? response.warnings.filter((value): value is string => typeof value === "string")
    : [];

  return {
    endpoint,
    parent,
    operationName,
    importedAppName: typeof response?.name === "string" ? response.name : undefined,
    warnings,
    appExists,
  };
}

function collectManifestReferencedMembers(model: PackageModel, required: Set<string>): void {
  if (!model.manifestPath) {
    return;
  }

  const manifest = parseFileByExtension(model.manifestPath);
  if (!isRecord(manifest.data)) {
    return;
  }

  const rootAgent = manifest.data.rootAgent;
  if (typeof rootAgent === "string" && rootAgent.trim().length > 0) {
    required.add(normalizeSeparators(`agents/${rootAgent}/${rootAgent}.json`));
  }

  const globalInstruction = manifest.data.globalInstruction;
  if (typeof globalInstruction === "string" && !isLikelyInlineGlobalInstruction(globalInstruction)) {
    addReferencedPath(required, model.rootPath, globalInstruction);
  }
}

function addCallbackPaths(required: Set<string>, rootPath: string, manifestData: Record<string, unknown>): void {
  for (const callbackKey of CALLBACK_KEYS) {
    const callbacks = manifestData[callbackKey];
    if (!Array.isArray(callbacks)) {
      continue;
    }

    for (const callback of callbacks) {
      if (isRecord(callback)) {
        addReferencedPath(required, rootPath, callback.pythonCode);
      }
    }
  }
}

function addReferencedPath(required: Set<string>, rootPath: string, rawPath: unknown): void {
  if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
    return;
  }

  const normalized = normalizeSeparators(rawPath.trim());
  if (path.isAbsolute(normalized)) {
    return;
  }

  const resolvedPath = path.join(rootPath, normalized);
  required.add(normalizeSeparators(fs.existsSync(resolvedPath) ? toRelativePath(rootPath, resolvedPath) : normalized));
}

function addExistingRelativePath(required: Set<string>, rootPath: string, absolutePath: string): void {
  required.add(normalizeSeparators(toRelativePath(rootPath, absolutePath)));
}

function validatePackageForDeployment(rootPath: string): ValidationIssue[] {
  const model = buildPackageModel(rootPath);
  const issues = runRules(model);
  const errors = issues.filter((issue) => issue.severity === "error");

  if (errors.length > 0) {
    throw new DeploymentValidationError(
      `Cannot package '${path.basename(rootPath)}' because ${errors.length} validation error(s) must be fixed first.`,
      issues,
    );
  }

  return issues;
}

async function listArchiveEntries(zipFile: string): Promise<string[]> {
  const stdout = await runCommand("unzip", ["-Z1", zipFile]);
  return stdout
    .split(/\r?\n/)
    .map((line) => normalizeSeparators(line.trim()))
    .filter((line) => line.length > 0);
}

async function getAccessToken(): Promise<string> {
  const primary = (await tryRunCommand("gcloud", ["auth", "print-access-token"]))?.trim();
  if (primary) {
    return primary;
  }

  const fallback = (await tryRunCommand("gcloud", ["auth", "application-default", "print-access-token"]))?.trim();
  if (fallback) {
    return fallback;
  }

  throw new Error("Failed to obtain a Google Cloud access token. Run 'gcloud auth login' or 'gcloud auth application-default login' first.");
}

function getCesEndpoint(location: string): string {
  switch (location) {
    case "us":
      return "https://ces.us.rep.googleapis.com";
    case "eu":
      return "https://ces.eu.rep.googleapis.com";
    default:
      return "https://ces.googleapis.com";
  }
}

function validateAppId(appId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{4,35}$/.test(appId)) {
    throw new Error(`Invalid appId '${appId}'. Must match [A-Za-z0-9][A-Za-z0-9_-]{4,35} (length 5-36).`);
  }
}

function formatTimestamp(date: Date): string {
  const pad = (value: number): string => value.toString().padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

async function readJsonResponse(response: Response, contextMessage: string): Promise<Record<string, unknown>> {
  const rawText = await response.text();
  let payload: unknown = {};

  if (rawText.trim().length > 0) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = { rawText };
    }
  }

  if (!response.ok) {
    throw new Error(`${contextMessage} (HTTP ${response.status}): ${typeof payload === "string" ? payload : JSON.stringify(payload)}`);
  }

  return isRecord(payload) ? payload : { value: payload };
}

function runCommand(command: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd,
        encoding: "utf8",
        maxBuffer: ZIP_MAX_BUFFER,
      },
      (error, stdout, stderr) => {
        if (error) {
          const stderrText = typeof stderr === "string" ? stderr.trim() : "";
          reject(new Error(`Failed to run '${command} ${args.join(" ")}': ${stderrText || error.message}`));
          return;
        }

        resolve(typeof stdout === "string" ? stdout : String(stdout));
      },
    );
  });
}

async function tryRunCommand(command: string, args: string[]): Promise<string | null> {
  try {
    return await runCommand(command, args);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
