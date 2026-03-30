/*
 * Created by Codex on 2026-02-08.
 * VS Code extension entrypoint for CES validator.
 */

import * as path from "path";
import * as vscode from "vscode";
import { loadDeploymentEnvDefaults, mergeDeploymentDefaults } from "./core/envDefaults";
import { DeploymentValidationError, CesImportOptions, importPackageToCes, packageCesPackage } from "./core/deployment";
import {
  IncrementalCesTargetOptions,
  PreparedIncrementalDeployment,
  applyPreparedIncrementalDeployment,
  finalizePreparedIncrementalDeployment,
  loadDeploymentStatusSummary,
  prepareIncrementalDeployment,
} from "./core/incrementalDeployment";
import { findPackageRootForPath } from "./core/packageDiscovery";
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

type StoredImportProfile = {
  projectId?: string;
  location?: string;
  appId?: string;
  displayName?: string;
  importStrategy?: "REPLACE" | "OVERWRITE";
  ignoreAppLock?: boolean;
};

const BINARY_LIKE_EXTENSIONS = new Set([".pyc", ".pyo", ".zip", ".vsix"]);

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
      vscode.commands.registerCommand("cesValidator.openResource", async (target: { filePath?: string; line?: number } | undefined) => {
        if (!target?.filePath) {
          return;
        }

        const targetUri = vscode.Uri.file(target.filePath);
        try {
          const document = await vscode.workspace.openTextDocument(targetUri);
          await vscode.window.showTextDocument(document, {
            preview: false,
            selection: typeof target.line === "number"
              ? new vscode.Range(target.line - 1, 0, target.line - 1, 0)
              : undefined,
          });
        } catch (err) {
          if (isLikelyBinaryResource(target.filePath)) {
            outputChannel.appendLine(`[CES] openResource fallback: revealing non-text file ${target.filePath}`);
            await vscode.commands.executeCommand("revealFileInOS", targetUri);
            void vscode.window.showWarningMessage(
              `Cannot open '${path.basename(target.filePath)}' as text. Revealed it in Finder instead.`,
            );
            return;
          }

          outputChannel.appendLine(`[CES] openResource error: ${err}`);
        }
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

    context.subscriptions.push(
      vscode.commands.registerCommand("cesValidator.packageCurrentPackage", async () => {
        const rootPath = await resolveTargetPackageRoot(orchestrator);
        if (!rootPath) {
          return;
        }

        outputChannel.show(true);
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Packaging CES package '${path.basename(rootPath)}'`,
            cancellable: false,
          },
          async (progress) => {
            progress.report({ message: "Validating package" });
            try {
              const result = await packageCesPackage(rootPath);
              outputChannel.appendLine(`[CES] Packaged ${rootPath}`);
              outputChannel.appendLine(`[CES] ZIP      : ${result.zipFile}`);
              outputChannel.appendLine(`[CES] Latest   : ${result.latestZipFile}`);
              outputChannel.appendLine(`[CES] Size     : ${result.zipSizeBytes} bytes`);
              outputChannel.appendLine(`[CES] SHA256   : ${result.sha256}`);

              await vscode.window.showInformationMessage(
                `CES package ready: ${path.basename(result.zipFile)}`,
                "Reveal in Finder",
              ).then((selection) => {
                if (selection === "Reveal in Finder") {
                  return vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(result.zipFile));
                }
                return undefined;
              });
            } catch (error) {
              handleCommandError(error, outputChannel);
            }
          },
        );
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("cesValidator.importCurrentPackage", async () => {
        const rootPath = await resolveTargetPackageRoot(orchestrator);
        if (!rootPath) {
          return;
        }

        const options = await promptForCesImportOptions(context, rootPath, "import");
        if (!options) {
          return;
        }

        outputChannel.show(true);
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Importing '${path.basename(rootPath)}' to CES`,
            cancellable: false,
          },
          async (progress) => {
            progress.report({ message: "Packaging archive" });
            try {
              const bundle = await packageCesPackage(rootPath);
              progress.report({ message: "Uploading to CES" });
              const result = await importPackageToCes(bundle.zipFile, options);
              saveImportProfile(context, rootPath, options);
              outputChannel.appendLine(`[CES] Import complete: ${result.importedAppName ?? result.operationName}`);
              outputChannel.appendLine(`[CES] Endpoint : ${result.endpoint}`);
              outputChannel.appendLine(`[CES] Parent   : ${result.parent}`);
              outputChannel.appendLine(`[CES] Operation: ${result.operationName}`);
              if (result.warnings.length > 0) {
                outputChannel.appendLine(`[CES] Warnings : ${result.warnings.join(" | ")}`);
              }

              const warningSuffix = result.warnings.length > 0 ? ` (${result.warnings.length} warning(s))` : "";
              void vscode.window.showInformationMessage(
                `CES import completed for ${result.importedAppName ?? path.basename(rootPath)}${warningSuffix}`,
              );
            } catch (error) {
              handleCommandError(error, outputChannel);
            }
          },
        );
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("cesValidator.pushCurrentPackage", async () => {
        const rootPath = await resolveTargetPackageRoot(orchestrator);
        if (!rootPath) {
          return;
        }

        const target = await promptForCesPushOptions(context, rootPath);
        if (!target) {
          return;
        }

        outputChannel.show(true);
        let prepared: PreparedIncrementalDeployment | null = null;
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Planning incremental CES push for '${path.basename(rootPath)}'`,
            cancellable: false,
          },
          async (progress) => {
            progress.report({ message: "Validating package and building resource plan" });
            try {
              prepared = await prepareIncrementalDeployment(rootPath, target);
              savePushProfile(context, rootPath, target);
              appendIncrementalPlan(outputChannel, prepared);
            } catch (error) {
              handleCommandError(error, outputChannel);
            }
          },
        );

        if (!prepared) {
          return;
        }

        const plannedDeployment: PreparedIncrementalDeployment = prepared;

        treeProvider.refresh();
        if (plannedDeployment.plan.summary.actionable === 0) {
          finalizePreparedIncrementalDeployment(plannedDeployment, "noop", "Everything is up to date.");
          treeProvider.refresh();
          void vscode.window.showInformationMessage(`No incremental CES changes detected for '${path.basename(rootPath)}'.`);
          return;
        }

        const selection = await vscode.window.showWarningMessage(
          `Apply ${plannedDeployment.plan.summary.actionable} incremental CES change(s) to app '${target.appId}'? Removed items stay in local state only and are not deleted remotely.`,
          { modal: true },
          "Apply",
          "Cancel",
        );

        if (selection !== "Apply") {
          finalizePreparedIncrementalDeployment(plannedDeployment, "cancelled", "Deployment aborted by user.");
          treeProvider.refresh();
          outputChannel.appendLine("[CES] Incremental push cancelled by user.");
          return;
        }

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Pushing '${path.basename(rootPath)}' incrementally to CES`,
            cancellable: false,
          },
          async (progress) => {
            try {
              const result = await applyPreparedIncrementalDeployment(plannedDeployment, (component, index, total) => {
                progress.report({ message: `${index}/${total}: ${component.kind} ${component.resourceId}` });
              });
              outputChannel.appendLine(`[CES] Incremental push complete for app '${target.appId}'`);
              outputChannel.appendLine(`[CES] Applied  : ${result.appliedCount} resource change(s)`);
              outputChannel.appendLine(`[CES] Artifact : ${result.artifactPath}`);
              outputChannel.appendLine(`[CES] State    : ${result.stateFile}`);
              treeProvider.refresh();
              void vscode.window.showInformationMessage(`CES incremental push completed for app '${target.appId}'.`);
            } catch (error) {
              treeProvider.refresh();
              handleCommandError(error, outputChannel);
            }
          },
        );
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("cesValidator.showCurrentPackageDeploymentStatus", async () => {
        const rootPath = await resolveTargetPackageRoot(orchestrator);
        if (!rootPath) {
          return;
        }

        const summary = loadDeploymentStatusSummary(rootPath);
        outputChannel.show(true);
        appendDeploymentStatus(outputChannel, summary);

        const actions: string[] = [];
        if (summary.latestArtifactPath) {
          actions.push("Open Latest Artifact");
        }
        actions.push("Open State File");

        const selection = await vscode.window.showInformationMessage(
          `Loaded CES deployment status for '${path.basename(rootPath)}'.`,
          ...actions,
        );

        if (selection === "Open Latest Artifact" && summary.latestArtifactPath) {
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(summary.latestArtifactPath));
          await vscode.window.showTextDocument(document, { preview: false });
        }
        if (selection === "Open State File") {
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(summary.stateFile));
          await vscode.window.showTextDocument(document, { preview: false });
        }
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

function isLikelyBinaryResource(filePath: string): boolean {
  if (filePath.includes(`${path.sep}__pycache__${path.sep}`)) {
    return true;
  }

  return BINARY_LIKE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function resolveTargetPackageRoot(orchestrator: ValidationOrchestrator): Promise<string | null> {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri?.scheme === "file") {
    const activeRoot = findPackageRootForPath(activeUri.fsPath);
    if (activeRoot) {
      return activeRoot;
    }
  }

  const roots = orchestrator.getPackageRoots();
  if (roots.length === 0) {
    void vscode.window.showWarningMessage("No CES package root was found in the current workspace.");
    return null;
  }

  if (roots.length === 1) {
    return roots[0] ?? null;
  }

  const selected = await vscode.window.showQuickPick(
    roots.map((rootPath) => ({
      label: path.basename(rootPath),
      description: rootPath,
      rootPath,
    })),
    {
      placeHolder: "Select the CES package to package or deploy",
    },
  );

  return selected?.rootPath ?? null;
}

async function promptForCesImportOptions(
  context: vscode.ExtensionContext,
  rootPath: string,
  mode: "import" | "push",
): Promise<CesImportOptions | null> {
  const defaults = getStoredImportProfile(context, rootPath);

  const projectId = await vscode.window.showInputBox({
    title: mode === "push" ? "Push to CES" : "Import to CES",
    prompt: "Google Cloud project ID",
    value: defaults.projectId ?? "voice-banking-poc",
    ignoreFocusOut: true,
    validateInput: (value) => value.trim().length > 0 ? undefined : "Project ID is required.",
  });
  if (!projectId) {
    return null;
  }

  const location = await vscode.window.showInputBox({
    title: mode === "push" ? "Push to CES" : "Import to CES",
    prompt: "CES location (for example: us or eu)",
    value: defaults.location ?? "us",
    ignoreFocusOut: true,
    validateInput: (value) => value.trim().length > 0 ? undefined : "Location is required.",
  });
  if (!location) {
    return null;
  }

  const requireAppId = mode === "push";
  const appId = await vscode.window.showInputBox({
    title: mode === "push" ? "Push to CES" : "Import to CES",
    prompt: requireAppId
      ? "Target remote app ID"
      : "Target app ID (optional — leave blank for a new server-assigned app ID)",
    value: defaults.appId ?? "",
    ignoreFocusOut: true,
    validateInput: (value) => validateAppIdInput(value, requireAppId),
  });
  if (appId === undefined) {
    return null;
  }

  let displayName = "";
  if (!appId.trim()) {
    displayName = await vscode.window.showInputBox({
      title: "Import to CES",
      prompt: "Display name for the new app (optional)",
      value: defaults.displayName ?? path.basename(rootPath),
      ignoreFocusOut: true,
    }) ?? "";
  }

  const strategySelection = await vscode.window.showQuickPick(
    ["REPLACE", "OVERWRITE"].map((value) => ({
      label: value,
      detail: value === "OVERWRITE"
        ? "Recommended for pushing updates to an existing remote app."
        : "Create/restore with replace semantics.",
    })),
    {
      title: mode === "push" ? "Push to CES" : "Import to CES",
      placeHolder: "Select the CES import conflict strategy",
      ignoreFocusOut: true,
    },
  );
  if (!strategySelection) {
    return null;
  }

  const ignoreLockSelection = await vscode.window.showQuickPick(
    [
      { label: "No", value: false, detail: "Respect the current app lock status." },
      { label: "Yes", value: true, detail: "Ask CES to ignore the current app lock during import." },
    ],
    {
      title: mode === "push" ? "Push to CES" : "Import to CES",
      placeHolder: "Ignore the target app lock?",
      ignoreFocusOut: true,
    },
  );
  if (!ignoreLockSelection) {
    return null;
  }

  return {
    projectId: projectId.trim(),
    location: location.trim(),
    appId: appId.trim() || undefined,
    displayName: displayName.trim() || undefined,
    importStrategy: strategySelection.label as "REPLACE" | "OVERWRITE",
    ignoreAppLock: ignoreLockSelection.value,
    pollIntervalSeconds: 5,
    pollTimeoutSeconds: 300,
  };
}

async function promptForCesPushOptions(
  context: vscode.ExtensionContext,
  rootPath: string,
): Promise<IncrementalCesTargetOptions | null> {
  const defaults = getStoredImportProfile(context, rootPath);

  const projectId = await vscode.window.showInputBox({
    title: "Incremental CES Push",
    prompt: "Google Cloud project ID",
    value: defaults.projectId ?? "voice-banking-poc",
    ignoreFocusOut: true,
    validateInput: (value) => value.trim().length > 0 ? undefined : "Project ID is required.",
  });
  if (!projectId) {
    return null;
  }

  const location = await vscode.window.showInputBox({
    title: "Incremental CES Push",
    prompt: "CES location (for example: us or eu)",
    value: defaults.location ?? "eu",
    ignoreFocusOut: true,
    validateInput: (value) => value.trim().length > 0 ? undefined : "Location is required.",
  });
  if (!location) {
    return null;
  }

  const appId = await vscode.window.showInputBox({
    title: "Incremental CES Push",
    prompt: "Target remote CES app ID",
    value: defaults.appId ?? "",
    ignoreFocusOut: true,
    validateInput: (value) => validateAppIdInput(value, true),
  });
  if (!appId) {
    return null;
  }

  return {
    projectId: projectId.trim(),
    location: location.trim(),
    appId: appId.trim(),
  };
}

function handleCommandError(error: unknown, outputChannel: vscode.OutputChannel): void {
  if (error instanceof DeploymentValidationError) {
    outputChannel.appendLine(`[CES] Deployment blocked: ${error.message}`);
    for (const issue of error.issues.filter((issue) => issue.severity === "error")) {
      outputChannel.appendLine(`[CES]   [${issue.code}] ${issue.file}${issue.line ? `:${issue.line}` : ""} ${issue.message}`);
    }
    void vscode.window.showErrorMessage(error.message);
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  outputChannel.appendLine(`[CES] Command failed: ${message}`);
  void vscode.window.showErrorMessage(message);
}

function getStoredImportProfile(context: vscode.ExtensionContext, rootPath: string): StoredImportProfile {
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(rootPath))?.uri.fsPath;
  const envDefaults = loadDeploymentEnvDefaults(rootPath, workspaceRoot);
  const storedProfile = context.workspaceState.get<StoredImportProfile>(`cesValidator.importProfile:${rootPath}`, {});
  return mergeDeploymentDefaults(storedProfile, envDefaults);
}

function saveImportProfile(context: vscode.ExtensionContext, rootPath: string, options: CesImportOptions): void {
  void context.workspaceState.update(`cesValidator.importProfile:${rootPath}`, {
    projectId: options.projectId,
    location: options.location,
    appId: options.appId,
    displayName: options.displayName,
    importStrategy: options.importStrategy,
    ignoreAppLock: options.ignoreAppLock,
  } satisfies StoredImportProfile);
}

function savePushProfile(context: vscode.ExtensionContext, rootPath: string, options: IncrementalCesTargetOptions): void {
  void context.workspaceState.update(`cesValidator.importProfile:${rootPath}`, {
    projectId: options.projectId,
    location: options.location,
    appId: options.appId,
  } satisfies StoredImportProfile);
}

function appendIncrementalPlan(outputChannel: vscode.OutputChannel, prepared: PreparedIncrementalDeployment): void {
  outputChannel.appendLine(`[CES] Incremental deployment plan for ${path.basename(prepared.rootPath)}`);
  outputChannel.appendLine(`[CES] Target   : ${prepared.target.projectId}/${prepared.target.location}/apps/${prepared.target.appId}`);
  outputChannel.appendLine(`[CES] State    : ${prepared.storage.stateFile}`);
  outputChannel.appendLine(`[CES] Artifact : ${prepared.artifactPath}`);
  outputChannel.appendLine(
    `[CES] Summary  : added=${prepared.plan.summary.added} updated=${prepared.plan.summary.modified} noop=${prepared.plan.summary.noop} removed=${prepared.plan.summary.removed} actionable=${prepared.plan.summary.actionable}`,
  );
  appendPlanGroup(outputChannel, "Added", prepared.plan.added);
  appendPlanGroup(outputChannel, "Updated", prepared.plan.modified);
  appendPlanGroup(outputChannel, "No-op", prepared.plan.noop);
  if (prepared.plan.removed.length > 0) {
    outputChannel.appendLine("[CES] Removed (state only; not deleted remotely):");
    for (const key of prepared.plan.removed) {
      outputChannel.appendLine(`[CES]   - ${key}`);
    }
  }
}

function appendPlanGroup(
  outputChannel: vscode.OutputChannel,
  label: string,
  components: Array<{ kind: string; resourceId: string; displayName: string }>,
): void {
  outputChannel.appendLine(`[CES] ${label} (${components.length}):`);
  if (components.length === 0) {
    outputChannel.appendLine("[CES]   - none");
    return;
  }

  for (const component of components) {
    outputChannel.appendLine(`[CES]   - ${component.kind.padEnd(7, " ")} ${component.resourceId} (${component.displayName})`);
  }
}

function appendDeploymentStatus(
  outputChannel: vscode.OutputChannel,
  summary: ReturnType<typeof loadDeploymentStatusSummary>,
): void {
  outputChannel.appendLine(`[CES] Deployment status for ${path.basename(summary.rootPath)}`);
  outputChannel.appendLine(`[CES] State file : ${summary.stateFile}`);
  outputChannel.appendLine(`[CES] Artifacts  : ${summary.artifactsDir}`);
  outputChannel.appendLine(`[CES] Target     : ${summary.project ?? "-"}/${summary.location ?? "-"}/apps/${summary.appId ?? "-"}`);
  if (summary.latestRun) {
    outputChannel.appendLine(
      `[CES] Latest run : ${summary.latestRun.runId} status=${summary.latestRun.status} completed=${summary.latestRun.completedAt ?? summary.latestRun.startedAt ?? "-"}`,
    );
    outputChannel.appendLine(`[CES] Git SHA    : ${summary.latestRun.gitCommitSha ?? "-"}`);
    if (summary.latestRun.message) {
      outputChannel.appendLine(`[CES] Outcome    : ${summary.latestRun.message}`);
    }
  } else {
    outputChannel.appendLine("[CES] Latest run : none");
  }
  if (summary.latestArtifactPath) {
    outputChannel.appendLine(`[CES] Artifact   : ${summary.latestArtifactPath}`);
  }
  outputChannel.appendLine(`[CES] Components : ${summary.components.length}`);
  for (const component of summary.components) {
    outputChannel.appendLine(
      `[CES]   - ${component.kind.padEnd(7, " ")} ${component.resourceId} deployed=${component.deployedAt} remote=${component.resourceName}`,
    );
  }
}

function validateAppIdInput(value: string, requireValue: boolean): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return requireValue ? "App ID is required for push." : undefined;
  }

  return /^[A-Za-z0-9][A-Za-z0-9_-]{4,35}$/.test(trimmed)
    ? undefined
    : "App ID must match [A-Za-z0-9][A-Za-z0-9_-]{4,35} (length 5-36).";
}
