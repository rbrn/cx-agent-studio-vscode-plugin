#!/usr/bin/env node
/*
 * CLI entry point for CES package validation.
 * Runs the same rule engine as the VS Code extension, from the terminal.
 *
 * Usage:
 *   node dist/cli.js [package-dir]
 *   npx ces-validate [package-dir]
 *
 * Exit codes:
 *   0 = All checks passed (warnings allowed)
 *   1 = One or more errors found
 *
 * Created by Augment Agent on 2026-02-08.
 */

import * as fs from "fs";
import * as path from "path";
import { buildPackageModel } from "./core/packageIndex";
import { runRules } from "./core/rules";
import { ValidationIssue } from "./core/types";

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function resolvePackageDir(args: string[]): string {
  if (args.length > 0 && args[0] && !args[0].startsWith("-")) {
    return path.resolve(args[0]);
  }

  // Auto-discover: walk up from cwd looking for app.json or app.yaml
  let dir = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(dir, "app.yaml")) || fs.existsSync(path.join(dir, "app.json"))) {
      return dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }

    dir = parent;
  }

  // Fallback: look for acme_voice_agent/ relative to cwd
  const candidate = path.join(process.cwd(), "acme_voice_agent");
  if (fs.existsSync(path.join(candidate, "app.json")) || fs.existsSync(path.join(candidate, "app.yaml"))) {
    return candidate;
  }

  return process.cwd();
}

function printIssue(issue: ValidationIssue, rootPath: string): void {
  const severity = issue.severity === "error"
    ? `${RED}ERROR${RESET}`
    : `${YELLOW}WARN${RESET}`;

  const relFile = path.relative(rootPath, issue.file);
  const location = issue.line ? `${relFile}:${issue.line}` : relFile;

  console.log(`  ${severity}  ${DIM}[${issue.code}]${RESET} ${location}`);
  console.log(`         ${issue.message}`);
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: ces-validate [package-dir]");
    console.log("");
    console.log("Validates a CES / CX Agent Studio package directory.");
    console.log("If no directory is given, auto-discovers from cwd.");
    console.log("");
    console.log("Exit codes:");
    console.log("  0 = All checks passed");
    console.log("  1 = Errors found");
    process.exit(0);
  }

  const packageDir = resolvePackageDir(args);

  console.log(`${BOLD}=== CES Package Validator ===${RESET}`);
  console.log(`  Package: ${packageDir}`);
  console.log();

  if (!fs.existsSync(packageDir) || !fs.statSync(packageDir).isDirectory()) {
    console.log(`${RED}ERROR:${RESET} Directory not found: ${packageDir}`);
    process.exit(1);
  }

  const model = buildPackageModel(packageDir);
  const issues = runRules(model);

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  // Print tool inventory summary
  if (model.directTools.size > 0 || model.openApiOperations.size > 0) {
    console.log(`${BOLD}Tool Inventory${RESET}`);
    console.log(`  Direct tools:      [${[...model.directTools].sort().join(", ")}]`);
    console.log(`  OpenAPI operations: [${[...model.openApiOperations].sort().join(", ")}]`);
    console.log();
  }

  // Print evaluation summary
  if (model.evaluationInfos.length > 0) {
    console.log(`${BOLD}Evaluations${RESET}`);
    console.log(`  ${model.evaluationInfos.length} evaluation(s) found`);
    console.log();
  }

  if (issues.length === 0) {
    console.log(`${GREEN}${BOLD}ALL CHECKS PASSED${RESET}`);
    process.exit(0);
  }

  if (errors.length > 0) {
    console.log(`${BOLD}Errors (${errors.length})${RESET}`);
    for (const issue of errors) {
      printIssue(issue, packageDir);
    }
    console.log();
  }

  if (warnings.length > 0) {
    console.log(`${BOLD}Warnings (${warnings.length})${RESET}`);
    for (const issue of warnings) {
      printIssue(issue, packageDir);
    }
    console.log();
  }

  if (errors.length > 0) {
    console.log(`${RED}${BOLD}FAILED:${RESET} ${errors.length} error(s), ${warnings.length} warning(s)`);
    process.exit(1);
  }

  console.log(`${GREEN}${BOLD}PASSED${RESET} with ${warnings.length} warning(s)`);
  process.exit(0);
}

main();
