/*
 * Created by Augment Agent on 2026-02-08.
 * Parser for CES instruction.txt files.
 * Extracts XML-like sections, {@AGENT:} / {@TOOL:} references, and tool_call() patterns.
 */

import * as fs from "fs";
import { InstructionInfo, InstructionReference, InstructionSection, InstructionToolCall } from "./types";

export const KNOWN_SECTIONS = ["role", "persona", "constraints", "taskflow", "examples"] as const;
export const REQUIRED_SECTIONS = ["role"] as const;

const SECTION_OPEN_RE = /^<(role|persona|constraints|taskflow|examples)>/i;
const SECTION_CLOSE_RE = /<\/(role|persona|constraints|taskflow|examples)>/i;
const AGENT_REF_RE = /\{@AGENT:\s*([^}]+)\}/g;
const TOOL_REF_RE = /\{@TOOL:\s*([^}]+)\}/g;
const TOOL_CALL_RE = /([a-zA-Z_][a-zA-Z0-9_.]*)\(([^)]*)\)/g;

/**
 * Parse an instruction.txt file and extract its structural metadata.
 */
export function parseInstructionFile(filePath: string, agentName: string): InstructionInfo {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return {
      agentName,
      filePath,
      sections: [],
      references: [],
      toolCalls: [],
      parseError: error instanceof Error ? error.message : "Failed to read instruction file",
    };
  }

  const lines = content.split(/\r?\n/);
  const sections: InstructionSection[] = [];
  const references: InstructionReference[] = [];
  const toolCalls: InstructionToolCall[] = [];
  const openSections: Array<{ name: string; startLine: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const trimmed = line.trim();
    const lineNumber = i + 1;

    // Check for section opening tags
    const openMatch = SECTION_OPEN_RE.exec(trimmed);
    if (openMatch) {
      openSections.push({ name: openMatch[1].toLowerCase(), startLine: lineNumber });
    }

    // Check for section closing tags
    const closeMatch = SECTION_CLOSE_RE.exec(trimmed);
    if (closeMatch) {
      const closeName = closeMatch[1].toLowerCase();
      const openIdx = findLastOpenSection(openSections, closeName);
      if (openIdx !== -1) {
        const open = openSections[openIdx];
        sections.push({
          name: open.name,
          startLine: open.startLine,
          endLine: lineNumber,
        });
        openSections.splice(openIdx, 1);
      }
    }

    // Extract {@AGENT: name} references
    let agentMatch: RegExpExecArray | null;
    AGENT_REF_RE.lastIndex = 0;
    while ((agentMatch = AGENT_REF_RE.exec(line)) !== null) {
      references.push({
        type: "agent",
        name: agentMatch[1].trim(),
        line: lineNumber,
      });
    }

    // Extract {@TOOL: name} references
    let toolMatch: RegExpExecArray | null;
    TOOL_REF_RE.lastIndex = 0;
    while ((toolMatch = TOOL_REF_RE.exec(line)) !== null) {
      references.push({
        type: "tool",
        name: toolMatch[1].trim(),
        line: lineNumber,
      });
    }

    // Extract tool_call() patterns only inside <examples> sections
    if (isInsideSection(openSections, "examples")) {
      TOOL_CALL_RE.lastIndex = 0;
      let callMatch: RegExpExecArray | null;
      while ((callMatch = TOOL_CALL_RE.exec(line)) !== null) {
        const operation = callMatch[1];
        // Skip common false positives (XML tag content, generic words)
        if (isLikelyToolCall(operation)) {
          toolCalls.push({ operation, line: lineNumber });
        }
      }
    }
  }

  // Mark unclosed sections as errors
  const parseError = openSections.length > 0
    ? `Unclosed section(s): ${openSections.map((s) => `<${s.name}> at line ${s.startLine}`).join(", ")}`
    : undefined;

  return {
    agentName,
    filePath,
    sections,
    references,
    toolCalls,
    parseError,
  };
}

function findLastOpenSection(openSections: Array<{ name: string; startLine: number }>, name: string): number {
  for (let i = openSections.length - 1; i >= 0; i--) {
    if (openSections[i].name === name) {
      return i;
    }
  }
  return -1;
}

function isInsideSection(openSections: Array<{ name: string; startLine: number }>, sectionName: string): boolean {
  return openSections.some((s) => s.name === sectionName);
}

/**
 * Filter out false-positive tool_call matches.
 * Rejects common non-tool patterns like XML tag names, plain words, etc.
 */
function isLikelyToolCall(operation: string): boolean {
  // Must contain a dot (toolset.operation) or start with a known prefix
  // or at least look like a function name (not a tag name)
  const FALSE_POSITIVES = new Set([
    "e", "g", "name", "step", "action", "trigger", "subtask",
    "user", "agent", "example", "tool_call", "i", "s", "t",
  ]);

  if (FALSE_POSITIVES.has(operation.toLowerCase())) {
    return false;
  }

  // Likely a tool call if it contains a dot (toolset.operation pattern)
  if (operation.includes(".")) {
    return true;
  }

  // Also accept camelCase or snake_case function names that are long enough
  return operation.length >= 3 && /[a-z]/.test(operation) && /[A-Z_]/.test(operation);
}
