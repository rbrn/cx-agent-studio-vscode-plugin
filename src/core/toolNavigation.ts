/*
 * Created by GitHub Copilot on 2026-03-24.
 * Resolves navigation targets for CES tool inventory nodes.
 */

import * as path from "path";
import { findLineContaining } from "./parsers";
import { normalizeSeparators } from "./pathUtils";
import { PackageModel, ToolsetInfo } from "./types";

export interface ToolNavigationTarget {
  filePath: string;
  line?: number;
  description: string;
  tooltip: string;
}

export function resolveInstructionNavigation(model: PackageModel, agentName: string): ToolNavigationTarget | null {
  const instructionInfo = model.instructionInfos.find((info) => info.agentName === agentName);
  if (!instructionInfo) {
    return null;
  }

  const relativePath = path.relative(model.rootPath, instructionInfo.filePath);
  return {
    filePath: instructionInfo.filePath,
    line: 1,
    description: agentName === "__global__" ? "global instruction" : "agent instruction",
    tooltip: `${agentName === "__global__" ? "global instruction" : `${agentName} instruction`} → ${relativePath}`,
  };
}

export function resolveDirectToolNavigation(model: PackageModel, toolName: string): ToolNavigationTarget | null {
  const toolInfo = model.pythonToolInfos.find((info) => info.name === toolName);
  if (!toolInfo) {
    return null;
  }

  const pythonFunction = isRecord(toolInfo.manifestData?.pythonFunction)
    ? toolInfo.manifestData.pythonFunction
    : null;
  const pythonCode = typeof pythonFunction?.pythonCode === "string"
    ? normalizeSeparators(pythonFunction.pythonCode.trim())
    : "";

  if (pythonCode.length > 0) {
    const resolvedCodePath = path.isAbsolute(pythonCode)
      ? pythonCode
      : path.join(model.rootPath, pythonCode);
    const line = findLineContaining(resolvedCodePath, new RegExp(`def\\s+${escapeRegExp(toolName)}\\s*\\(`)) ?? 1;

    return {
      filePath: resolvedCodePath,
      line,
      description: "python tool",
      tooltip: `${toolName} → ${pythonCode}`,
    };
  }

  return {
    filePath: toolInfo.manifestPath,
    line: 1,
    description: "tool manifest",
    tooltip: `${toolName} → ${path.relative(model.rootPath, toolInfo.manifestPath)}`,
  };
}

export function resolveOpenApiOperationNavigation(model: PackageModel, operationName: string): ToolNavigationTarget | null {
  for (const toolsetInfo of model.toolsetInfos) {
    const schemaPath = resolveToolsetSchemaPath(model.rootPath, toolsetInfo);
    if (!schemaPath) {
      continue;
    }

    const line = findLineContaining(schemaPath, new RegExp(`operationId\\s*:\\s*['\"]?${escapeRegExp(operationName)}['\"]?`));
    if (!line) {
      continue;
    }

    return {
      filePath: schemaPath,
      line,
      description: `OpenAPI operation (${toolsetInfo.name})`,
      tooltip: `${operationName} → ${path.relative(model.rootPath, schemaPath)}:${line}`,
    };
  }

  return null;
}

export function resolveToolsetNavigation(model: PackageModel, toolsetName: string): ToolNavigationTarget | null {
  const toolsetInfo = model.toolsetInfos.find((info) => info.name === toolsetName);
  if (!toolsetInfo) {
    return null;
  }

  return {
    filePath: toolsetInfo.manifestPath,
    line: 1,
    description: "toolset manifest",
    tooltip: `${toolsetName} → ${path.relative(model.rootPath, toolsetInfo.manifestPath)}`,
  };
}

function resolveToolsetSchemaPath(rootPath: string, toolsetInfo: ToolsetInfo): string | null {
  if (isRecord(toolsetInfo.manifestData?.openApiToolset) && typeof toolsetInfo.manifestData.openApiToolset.openApiSchema === "string") {
    const schemaPath = normalizeSeparators(toolsetInfo.manifestData.openApiToolset.openApiSchema.trim());
    return path.isAbsolute(schemaPath) ? schemaPath : path.join(rootPath, schemaPath);
  }

  return toolsetInfo.autoDetectedSchemaPath;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
