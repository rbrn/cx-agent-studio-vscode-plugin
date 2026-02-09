/*
 * Created by Codex on 2026-02-08.
 * Package indexing and model creation for CES validator.
 */

import * as fs from "fs";
import * as path from "path";
import { parseFileByExtension, parseJsonFile } from "./parsers";
import { parseInstructionFile } from "./instructionParser";
import { AgentInfo, EvaluationInfo, InstructionInfo, PackageModel, PythonToolInfo, ToolsetInfo } from "./types";

const SCHEMA_EXTENSIONS = new Set([".yaml", ".yml", ".json"]);

export function buildPackageModel(rootPath: string): PackageModel {
  const appYamlPath = path.join(rootPath, "app.yaml");
  const appJsonPath = path.join(rootPath, "app.json");

  const hasAppYaml = fs.existsSync(appYamlPath);
  const hasAppJson = fs.existsSync(appJsonPath);

  const manifestPath = hasAppYaml ? appYamlPath : hasAppJson ? appJsonPath : null;
  const manifestFormat = hasAppYaml ? "yaml" : hasAppJson ? "json" : "none";

  const manifestParse = manifestPath ? parseFileByExtension(manifestPath) : null;

  const files: string[] = [];
  const directories: string[] = [];
  collectPaths(rootPath, files, directories);

  const topLevelEntries = readDirectoryEntries(rootPath);
  const topLevelFiles = topLevelEntries
    .filter((entry) => entry.isFile)
    .map((entry) => entry.name)
    .sort();
  const topLevelDirs = topLevelEntries
    .filter((entry) => entry.isDirectory)
    .map((entry) => entry.name)
    .sort();

  const agentInfos = collectAgentInfos(rootPath);
  const toolsetInfos = collectToolsetInfos(rootPath);
  const pythonToolInfos = collectPythonToolInfos(rootPath);
  const evaluationInfos = collectEvaluationInfos(rootPath);
  const instructionInfos = collectInstructionInfos(rootPath, agentInfos);
  const guardrailDirs = collectImmediateDirectories(path.join(rootPath, "guardrails"));

  const { directTools, openApiOperations, openApiNamespacedOperations } = buildToolInventory(agentInfos, toolsetInfos, pythonToolInfos);

  const environmentPath = path.join(rootPath, "environment.json");
  const environment = fs.existsSync(environmentPath)
    ? (() => {
        const parsed = parseJsonFile(environmentPath);
        return {
          filePath: environmentPath,
          data: parsed.data,
          error: parsed.error,
        };
      })()
    : null;

  return {
    rootPath,
    hasAppJson,
    hasAppYaml,
    manifestPath,
    manifestFormat,
    manifestData: manifestParse?.data ?? null,
    manifestError: manifestParse?.error,
    files,
    directories,
    topLevelFiles,
    topLevelDirs,
    agentInfos,
    toolsetInfos,
    pythonToolInfos,
    evaluationInfos,
    instructionInfos,
    guardrailDirs,
    environment,
    directTools,
    openApiOperations,
    openApiNamespacedOperations,
  };
}

function collectAgentInfos(rootPath: string): AgentInfo[] {
  const agentsRoot = path.join(rootPath, "agents");
  const agentDirs = collectImmediateDirectories(agentsRoot);

  return agentDirs
    .map((dirPath) => {
      const name = path.basename(dirPath);
      const manifestPath = path.join(dirPath, `${name}.json`);
      const parsed = fs.existsSync(manifestPath)
        ? parseJsonFile(manifestPath)
        : { data: null, error: "Missing agent manifest file" };

      return {
        name,
        dirPath,
        manifestPath,
        manifestData: parsed.data,
        manifestError: parsed.error,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function collectToolsetInfos(rootPath: string): ToolsetInfo[] {
  const toolsetsRoot = path.join(rootPath, "toolsets");
  const toolsetDirs = collectImmediateDirectories(toolsetsRoot);

  return toolsetDirs
    .map((dirPath) => {
      const name = path.basename(dirPath);
      const manifestPath = path.join(dirPath, `${name}.json`);
      const parsed = fs.existsSync(manifestPath)
        ? parseJsonFile(manifestPath)
        : { data: null, error: "Missing toolset manifest file" };
      const openApiDirPath = path.join(dirPath, "open_api_toolset");

      return {
        name,
        dirPath,
        manifestPath,
        manifestData: parsed.data,
        manifestError: parsed.error,
        openApiDirPath,
        autoDetectedSchemaPath: findFirstSchemaFile(openApiDirPath),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function findFirstSchemaFile(openApiDirPath: string): string | null {
  if (!fs.existsSync(openApiDirPath) || !fs.statSync(openApiDirPath).isDirectory()) {
    return null;
  }

  const files = fs.readdirSync(openApiDirPath, { withFileTypes: true });
  for (const entry of files) {
    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (SCHEMA_EXTENSIONS.has(extension)) {
      return path.join(openApiDirPath, entry.name);
    }
  }

  return null;
}

function collectImmediateDirectories(rootPath: string): string[] {
  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
    return [];
  }

  return fs
    .readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootPath, entry.name));
}

function collectPaths(rootPath: string, files: string[], directories: string[]): void {
  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
    return;
  }

  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      directories.push(absolutePath);
      collectPaths(absolutePath, files, directories);
      continue;
    }

    if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
}

function readDirectoryEntries(rootPath: string): Array<{ name: string; isFile: boolean; isDirectory: boolean }> {
  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
    return [];
  }

  return fs.readdirSync(rootPath, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    isFile: entry.isFile(),
    isDirectory: entry.isDirectory(),
  }));
}

function collectEvaluationInfos(rootPath: string): EvaluationInfo[] {
  const evalsRoot = path.join(rootPath, "evaluations");
  const evalDirs = collectImmediateDirectories(evalsRoot);

  return evalDirs
    .map((dirPath) => {
      const name = path.basename(dirPath);
      const manifestPath = path.join(dirPath, `${name}.json`);
      const parsed = fs.existsSync(manifestPath)
        ? parseJsonFile(manifestPath)
        : { data: null, error: "Missing evaluation manifest file" };

      return {
        name,
        dirPath,
        manifestPath,
        manifestData: parsed.data,
        manifestError: parsed.error,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function collectPythonToolInfos(rootPath: string): PythonToolInfo[] {
  const toolsRoot = path.join(rootPath, "tools");
  const toolDirs = collectImmediateDirectories(toolsRoot);

  return toolDirs
    .map((dirPath) => {
      const name = path.basename(dirPath);
      const manifestPath = path.join(dirPath, `${name}.json`);
      const parsed = fs.existsSync(manifestPath)
        ? parseJsonFile(manifestPath)
        : { data: null, error: "Missing Python tool manifest file" };

      return {
        name,
        dirPath,
        manifestPath,
        manifestData: parsed.data,
        manifestError: parsed.error,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function buildToolInventory(
  agentInfos: AgentInfo[],
  toolsetInfos: ToolsetInfo[],
  pythonToolInfos: PythonToolInfo[],
): { directTools: Set<string>; openApiOperations: Set<string>; openApiNamespacedOperations: Set<string> } {
  const directTools = new Set<string>();
  const openApiOperations = new Set<string>();
  const openApiNamespacedOperations = new Set<string>();

  for (const agent of agentInfos) {
    if (!isRecord(agent.manifestData)) {
      continue;
    }

    const tools = agent.manifestData.tools;
    if (Array.isArray(tools)) {
      for (const tool of tools) {
        if (typeof tool === "string" && tool.trim().length > 0) {
          directTools.add(tool);
        }
      }
    }

    // Also collect toolIds from agent-level toolset references
    const toolsets = agent.manifestData.toolsets;
    if (Array.isArray(toolsets)) {
      for (const entry of toolsets) {
        if (isRecord(entry)) {
          const toolsetName = typeof entry.toolset === "string" ? entry.toolset : "";
          const toolIds = entry.toolIds;
          if (Array.isArray(toolIds)) {
            for (const tid of toolIds) {
              if (typeof tid === "string" && tid.trim().length > 0) {
                openApiOperations.add(tid);
                if (toolsetName) {
                  openApiNamespacedOperations.add(`${toolsetName}.${tid}`);
                }
              }
            }
          }
        }
      }
    }
  }

  for (const toolset of toolsetInfos) {
    if (!isRecord(toolset.manifestData)) {
      continue;
    }

    const toolIds = toolset.manifestData.toolIds;
    if (Array.isArray(toolIds)) {
      for (const tid of toolIds) {
        if (typeof tid === "string" && tid.trim().length > 0) {
          openApiOperations.add(tid);
          openApiNamespacedOperations.add(`${toolset.name}.${tid}`);
        }
      }
    }
  }

  // Python function tools are direct tools
  for (const pythonTool of pythonToolInfos) {
    directTools.add(pythonTool.name);
  }

  return { directTools, openApiOperations, openApiNamespacedOperations };
}

function collectInstructionInfos(rootPath: string, agentInfos: AgentInfo[]): InstructionInfo[] {
  const results: InstructionInfo[] = [];

  for (const agent of agentInfos) {
    const instructionPath = path.join(agent.dirPath, "instruction.txt");
    if (fs.existsSync(instructionPath)) {
      results.push(parseInstructionFile(instructionPath, agent.name));
    }
  }

  // Also check for global_instruction.txt at root
  const globalInstructionPath = path.join(rootPath, "global_instruction.txt");
  if (fs.existsSync(globalInstructionPath)) {
    results.push(parseInstructionFile(globalInstructionPath, "__global__"));
  }

  return results;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
