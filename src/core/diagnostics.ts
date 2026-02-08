/*
 * Created by Codex on 2026-02-08.
 * Diagnostic mapping helpers.
 */

import * as vscode from "vscode";
import { ValidationIssue } from "./types";

export function toDiagnostic(issue: ValidationIssue): vscode.Diagnostic {
  const startLine = Math.max(0, (issue.line ?? 1) - 1);
  const startColumn = Math.max(0, (issue.column ?? 1) - 1);

  const endLine = Math.max(startLine, (issue.endLine ?? issue.line ?? 1) - 1);
  const endColumn = Math.max(startColumn + 1, (issue.endColumn ?? (issue.column ?? 1)));

  const range = new vscode.Range(
    new vscode.Position(startLine, startColumn),
    new vscode.Position(endLine, endColumn),
  );

  const diagnostic = new vscode.Diagnostic(
    range,
    issue.message,
    issue.severity === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
  );

  diagnostic.code = issue.code;
  diagnostic.source = "ces-validator";

  if (issue.related && issue.related.length > 0) {
    diagnostic.relatedInformation = issue.related.map((entry) => {
      const line = Math.max(0, (entry.line ?? 1) - 1);
      const column = Math.max(0, (entry.column ?? 1) - 1);
      const relatedRange = new vscode.Range(line, column, line, column + 1);

      return new vscode.DiagnosticRelatedInformation(
        new vscode.Location(vscode.Uri.file(entry.file), relatedRange),
        entry.message,
      );
    });
  }

  return diagnostic;
}

export function groupIssuesByFile(issues: ValidationIssue[]): Map<string, ValidationIssue[]> {
  const grouped = new Map<string, ValidationIssue[]>();

  for (const issue of issues) {
    const current = grouped.get(issue.file) ?? [];
    current.push(issue);
    grouped.set(issue.file, current);
  }

  return grouped;
}
