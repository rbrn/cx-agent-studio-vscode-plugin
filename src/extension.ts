/*
 * Created by Codex on 2026-02-08.
 * VS Code extension entrypoint for CES validator.
 */

import * as vscode from "vscode";
import { ValidationOrchestrator } from "./core/orchestrator";
import { CesPackageTreeProvider } from "./core/treeProvider";

const INSTRUCTION_PATTERN = /[\/\\]agents[\/\\][^\/\\]+[\/\\]instruction\.txt$/;
const GLOBAL_INSTRUCTION_PATTERN = /[\/\\]global_instruction\.txt$/;

function isCesInstruction(uri: vscode.Uri): boolean {
  const fsPath = uri.fsPath;
  return INSTRUCTION_PATTERN.test(fsPath) || GLOBAL_INSTRUCTION_PATTERN.test(fsPath);
}

function setLanguageForInstructions(document: vscode.TextDocument): void {
  if (document.languageId !== "ces-instruction" && isCesInstruction(document.uri)) {
    vscode.languages.setTextDocumentLanguage(document, "ces-instruction").then(
      undefined,
      () => { /* language not yet registered — ignore */ },
    );
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel("CES Validator");
  context.subscriptions.push(outputChannel);

  let orchestrator: ValidationOrchestrator;
  let treeProvider: CesPackageTreeProvider;

  try {
    const collection = vscode.languages.createDiagnosticCollection("ces-validator");
    orchestrator = new ValidationOrchestrator(collection);
    treeProvider = new CesPackageTreeProvider();

    context.subscriptions.push(collection);

    // ── 1. Register tree view + commands synchronously (MUST NOT throw) ──

    const treeView = vscode.window.createTreeView("cesPackageExplorer", {
      treeDataProvider: treeProvider,
      showCollapseAll: true,
    });
    context.subscriptions.push(treeView);

    context.subscriptions.push(
      orchestrator.onDidValidate((roots) => {
        treeProvider.setPackageRoots(roots);
        treeProvider.refresh();
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("cesValidator.refreshTree", async () => {
        try {
          await orchestrator.validateAllPackages();
        } catch (err) {
          outputChannel.appendLine(`[CES] refreshTree error: ${err}`);
        }
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("cesValidator.validateCurrentPackage", async () => {
        try {
          const activeUri = vscode.window.activeTextEditor?.document.uri;
          if (activeUri) {
            await orchestrator.validatePackageForUri(activeUri);
            return;
          }
          await orchestrator.validateAllPackages();
        } catch (err) {
          outputChannel.appendLine(`[CES] validateCurrentPackage error: ${err}`);
        }
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("cesValidator.clearDiagnostics", () => {
        orchestrator.clearDiagnostics();
      }),
    );

    // ── 2. Instruction language detection ────────────────────────────────

    for (const document of vscode.workspace.textDocuments) {
      setLanguageForInstructions(document);
    }

    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((document) => {
        setLanguageForInstructions(document);

        if (orchestrator.isRelevantUri(document.uri)) {
          orchestrator.validatePackageForUri(document.uri).catch((err) => {
            outputChannel.appendLine(`[CES] onDidOpen validation error: ${err}`);
          });
        }
      }),
    );

    // ── 3. File watchers ─────────────────────────────────────────────────

    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (orchestrator.isRelevantUri(document.uri)) {
          orchestrator.scheduleValidationForUri(document.uri);
        }
      }),
    );

    const watcher = vscode.workspace.createFileSystemWatcher("**/*");
    const handleFsEvent = (uri: vscode.Uri): void => {
      if (orchestrator.isRelevantUri(uri)) {
        orchestrator.scheduleValidationForUri(uri);
      }
    };

    context.subscriptions.push(
      watcher,
      watcher.onDidCreate(handleFsEvent),
      watcher.onDidChange(handleFsEvent),
      watcher.onDidDelete(handleFsEvent),
    );

    context.subscriptions.push(
      vscode.workspace.onDidRenameFiles((event) => {
        for (const rename of event.files) {
          if (orchestrator.isRelevantUri(rename.oldUri)) {
            orchestrator.scheduleValidationForUri(rename.oldUri);
          }
          if (orchestrator.isRelevantUri(rename.newUri)) {
            orchestrator.scheduleValidationForUri(rename.newUri);
          }
        }
      }),
    );

  } catch (err) {
    // Activation MUST NOT throw — log and return gracefully
    outputChannel.appendLine(`[CES] Activation error (sync): ${err}`);
    outputChannel.show(true);
    return;
  }

  // ── 4. Initial scan (async, fire-and-forget — never rejects activate) ──

  orchestrator.validateAllPackages().catch((err) => {
    outputChannel.appendLine(`[CES] Initial scan error: ${err}`);
  });
}

export function deactivate(): void {
  // No-op. VS Code disposes registrations via context subscriptions.
}
