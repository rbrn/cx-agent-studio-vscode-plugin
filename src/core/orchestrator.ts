/*
 * Created by Codex on 2026-02-08.
 * Validation orchestration and debouncing.
 */

import * as path from "path";
import * as vscode from "vscode";
import { buildPackageModel } from "./packageIndex";
import { findPackageRootForPath, findPackageRoots, isRelevantUri } from "./packageDiscovery";
import { groupIssuesByFile, toDiagnostic } from "./diagnostics";
import { runRules } from "./rules";
import { ValidationIssue } from "./types";

export class ValidationOrchestrator {
  private readonly packageIssues = new Map<string, ValidationIssue[]>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private knownRoots: string[] = [];

  private readonly _onDidValidate = new vscode.EventEmitter<string[]>();
  /** Fires after any validation pass, with the current list of package roots. */
  public readonly onDidValidate = this._onDidValidate.event;

  /** Returns the package root paths discovered in the most recent scan. */
  public getPackageRoots(): string[] {
    return [...this.knownRoots];
  }

  public constructor(private readonly collection: vscode.DiagnosticCollection) {}

  public async validateAllPackages(): Promise<void> {
    const roots = await findPackageRoots();
    this.knownRoots = roots;
    const activeRoots = new Set(roots);

    for (const root of roots) {
      this.validatePackageRoot(root);
    }

    for (const root of [...this.packageIssues.keys()]) {
      if (!activeRoots.has(root)) {
        this.packageIssues.delete(root);
      }
    }

    this.applyDiagnostics();
    this._onDidValidate.fire(this.knownRoots);
  }

  public async validatePackageForUri(uri: vscode.Uri): Promise<void> {
    const root = findPackageRootForPath(uri.fsPath);
    if (!root) {
      return;
    }

    this.validatePackageRoot(root);
    this.applyDiagnostics();
    this._onDidValidate.fire(this.knownRoots);
  }

  public scheduleValidationForUri(uri: vscode.Uri, delayMs = 250): void {
    if (!isRelevantUri(uri)) {
      return;
    }

    const root = findPackageRootForPath(uri.fsPath);
    if (!root) {
      return;
    }

    this.scheduleValidationForRoot(root, delayMs);
  }

  public scheduleValidationForRoot(rootPath: string, delayMs = 250): void {
    const existingTimer = this.debounceTimers.get(rootPath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.validatePackageRoot(rootPath);
      this.applyDiagnostics();
      this._onDidValidate.fire(this.knownRoots);
      this.debounceTimers.delete(rootPath);
    }, delayMs);

    this.debounceTimers.set(rootPath, timer);
  }

  public isRelevantUri(uri: vscode.Uri): boolean {
    return isRelevantUri(uri);
  }

  public clearDiagnostics(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }

    this.debounceTimers.clear();
    this.packageIssues.clear();
    this.collection.clear();
  }

  private validatePackageRoot(rootPath: string): void {
    try {
      const model = buildPackageModel(rootPath);
      const issues = runRules(model);
      this.packageIssues.set(rootPath, issues);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown validation runtime error";
      this.packageIssues.set(rootPath, [
        {
          code: "CES_VALIDATOR_RUNTIME_ERROR",
          message,
          severity: "error",
          file: path.join(rootPath, "app.yaml"),
          line: 1,
        },
      ]);
    }
  }

  private applyDiagnostics(): void {
    this.collection.clear();

    const combinedIssues: ValidationIssue[] = [];
    for (const issues of this.packageIssues.values()) {
      combinedIssues.push(...issues);
    }

    const grouped = groupIssuesByFile(combinedIssues);
    for (const [filePath, issues] of grouped.entries()) {
      const diagnostics = issues.map((issue) => toDiagnostic(issue));
      this.collection.set(vscode.Uri.file(filePath), diagnostics);
    }
  }
}
