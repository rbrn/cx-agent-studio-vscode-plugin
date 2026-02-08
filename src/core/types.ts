/*
 * Created by Codex on 2026-02-08.
 * Core types for CES package validation.
 */

export type ManifestFormat = "json" | "yaml" | "none";
export type ValidationSeverity = "error" | "warning";

export interface ValidationRelatedInfo {
  file: string;
  message: string;
  line?: number;
  column?: number;
}

export interface ValidationIssue {
  code: string;
  message: string;
  severity: ValidationSeverity;
  file: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  related?: ValidationRelatedInfo[];
}

export interface ParsedResult<T> {
  data: T | null;
  error?: string;
  rawText?: string;
}

export interface AgentInfo {
  name: string;
  dirPath: string;
  manifestPath: string;
  manifestData: Record<string, unknown> | null;
  manifestError?: string;
}

export interface ToolsetInfo {
  name: string;
  dirPath: string;
  manifestPath: string;
  manifestData: Record<string, unknown> | null;
  manifestError?: string;
  openApiDirPath: string;
  autoDetectedSchemaPath: string | null;
}

export interface EvaluationInfo {
  name: string;
  dirPath: string;
  manifestPath: string;
  manifestData: Record<string, unknown> | null;
  manifestError?: string;
}

export interface InstructionSection {
  name: string;
  startLine: number;
  endLine: number;
}

export interface InstructionReference {
  type: "agent" | "tool";
  name: string;
  line: number;
}

export interface InstructionToolCall {
  operation: string;
  line: number;
}

export interface InstructionInfo {
  agentName: string;
  filePath: string;
  sections: InstructionSection[];
  references: InstructionReference[];
  toolCalls: InstructionToolCall[];
  parseError?: string;
}

export interface EnvironmentInfo {
  filePath: string;
  data: Record<string, unknown> | null;
  error?: string;
}

export interface PackageModel {
  rootPath: string;
  hasAppJson: boolean;
  hasAppYaml: boolean;
  manifestPath: string | null;
  manifestFormat: ManifestFormat;
  manifestData: Record<string, unknown> | null;
  manifestError?: string;
  files: string[];
  directories: string[];
  topLevelFiles: string[];
  topLevelDirs: string[];
  agentInfos: AgentInfo[];
  toolsetInfos: ToolsetInfo[];
  evaluationInfos: EvaluationInfo[];
  instructionInfos: InstructionInfo[];
  guardrailDirs: string[];
  environment: EnvironmentInfo | null;
  directTools: Set<string>;
  openApiOperations: Set<string>;
}
