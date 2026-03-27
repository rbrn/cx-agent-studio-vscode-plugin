/*
 * Created by Codex on 2026-03-27.
 * Shared instruction contract loader for declarative CES prompt structure rules.
 */

import * as fs from "fs";
import * as path from "path";
import { InstructionInfo, ValidationSeverity } from "./types";

export interface InstructionStructureRule {
  id: string;
  pathPatterns: string[];
  allowedSectionOrders: string[][];
  requireNonEmptyExamples: boolean;
}

export interface InstructionRuleSet {
  version: number;
  contracts: InstructionStructureRule[];
}

export interface InstructionContractFinding {
  code: string;
  message: string;
  severity: ValidationSeverity;
  line?: number;
}

let cachedRuleSet: InstructionRuleSet | null = null;

export function loadInstructionRuleSet(): InstructionRuleSet {
  if (cachedRuleSet) {
    return cachedRuleSet;
  }

  const rulePath = path.join(__dirname, "..", "..", "contracts", "instruction-contract-rules.json");
  const raw = JSON.parse(fs.readFileSync(rulePath, "utf8")) as {
    version: number;
    contracts: Array<{
      id: string;
      pathPatterns: string[];
      allowedSectionOrders: string[][];
      requireNonEmptyExamples?: boolean;
    }>;
  };

  cachedRuleSet = {
    version: raw.version,
    contracts: raw.contracts.map((contract) => ({
      id: contract.id,
      pathPatterns: contract.pathPatterns.map(normalizeContractPath),
      allowedSectionOrders: contract.allowedSectionOrders.map((order) => [...order]),
      requireNonEmptyExamples: Boolean(contract.requireNonEmptyExamples),
    })),
  };
  return cachedRuleSet;
}

export function findMatchingInstructionRule(
  relativePath: string,
  ruleSet: InstructionRuleSet = loadInstructionRuleSet(),
): InstructionStructureRule | undefined {
  const normalizedPath = normalizeContractPath(relativePath);
  return ruleSet.contracts.find((contract) =>
    contract.pathPatterns.some((pattern) => globMatches(normalizedPath, pattern)),
  );
}

export function validateInstructionStructure(
  info: InstructionInfo,
  relativePath: string,
  ruleSet: InstructionRuleSet = loadInstructionRuleSet(),
): InstructionContractFinding[] {
  const findings: InstructionContractFinding[] = [];
  const rule = findMatchingInstructionRule(relativePath, ruleSet);
  if (!rule) {
    findings.push({
      code: "CES_INSTRUCTION_CONTRACT_MISSING",
      message: `No instruction contract matched '${normalizeContractPath(relativePath)}'`,
      severity: "warning",
      line: 1,
    });
    return findings;
  }

  const actualOrder = info.sections.map((section) => section.name);
  if (!rule.allowedSectionOrders.some((candidate) => arraysEqual(candidate, actualOrder))) {
    const expectedOrder = bestMatchingSectionOrder(actualOrder, rule.allowedSectionOrders);
    const actualNames = new Set(actualOrder);
    const expectedNames = new Set(expectedOrder);

    for (const missing of expectedOrder) {
      if (!actualNames.has(missing)) {
        findings.push({
          code: "CES_INSTRUCTION_MISSING_SECTION",
          message:
            `Instruction for '${info.agentName}' is missing required <${missing}> ` +
            `section required by contract '${rule.id}'`,
          severity: "error",
          line: 1,
        });
      }
    }

    for (const unexpected of actualOrder) {
      if (!expectedNames.has(unexpected)) {
        const section = info.sections.find((entry) => entry.name === unexpected);
        findings.push({
          code: "CES_INSTRUCTION_UNEXPECTED_SECTION",
          message:
            `Instruction for '${info.agentName}' has unexpected <${unexpected}> ` +
            `section for contract '${rule.id}'`,
          severity: "error",
          line: section?.startLine ?? 1,
        });
      }
    }

    if (setEquals(actualNames, expectedNames) || actualOrder.length !== actualNames.size) {
      findings.push({
        code: "CES_INSTRUCTION_SECTION_ORDER_INVALID",
        message:
          `Instruction for '${info.agentName}' has section order ${JSON.stringify(actualOrder)} ` +
          `but expected one of ${JSON.stringify(rule.allowedSectionOrders)}`,
        severity: "error",
        line: 1,
      });
    }
  }

  if (rule.requireNonEmptyExamples && actualOrder.includes("examples") && info.exampleCount === 0) {
    const section = info.sections.find((entry) => entry.name === "examples");
    findings.push({
      code: "CES_INSTRUCTION_EXAMPLES_EMPTY",
      message: `Instruction for '${info.agentName}' has an empty <examples> section`,
      severity: "error",
      line: section?.startLine ?? 1,
    });
  }

  return findings;
}

function bestMatchingSectionOrder(actualOrder: string[], allowedOrders: string[][]): string[] {
  let bestOrder = allowedOrders[0] ?? [];
  let bestScore: [number, number, number] | null = null;
  const actualNames = new Set(actualOrder);

  for (const candidate of allowedOrders) {
    const candidateNames = new Set(candidate);
    const missingCount = [...candidateNames].filter((name) => !actualNames.has(name)).length;
    const unexpectedCount = [...actualNames].filter((name) => !candidateNames.has(name)).length;
    const prefixMatch = commonPrefixLength(actualOrder, candidate);
    const score: [number, number, number] = [
      missingCount + unexpectedCount,
      -prefixMatch,
      Math.abs(candidate.length - actualOrder.length),
    ];
    if (!bestScore || compareScore(score, bestScore) < 0) {
      bestScore = score;
      bestOrder = candidate;
    }
  }

  return bestOrder;
}

function compareScore(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

function commonPrefixLength(left: string[], right: string[]): number {
  let count = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) {
      break;
    }
    count += 1;
  }
  return count;
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function setEquals(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

function normalizeContractPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function globMatches(value: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]+");
  return new RegExp(`^${escaped}$`).test(value);
}
