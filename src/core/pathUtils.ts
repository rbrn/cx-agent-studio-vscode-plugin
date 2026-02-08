/*
 * Created by Codex on 2026-02-08.
 * Path and classification helpers for CES package validation.
 */

import * as path from "path";

const RELEVANT_TOP_LEVEL_DIRS = new Set([
  "agents",
  "toolsets",
  "guardrails",
  "tools",
  "examples",
  "evaluations",
  "evaluationdatasets",
]);

export function normalizeSeparators(inputPath: string): string {
  return inputPath.replace(/\\/g, "/");
}

export function toRelativePath(rootPath: string, targetPath: string): string {
  return normalizeSeparators(path.relative(rootPath, targetPath));
}

export function splitRelativePath(relativePath: string): string[] {
  return normalizeSeparators(relativePath)
    .split("/")
    .filter((segment) => segment.length > 0);
}

export function getTopLevelSegment(relativePath: string): string | null {
  const segments = splitRelativePath(relativePath);
  if (segments.length === 0) {
    return null;
  }

  return segments[0] ?? null;
}

export function getDepthBelowTopLevel(relativePath: string): number {
  const segments = splitRelativePath(relativePath);
  if (segments.length <= 1) {
    return 0;
  }

  return segments.length - 1;
}

export function isLikelyInlineGlobalInstruction(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }

  if (trimmed.includes("\n") || trimmed.includes("\r")) {
    return true;
  }

  if (trimmed.endsWith(".txt") || trimmed.includes("/")) {
    return false;
  }

  return trimmed.length > 20;
}

export function isRelevantFilesystemPath(absolutePath: string): boolean {
  const normalized = normalizeSeparators(absolutePath);
  const lower = normalized.toLowerCase();

  if (
    lower.endsWith("/app.json") ||
    lower.endsWith("/app.yaml") ||
    lower.endsWith("/app.yml") ||
    lower.endsWith("/environment.json") ||
    lower.endsWith("/global_instruction.txt") ||
    lower.endsWith("/instruction.txt")
  ) {
    return true;
  }

  const segments = lower.split("/");
  return segments.some((segment) => RELEVANT_TOP_LEVEL_DIRS.has(segment));
}
