/*
 * Created by Codex on 2026-02-08.
 * Rule engine for CES package validation.
 */

import * as fs from "fs";
import * as path from "path";
import { getDepthBelowTopLevel, isLikelyInlineGlobalInstruction, normalizeSeparators, toRelativePath } from "./pathUtils";
import { findLineContaining, parseJsonFile, parseOpenApiFile } from "./parsers";
import { AgentInfo, PackageModel, ValidationIssue, ValidationSeverity } from "./types";
import { REQUIRED_SECTIONS } from "./instructionParser";

const ROOT_DEPTH_LIMIT = 2;
const TOOLSET_DEPTH_LIMIT = 3;

export function runRules(model: PackageModel): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  validateManifest(model, issues);
  validateUnsupportedDirectories(model, issues);
  validateNestingDepth(model, issues);
  validateAgents(model, issues);
  validateToolsets(model, issues);
  validateEvaluations(model, issues);
  validateInstructions(model, issues);
  validateEnvironment(model, issues);

  issues.sort((left, right) => {
    const fileCompare = left.file.localeCompare(right.file);
    if (fileCompare !== 0) {
      return fileCompare;
    }

    const lineCompare = (left.line ?? 1) - (right.line ?? 1);
    if (lineCompare !== 0) {
      return lineCompare;
    }

    return left.code.localeCompare(right.code);
  });

  return issues;
}

function validateManifest(model: PackageModel, issues: ValidationIssue[]): void {
  const fallbackManifestPath = path.join(model.rootPath, "app.yaml");

  if (!model.manifestPath) {
    pushIssue(
      issues,
      "CES_MANIFEST_MISSING",
      "Package must contain app.yaml or app.json at root",
      "error",
      fallbackManifestPath,
      1,
    );
    return;
  }

  if (model.hasAppJson && model.hasAppYaml) {
    pushIssue(
      issues,
      "CES_MANIFEST_BOTH_PRESENT",
      "Both app.yaml and app.json are present. app.yaml takes precedence.",
      "warning",
      model.manifestPath,
      1,
    );
  }

  if (model.hasAppJson && !model.hasAppYaml) {
    pushIssue(
      issues,
      "CES_APP_JSON_ONLY",
      "app.json is supported by this validator, but Agent Studio import compatibility is typically app.yaml-first.",
      "warning",
      model.manifestPath,
      1,
    );
  }

  if (model.manifestError) {
    pushIssue(
      issues,
      "CES_MANIFEST_PARSE_ERROR",
      `Manifest parse error: ${model.manifestError}`,
      "error",
      model.manifestPath,
      1,
    );
    return;
  }

  if (!isRecord(model.manifestData)) {
    pushIssue(
      issues,
      "CES_MANIFEST_INVALID_ROOT",
      "Manifest root must be an object",
      "error",
      model.manifestPath,
      1,
    );
    return;
  }

  const rootAgentValue = model.manifestData.rootAgent;
  if (typeof rootAgentValue !== "string" || rootAgentValue.trim().length === 0) {
    pushIssue(
      issues,
      "CES_ROOT_AGENT_MISSING",
      "Manifest must define a non-empty rootAgent",
      "error",
      model.manifestPath,
      findLineContaining(model.manifestPath, "rootAgent"),
    );
  } else {
    validateRootAgentReference(model, rootAgentValue, issues);
  }

  validateGlobalInstructionReference(model, issues);
  validateGuardrailReferences(model, issues);
}

function validateRootAgentReference(model: PackageModel, rootAgent: string, issues: ValidationIssue[]): void {
  const rootAgentDir = path.join(model.rootPath, "agents", rootAgent);
  const rootAgentManifest = path.join(rootAgentDir, `${rootAgent}.json`);

  if (!fs.existsSync(rootAgentDir) || !fs.statSync(rootAgentDir).isDirectory()) {
    pushIssue(
      issues,
      "CES_ROOT_AGENT_DIR_MISSING",
      `rootAgent '${rootAgent}' must exist at agents/${rootAgent}`,
      "error",
      model.manifestPath ?? path.join(model.rootPath, "app.yaml"),
      findLineContaining(model.manifestPath ?? "", "rootAgent"),
    );
    return;
  }

  if (!fs.existsSync(rootAgentManifest)) {
    pushIssue(
      issues,
      "CES_ROOT_AGENT_MANIFEST_MISSING",
      `rootAgent manifest missing at agents/${rootAgent}/${rootAgent}.json`,
      "error",
      rootAgentManifest,
      1,
    );
  }
}

function validateGlobalInstructionReference(model: PackageModel, issues: ValidationIssue[]): void {
  if (!isRecord(model.manifestData) || !model.manifestPath) {
    return;
  }

  const globalInstruction = model.manifestData.globalInstruction;
  if (typeof globalInstruction !== "string" || globalInstruction.trim().length === 0) {
    return;
  }

  if (isLikelyInlineGlobalInstruction(globalInstruction)) {
    return;
  }

  const normalized = normalizeSeparators(globalInstruction.trim());
  const resolvedPath = path.isAbsolute(normalized)
    ? normalized
    : path.join(model.rootPath, normalized);

  if (!fs.existsSync(resolvedPath)) {
    pushIssue(
      issues,
      "CES_GLOBAL_INSTRUCTION_MISSING",
      `globalInstruction path does not exist: ${normalized}`,
      "error",
      model.manifestPath,
      findLineContaining(model.manifestPath, "globalInstruction"),
    );
  }
}

function validateGuardrailReferences(model: PackageModel, issues: ValidationIssue[]): void {
  if (!isRecord(model.manifestData) || !model.manifestPath) {
    return;
  }

  const guardrails = model.manifestData.guardrails;
  if (!Array.isArray(guardrails)) {
    return;
  }

  for (const guardrail of guardrails) {
    if (typeof guardrail !== "string" || guardrail.trim().length === 0) {
      continue;
    }

    const guardrailPath = resolveGuardrailManifestPath(model.rootPath, guardrail);
    if (!guardrailPath) {
      pushIssue(
        issues,
        "CES_GUARDRAIL_REFERENCE_MISSING",
        `guardrail reference '${guardrail}' does not map to an existing guardrail manifest`,
        "error",
        model.manifestPath,
        findLineContaining(model.manifestPath, guardrail),
      );
      continue;
    }

    const parsed = parseJsonFile(guardrailPath);
    if (parsed.error) {
      pushIssue(
        issues,
        "CES_GUARDRAIL_JSON_INVALID",
        `guardrail manifest is invalid JSON: ${parsed.error}`,
        "error",
        guardrailPath,
        1,
      );
      continue;
    }

    const displayName = parsed.data?.displayName;
    if (typeof displayName === "string") {
      const normalizedDisplay = displayName.trim();
      const normalizedReference = guardrail.trim();
      if (normalizedDisplay !== normalizedReference) {
        pushIssue(
          issues,
          "CES_GUARDRAIL_DISPLAYNAME_MISMATCH",
          `guardrail displayName '${normalizedDisplay}' differs from manifest reference '${normalizedReference}'`,
          "warning",
          guardrailPath,
          findLineContaining(guardrailPath, "displayName"),
        );
      }
    }
  }
}

function validateAgents(model: PackageModel, issues: ValidationIssue[]): void {
  const toolsetNames = new Set(model.toolsetInfos.map((toolset) => toolset.name));
  const agentNames = new Set(model.agentInfos.map((agent) => agent.name));

  for (const agentInfo of model.agentInfos) {
    validateAgentManifest(agentInfo, issues);

    if (!isRecord(agentInfo.manifestData)) {
      continue;
    }

    const expectedInstruction = `agents/${agentInfo.name}/instruction.txt`;
    const instruction = agentInfo.manifestData.instruction;

    if (typeof instruction !== "string" || instruction.trim().length === 0) {
      pushIssue(
        issues,
        "CES_AGENT_INSTRUCTION_MISSING",
        `Agent '${agentInfo.name}' must define instruction path`,
        "error",
        agentInfo.manifestPath,
        findLineContaining(agentInfo.manifestPath, "instruction"),
      );
    } else {
      const normalizedInstruction = normalizeSeparators(instruction.trim());
      if (normalizedInstruction !== expectedInstruction) {
        pushIssue(
          issues,
          "CES_AGENT_INSTRUCTION_PATH_MISMATCH",
          `Agent '${agentInfo.name}' instruction should be '${expectedInstruction}'`,
          "error",
          agentInfo.manifestPath,
          findLineContaining(agentInfo.manifestPath, "instruction"),
        );
      }

      const resolvedInstructionPath = path.isAbsolute(normalizedInstruction)
        ? normalizedInstruction
        : path.join(model.rootPath, normalizedInstruction);

      if (!fs.existsSync(resolvedInstructionPath)) {
        pushIssue(
          issues,
          "CES_AGENT_INSTRUCTION_FILE_MISSING",
          `Instruction file does not exist: ${normalizedInstruction}`,
          "error",
          agentInfo.manifestPath,
          findLineContaining(agentInfo.manifestPath, "instruction"),
        );
      }
    }

    const childAgents = agentInfo.manifestData.childAgents;
    if (Array.isArray(childAgents)) {
      for (const childAgent of childAgents) {
        if (typeof childAgent !== "string" || childAgent.trim().length === 0) {
          continue;
        }

        if (!agentNames.has(childAgent)) {
          pushIssue(
            issues,
            "CES_CHILD_AGENT_MISSING",
            `childAgent '${childAgent}' does not exist under agents/`,
            "error",
            agentInfo.manifestPath,
            findLineContaining(agentInfo.manifestPath, childAgent),
          );
        }
      }
    }

    const toolsets = agentInfo.manifestData.toolsets;
    if (Array.isArray(toolsets)) {
      for (const toolsetEntry of toolsets) {
        const toolsetName = extractToolsetName(toolsetEntry);
        if (!toolsetName) {
          continue;
        }

        if (!toolsetNames.has(toolsetName)) {
          pushIssue(
            issues,
            "CES_AGENT_TOOLSET_REFERENCE_MISSING",
            `Agent '${agentInfo.name}' references missing toolset '${toolsetName}'`,
            "error",
            agentInfo.manifestPath,
            findLineContaining(agentInfo.manifestPath, toolsetName),
          );
        }
      }
    }
  }
}

function validateAgentManifest(agentInfo: AgentInfo, issues: ValidationIssue[]): void {
  if (agentInfo.manifestError) {
    pushIssue(
      issues,
      "CES_AGENT_MANIFEST_INVALID",
      `Agent manifest error for '${agentInfo.name}': ${agentInfo.manifestError}`,
      "error",
      agentInfo.manifestPath,
      1,
    );
  }
}

function validateToolsets(model: PackageModel, issues: ValidationIssue[]): void {
  for (const toolsetInfo of model.toolsetInfos) {
    if (toolsetInfo.manifestError) {
      pushIssue(
        issues,
        "CES_TOOLSET_MANIFEST_INVALID",
        `Toolset '${toolsetInfo.name}' manifest error: ${toolsetInfo.manifestError}`,
        "error",
        toolsetInfo.manifestPath,
        1,
      );
      continue;
    }

    let schemaPath: string | null = null;
    const declaredSchemaPath = readDeclaredSchemaPath(toolsetInfo.manifestData);

    if (declaredSchemaPath) {
      const normalized = normalizeSeparators(declaredSchemaPath);
      schemaPath = path.isAbsolute(normalized)
        ? normalized
        : path.join(model.rootPath, normalized);

      if (!fs.existsSync(schemaPath)) {
        pushIssue(
          issues,
          "CES_OPENAPI_SCHEMA_MISSING",
          `Declared OpenAPI schema does not exist: ${normalized}`,
          "error",
          toolsetInfo.manifestPath,
          findLineContaining(toolsetInfo.manifestPath, "openApiSchema"),
        );
        schemaPath = null;
      }
    } else {
      schemaPath = toolsetInfo.autoDetectedSchemaPath;
    }

    const hasOpenApiDir = fs.existsSync(toolsetInfo.openApiDirPath) && fs.statSync(toolsetInfo.openApiDirPath).isDirectory();
    if (hasOpenApiDir && !schemaPath) {
      pushIssue(
        issues,
        "CES_OPENAPI_SCHEMA_NOT_FOUND",
        `Toolset '${toolsetInfo.name}' has open_api_toolset directory but no schema file`,
        "error",
        toolsetInfo.manifestPath,
        findLineContaining(toolsetInfo.manifestPath, "openApiToolset"),
      );
      continue;
    }

    if (!schemaPath) {
      continue;
    }

    const parsed = parseOpenApiFile(schemaPath);
    if (parsed.error) {
      pushIssue(
        issues,
        "CES_OPENAPI_PARSE_ERROR",
        `OpenAPI schema parse error: ${parsed.error}`,
        "error",
        schemaPath,
        1,
      );
      continue;
    }

    if (!isRecord(parsed.data)) {
      pushIssue(
        issues,
        "CES_OPENAPI_INVALID_ROOT",
        "OpenAPI schema root must be an object",
        "error",
        schemaPath,
        1,
      );
      continue;
    }

    if (!("openapi" in parsed.data) && !("swagger" in parsed.data)) {
      pushIssue(
        issues,
        "CES_OPENAPI_VERSION_MISSING",
        "OpenAPI schema must define either 'openapi' or 'swagger' at top level",
        "error",
        schemaPath,
        findLineContaining(schemaPath, /openapi|swagger/),
      );
    }
  }
}

function validateUnsupportedDirectories(model: PackageModel, issues: ValidationIssue[]): void {
  const unsupported = ["evaluationDatasets"];
  const targetFile = model.manifestPath ?? path.join(model.rootPath, "app.yaml");

  for (const dirName of unsupported) {
    if (!model.topLevelDirs.includes(dirName)) {
      continue;
    }

    pushIssue(
      issues,
      "CES_UNSUPPORTED_IMPORT_DIRECTORY",
      `Directory '${dirName}/' is not supported in CES import packages`,
      "error",
      targetFile,
      findLineContaining(targetFile, dirName) ?? 1,
    );
  }
}

function validateNestingDepth(model: PackageModel, issues: ValidationIssue[]): void {
  for (const filePath of model.files) {
    const relativePath = toRelativePath(model.rootPath, filePath);
    const segments = relativePath.split("/").filter((segment) => segment.length > 0);
    if (segments.length < 2) {
      continue;
    }

    const topLevel = segments[0];
    const depth = getDepthBelowTopLevel(relativePath);

    if (["agents", "tools", "examples"].includes(topLevel) && depth > ROOT_DEPTH_LIMIT) {
      pushIssue(
        issues,
        "CES_NESTING_DEPTH_EXCEEDED",
        `${topLevel}/ contains file nested ${depth} levels deep; expected max ${ROOT_DEPTH_LIMIT}`,
        "warning",
        filePath,
        1,
      );
      continue;
    }

    if (topLevel === "toolsets" && depth > TOOLSET_DEPTH_LIMIT) {
      pushIssue(
        issues,
        "CES_TOOLSET_NESTING_DEPTH_EXCEEDED",
        `toolsets/ contains file nested ${depth} levels deep; expected max ${TOOLSET_DEPTH_LIMIT}`,
        "warning",
        filePath,
        1,
      );
      continue;
    }

    if (topLevel === "guardrails" && depth > ROOT_DEPTH_LIMIT) {
      pushIssue(
        issues,
        "CES_GUARDRAIL_NESTING_DEPTH_EXCEEDED",
        `guardrails/ contains file nested ${depth} levels deep; expected max ${ROOT_DEPTH_LIMIT}`,
        "warning",
        filePath,
        1,
      );
    }
  }
}

function validateEnvironment(model: PackageModel, issues: ValidationIssue[]): void {
  if (!model.environment) {
    return;
  }

  if (model.environment.error) {
    pushIssue(
      issues,
      "CES_ENVIRONMENT_PARSE_ERROR",
      `environment.json parse error: ${model.environment.error}`,
      "error",
      model.environment.filePath,
      1,
    );
    return;
  }

  if (!isRecord(model.environment.data)) {
    pushIssue(
      issues,
      "CES_ENVIRONMENT_INVALID_ROOT",
      "environment.json root must be an object",
      "error",
      model.environment.filePath,
      1,
    );
    return;
  }

  const toolsets = model.environment.data.toolsets;
  if (!isRecord(toolsets)) {
    pushIssue(
      issues,
      "CES_ENVIRONMENT_TOOLSETS_INVALID",
      "environment.json must contain a 'toolsets' object",
      "error",
      model.environment.filePath,
      findLineContaining(model.environment.filePath, "toolsets"),
    );
  } else {
    for (const [toolsetName, value] of Object.entries(toolsets)) {
      if (!isRecord(value)) {
        pushIssue(
          issues,
          "CES_ENVIRONMENT_TOOLSET_ENTRY_INVALID",
          `environment.json toolsets.${toolsetName} must be an object`,
          "error",
          model.environment.filePath,
          findLineContaining(model.environment.filePath, toolsetName),
        );
        continue;
      }

      const openApiToolset = value.openApiToolset;
      if (openApiToolset !== undefined && !isRecord(openApiToolset)) {
        pushIssue(
          issues,
          "CES_ENVIRONMENT_OPENAPI_TOOLSET_INVALID",
          `environment.json toolsets.${toolsetName}.openApiToolset must be an object`,
          "error",
          model.environment.filePath,
          findLineContaining(model.environment.filePath, "openApiToolset"),
        );
        continue;
      }

      if (isRecord(openApiToolset) && openApiToolset.url !== undefined && typeof openApiToolset.url !== "string") {
        pushIssue(
          issues,
          "CES_ENVIRONMENT_OPENAPI_URL_INVALID",
          `environment.json toolsets.${toolsetName}.openApiToolset.url must be a string`,
          "error",
          model.environment.filePath,
          findLineContaining(model.environment.filePath, "url"),
        );
      }
    }
  }

  if (containsLocalhostReference(model.environment.data)) {
    pushIssue(
      issues,
      "CES_ENVIRONMENT_LOCALHOST_WARNING",
      "environment.json contains localhost or 127.0.0.1 URLs; use deployed endpoints before import",
      "warning",
      model.environment.filePath,
      1,
    );
  }
}

function validateEvaluations(model: PackageModel, issues: ValidationIssue[]): void {
  if (model.evaluationInfos.length === 0) {
    return;
  }

  for (const evalInfo of model.evaluationInfos) {
    if (evalInfo.manifestError) {
      pushIssue(
        issues,
        "CES_EVALUATION_MANIFEST_INVALID",
        `Evaluation '${evalInfo.name}' manifest error: ${evalInfo.manifestError}`,
        "error",
        evalInfo.manifestPath,
        1,
      );
      continue;
    }

    if (!isRecord(evalInfo.manifestData)) {
      continue;
    }

    const displayName = evalInfo.manifestData.displayName;
    if (typeof displayName === "string" && displayName !== evalInfo.name) {
      pushIssue(
        issues,
        "CES_EVALUATION_DISPLAYNAME_MISMATCH",
        `Evaluation displayName '${displayName}' differs from folder name '${evalInfo.name}'`,
        "warning",
        evalInfo.manifestPath,
        findLineContaining(evalInfo.manifestPath, "displayName"),
      );
    }

    // L-01: toolCall expectations must reference direct tools, not OpenAPI operations
    const golden = evalInfo.manifestData.golden;
    if (!isRecord(golden)) {
      continue;
    }

    const turns = golden.turns;
    if (!Array.isArray(turns)) {
      continue;
    }

    for (let turnIdx = 0; turnIdx < turns.length; turnIdx++) {
      const turn = turns[turnIdx];
      if (!isRecord(turn)) {
        continue;
      }

      const steps = turn.steps;
      if (!Array.isArray(steps)) {
        continue;
      }

      for (const step of steps) {
        if (!isRecord(step)) {
          continue;
        }

        const expectation = step.expectation;
        if (!isRecord(expectation)) {
          continue;
        }

        const toolCall = expectation.toolCall;
        if (!isRecord(toolCall)) {
          continue;
        }

        const toolName = toolCall.tool;
        if (typeof toolName !== "string" || toolName.trim().length === 0) {
          continue;
        }

        if (model.openApiOperations.has(toolName)) {
          pushIssue(
            issues,
            "CES_EVALUATION_TOOLCALL_OPENAPI_OPERATION",
            `Evaluation '${evalInfo.name}' turn ${turnIdx + 1}: toolCall '${toolName}' is an OpenAPI operation, not a direct tool. CES will reject this. (Learning L-01)`,
            "error",
            evalInfo.manifestPath,
            findLineContaining(evalInfo.manifestPath, toolName),
          );
        } else if (model.directTools.size > 0 && !model.directTools.has(toolName)) {
          pushIssue(
            issues,
            "CES_EVALUATION_TOOLCALL_UNKNOWN",
            `Evaluation '${evalInfo.name}' turn ${turnIdx + 1}: toolCall '${toolName}' not found in any agent's tools list. Known tools: [${[...model.directTools].sort().join(", ")}]`,
            "error",
            evalInfo.manifestPath,
            findLineContaining(evalInfo.manifestPath, toolName),
          );
        }
      }
    }
  }
}

function validateInstructions(model: PackageModel, issues: ValidationIssue[]): void {
  if (model.instructionInfos.length === 0) {
    return;
  }

  const agentNames = new Set(model.agentInfos.map((a) => a.name));

  for (const info of model.instructionInfos) {
    // Skip global instruction from structural checks
    if (info.agentName === "__global__") {
      continue;
    }

    if (info.parseError) {
      pushIssue(
        issues,
        "CES_INSTRUCTION_PARSE_ERROR",
        `Instruction parse error for '${info.agentName}': ${info.parseError}`,
        "error",
        info.filePath,
        1,
      );
    }

    // Check required sections
    const sectionNames = new Set(info.sections.map((s) => s.name));
    for (const required of REQUIRED_SECTIONS) {
      if (!sectionNames.has(required)) {
        pushIssue(
          issues,
          "CES_INSTRUCTION_MISSING_SECTION",
          `Instruction for '${info.agentName}' is missing required <${required}> section`,
          "warning",
          info.filePath,
          1,
        );
      }
    }

    // Validate {@AGENT: name} references resolve to known agents
    for (const ref of info.references) {
      if (ref.type === "agent" && !agentNames.has(ref.name)) {
        pushIssue(
          issues,
          "CES_INSTRUCTION_AGENT_REF_UNKNOWN",
          `Instruction for '${info.agentName}' references unknown agent '${ref.name}' at line ${ref.line}`,
          "error",
          info.filePath,
          ref.line,
        );
      }
    }

    // Validate {@TOOL: name} references resolve to known direct tools
    for (const ref of info.references) {
      if (ref.type === "tool" && model.directTools.size > 0 && !model.directTools.has(ref.name)) {
        pushIssue(
          issues,
          "CES_INSTRUCTION_TOOL_REF_UNKNOWN",
          `Instruction for '${info.agentName}' references unknown tool '${ref.name}' at line ${ref.line}`,
          "warning",
          info.filePath,
          ref.line,
        );
      }
    }

    // Validate tool_call() operations in examples
    for (const call of info.toolCalls) {
      const parts = call.operation.split(".");
      const toolsetName = parts.length > 1 ? parts[0] : null;
      const opName = parts.length > 1 ? parts[1] : parts[0];

      // Check if toolset prefix matches a known toolset
      if (toolsetName) {
        const toolsetNames = new Set(model.toolsetInfos.map((t) => t.name));
        if (!toolsetNames.has(toolsetName)) {
          pushIssue(
            issues,
            "CES_INSTRUCTION_TOOLCALL_UNKNOWN_TOOLSET",
            `Instruction for '${info.agentName}': tool_call '${call.operation}' references unknown toolset '${toolsetName}' at line ${call.line}`,
            "warning",
            info.filePath,
            call.line,
          );
        }
      } else if (opName && model.directTools.size > 0 && !model.directTools.has(opName)) {
        pushIssue(
          issues,
          "CES_INSTRUCTION_TOOLCALL_UNKNOWN_TOOL",
          `Instruction for '${info.agentName}': tool_call '${call.operation}' is not a known direct tool at line ${call.line}`,
          "warning",
          info.filePath,
          call.line,
        );
      }
    }
  }
}

function resolveGuardrailManifestPath(rootPath: string, displayName: string): string | null {
  const candidates = new Set<string>([
    displayName,
    displayName.replace(/\s+/g, "_"),
  ]);

  for (const candidate of candidates) {
    const nestedPath = path.join(rootPath, "guardrails", candidate, `${candidate}.json`);
    if (fs.existsSync(nestedPath)) {
      return nestedPath;
    }

    const flatPath = path.join(rootPath, "guardrails", `${candidate}.json`);
    if (fs.existsSync(flatPath)) {
      return flatPath;
    }
  }

  return null;
}

function readDeclaredSchemaPath(toolsetManifest: Record<string, unknown> | null): string | null {
  if (!isRecord(toolsetManifest)) {
    return null;
  }

  const openApiToolset = toolsetManifest.openApiToolset;
  if (!isRecord(openApiToolset)) {
    return null;
  }

  return typeof openApiToolset.openApiSchema === "string"
    ? openApiToolset.openApiSchema
    : null;
}

function extractToolsetName(toolsetEntry: unknown): string | null {
  if (typeof toolsetEntry === "string") {
    return toolsetEntry;
  }

  if (isRecord(toolsetEntry) && typeof toolsetEntry.toolset === "string") {
    return toolsetEntry.toolset;
  }

  return null;
}

function containsLocalhostReference(value: unknown): boolean {
  if (typeof value === "string") {
    return /localhost|127\.0\.0\.1/i.test(value);
  }

  if (Array.isArray(value)) {
    return value.some((entry) => containsLocalhostReference(entry));
  }

  if (isRecord(value)) {
    return Object.values(value).some((entry) => containsLocalhostReference(entry));
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pushIssue(
  issues: ValidationIssue[],
  code: string,
  message: string,
  severity: ValidationSeverity,
  file: string,
  line?: number,
): void {
  issues.push({
    code,
    message,
    severity,
    file,
    line,
  });
}
