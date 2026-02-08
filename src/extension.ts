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
    vscode.languages.setTextDocumentLanguage(document, "ces-instruction");
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const collection = vscode.languages.createDiagnosticCollection("ces-validator");
  const orchestrator = new ValidationOrchestrator(collection);
  const treeProvider = new CesPackageTreeProvider();

  context.subscriptions.push(collection);

  // Force-set language for any already-open instruction.txt files
  for (const document of vscode.workspace.textDocuments) {
    setLanguageForInstructions(document);
  }

  // Set language when new documents are opened
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      setLanguageForInstructions(document);
    }),
  );

  // Register the sidebar tree view
  const treeView = vscode.window.createTreeView("cesPackageExplorer", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Refresh tree whenever validation runs
  context.subscriptions.push(
    orchestrator.onDidValidate((roots) => {
      treeProvider.setPackageRoots(roots);
      treeProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cesValidator.refreshTree", async () => {
      await orchestrator.validateAllPackages();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cesValidator.validateCurrentPackage", async () => {
      const activeUri = vscode.window.activeTextEditor?.document.uri;
      if (activeUri) {
        await orchestrator.validatePackageForUri(activeUri);
        return;
      }

      await orchestrator.validateAllPackages();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cesValidator.clearDiagnostics", () => {
      orchestrator.clearDiagnostics();
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (document) => {
      if (!orchestrator.isRelevantUri(document.uri)) {
        return;
      }

      await orchestrator.validatePackageForUri(document.uri);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (!orchestrator.isRelevantUri(document.uri)) {
        return;
      }

      orchestrator.scheduleValidationForUri(document.uri);
    }),
  );

  const watcher = vscode.workspace.createFileSystemWatcher("**/*");
  const handleFsEvent = (uri: vscode.Uri): void => {
    if (!orchestrator.isRelevantUri(uri)) {
      return;
    }

    orchestrator.scheduleValidationForUri(uri);
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

  await orchestrator.validateAllPackages();
}

export function deactivate(): void {
  // No-op. VS Code disposes registrations via context subscriptions.
}
