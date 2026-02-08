/*
 * Created by Codex on 2026-02-08.
 * JSON/YAML/OpenAPI parse utilities.
 */

import * as fs from "fs";
import * as path from "path";
import { parseDocument } from "yaml";
import { ParsedResult } from "./types";

export function parseJsonFile(filePath: string): ParsedResult<Record<string, unknown>> {
  try {
    const rawText = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(rawText) as unknown;
    if (!isRecord(parsed)) {
      return { data: null, error: "JSON root must be an object", rawText };
    }

    return { data: parsed, rawText };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unknown JSON parse error",
    };
  }
}

export function parseYamlFile(filePath: string): ParsedResult<Record<string, unknown>> {
  try {
    const rawText = fs.readFileSync(filePath, "utf8");
    const document = parseDocument(rawText, { prettyErrors: false });

    if (document.errors.length > 0) {
      const messages = document.errors.map((entry) => entry.message).join("; ");
      return { data: null, error: messages, rawText };
    }

    const parsed = document.toJS() as unknown;
    if (!isRecord(parsed)) {
      return { data: null, error: "YAML root must be an object", rawText };
    }

    return { data: parsed, rawText };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unknown YAML parse error",
    };
  }
}

export function parseFileByExtension(filePath: string): ParsedResult<Record<string, unknown>> {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".json") {
    return parseJsonFile(filePath);
  }

  if (extension === ".yaml" || extension === ".yml") {
    return parseYamlFile(filePath);
  }

  return {
    data: null,
    error: `Unsupported file extension for parse: ${extension}`,
  };
}

export function parseOpenApiFile(filePath: string): ParsedResult<Record<string, unknown>> {
  return parseFileByExtension(filePath);
}

export function findLineContaining(filePath: string, token: string | RegExp): number | undefined {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (typeof token === "string") {
        if (line.includes(token)) {
          return index + 1;
        }
      } else if (token.test(line)) {
        return index + 1;
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
