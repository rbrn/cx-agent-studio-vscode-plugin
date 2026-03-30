/*
 * Created by GitHub Copilot on 2026-03-30.
 * Shared callback metadata and helpers for CES agent manifests.
 */

import * as path from "path";
import { normalizeSeparators } from "./pathUtils";

export const CALLBACK_KEYS = [
  "beforeAgentCallbacks",
  "beforeModelCallbacks",
  "beforeToolCallbacks",
  "afterAgentCallbacks",
  "afterModelCallbacks",
  "afterToolCallbacks",
] as const;

export type CallbackKey = typeof CALLBACK_KEYS[number];

export interface AgentCallbackEntry {
  field: CallbackKey;
  index: number;
  pythonCodePath?: string;
  resolvedFilePath?: string;
}

export function collectAgentCallbackEntries(rootPath: string, manifestData: Record<string, unknown> | null | undefined): AgentCallbackEntry[] {
  if (!isRecord(manifestData)) {
    return [];
  }

  const entries: AgentCallbackEntry[] = [];

  for (const field of CALLBACK_KEYS) {
    const callbacks = manifestData[field];
    if (!Array.isArray(callbacks)) {
      continue;
    }

    for (let index = 0; index < callbacks.length; index++) {
      const callback = callbacks[index];
      if (!isRecord(callback)) {
        continue;
      }

      const pythonCodePath = normalizeCallbackPath(callback.pythonCode);
      entries.push({
        field,
        index,
        pythonCodePath,
        resolvedFilePath: pythonCodePath
          ? path.isAbsolute(pythonCodePath)
            ? pythonCodePath
            : path.join(rootPath, pythonCodePath)
          : undefined,
      });
    }
  }

  return entries;
}

export function getCallbackFieldLabel(field: CallbackKey): string {
  switch (field) {
    case "beforeAgentCallbacks":
      return "Before agent callbacks";
    case "beforeModelCallbacks":
      return "Before model callbacks";
    case "beforeToolCallbacks":
      return "Before tool callbacks";
    case "afterAgentCallbacks":
      return "After agent callbacks";
    case "afterModelCallbacks":
      return "After model callbacks";
    case "afterToolCallbacks":
      return "After tool callbacks";
  }
}

function normalizeCallbackPath(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = normalizeSeparators(value.trim());
  return normalized.length > 0 ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}