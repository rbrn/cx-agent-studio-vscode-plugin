/*
 * Created by GitHub Copilot on 2026-03-30.
 * Reads deployment/import defaults from a project-level .env file.
 */

import * as fs from "fs";
import * as path from "path";

export interface DeploymentEnvDefaults {
  projectId?: string;
  location?: string;
  appId?: string;
}

export function mergeDeploymentDefaults<T extends Record<string, unknown>>(storedProfile: T, envDefaults: Partial<T>): T {
  const merged = { ...storedProfile };

  for (const [key, value] of Object.entries(envDefaults)) {
    if (value !== undefined) {
      merged[key as keyof T] = value as T[keyof T];
    }
  }

  return merged;
}

export function loadDeploymentEnvDefaults(packageRoot: string, workspaceRoot?: string): DeploymentEnvDefaults {
  const envPath = resolveEnvFile(packageRoot, workspaceRoot);
  if (!envPath) {
    return {};
  }

  const values = parseDotEnv(fs.readFileSync(envPath, "utf8"));
  return {
    projectId: normalizeValue(values.GCP_PROJECT_ID),
    location: normalizeLocation(values.GCP_LOCATION),
    appId: normalizeValue(values.CES_APP_ID),
  };
}

export function parseDotEnv(contents: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    values[key] = stripWrappingQuotes(rawValue);
  }

  return values;
}

function resolveEnvFile(packageRoot: string, workspaceRoot?: string): string | null {
  if (workspaceRoot) {
    const workspaceEnv = path.join(workspaceRoot, ".env");
    if (fs.existsSync(workspaceEnv)) {
      return workspaceEnv;
    }
  }

  let currentPath = path.resolve(packageRoot);
  while (true) {
    const candidate = path.join(currentPath, ".env");
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return null;
    }
    currentPath = parentPath;
  }
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function normalizeValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeLocation(value: string | undefined): string | undefined {
  const normalized = normalizeValue(value);
  return normalized ? normalized.toLowerCase() : undefined;
}
