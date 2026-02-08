/*
 * TreeDataProvider for CES Package Explorer sidebar.
 * Shows package structure with ✅/❌ status per component.
 *
 * Created by Augment Agent on 2026-02-08.
 */

import * as path from "path";
import * as vscode from "vscode";
import { buildPackageModel } from "./packageIndex";
import { runRules } from "./rules";
import { PackageModel, ValidationIssue } from "./types";

// ── Tree item types ─────────────────────────────────────────────────────────

type NodeKind =
  | "package"
  | "category"
  | "agent"
  | "toolset"
  | "evaluation"
  | "guardrail"
  | "tool"
  | "file"
  | "info";

interface TreeNode {
  kind: NodeKind;
  label: string;
  description?: string;
  tooltip?: string;
  filePath?: string;
  line?: number;
  children?: TreeNode[];
  status?: "pass" | "warn" | "error" | "none";
  iconId?: string;
}

// ── Provider ────────────────────────────────────────────────────────────────

export class CesPackageTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private roots: TreeNode[] = [];
  private packageRoots: string[] = [];

  public setPackageRoots(roots: string[]): void {
    this.packageRoots = roots;
  }

  public refresh(): void {
    this.roots = this.packageRoots.map((root) => this.buildTree(root));
    this._onDidChangeTreeData.fire();
  }

  public getTreeItem(element: TreeNode): vscode.TreeItem {
    const collapsible = element.children && element.children.length > 0
      ? element.kind === "package"
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;

    const item = new vscode.TreeItem(element.label, collapsible);
    item.description = element.description;
    item.tooltip = element.tooltip ?? element.label;
    item.iconPath = this.resolveIcon(element);
    item.contextValue = element.kind;

    if (element.filePath) {
      item.command = {
        command: "vscode.open",
        title: "Open File",
        arguments: [
          vscode.Uri.file(element.filePath),
          element.line ? { selection: new vscode.Range(element.line - 1, 0, element.line - 1, 0) } as vscode.TextDocumentShowOptions : undefined,
        ],
      };
      item.resourceUri = vscode.Uri.file(element.filePath);
    }

    return item;
  }

  public getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return this.roots;
    }

    return element.children ?? [];
  }

  // ── Tree construction ───────────────────────────────────────────────────

  private buildTree(rootPath: string): TreeNode {
    let model: PackageModel;
    let issues: ValidationIssue[];

    try {
      model = buildPackageModel(rootPath);
      issues = runRules(model);
    } catch {
      return {
        kind: "package",
        label: path.basename(rootPath),
        description: "⚠️ failed to load",
        status: "error",
        children: [],
      };
    }

    const errorCount = issues.filter((i) => i.severity === "error").length;
    const warnCount = issues.filter((i) => i.severity === "warning").length;

    const statusDesc = errorCount > 0
      ? `❌ ${errorCount} error${errorCount > 1 ? "s" : ""}${warnCount > 0 ? `, ${warnCount} warn` : ""}`
      : warnCount > 0
        ? `⚠️ ${warnCount} warning${warnCount > 1 ? "s" : ""}`
        : "✅ all checks passed";

    const packageStatus: "pass" | "warn" | "error" =
      errorCount > 0 ? "error" : warnCount > 0 ? "warn" : "pass";

    return {
      kind: "package",
      label: path.basename(rootPath),
      description: statusDesc,
      tooltip: `${rootPath}\n${issues.length} issue(s)`,
      status: packageStatus,
      children: [
        this.buildManifestNode(model, issues),
        this.buildAgentsNode(model, issues),
        this.buildToolsetsNode(model, issues),
        this.buildEvaluationsNode(model, issues),
        this.buildGuardrailsNode(model, issues),
        this.buildToolInventoryNode(model),
        this.buildEnvironmentNode(model, issues),
      ],
    };
  }

  private buildManifestNode(model: PackageModel, issues: ValidationIssue[]): TreeNode {
    const manifestIssues = issues.filter((i) =>
      i.code.startsWith("CES_MANIFEST") || i.code === "CES_APP_JSON_ONLY" || i.code === "CES_ROOT_AGENT_MISSING" || i.code === "CES_GLOBAL_INSTRUCTION_MISSING",
    );

    const format = model.manifestFormat === "yaml" ? "app.yaml" : model.manifestFormat === "json" ? "app.json" : "missing";
    return {
      kind: "file",
      label: `Manifest: ${format}`,
      filePath: model.manifestPath ?? undefined,
      status: this.statusFromIssues(manifestIssues),
      description: this.statusBadge(manifestIssues),
      iconId: "file",
      children: manifestIssues.map((i) => this.issueNode(i)),
    };
  }

  private buildAgentsNode(model: PackageModel, issues: ValidationIssue[]): TreeNode {
    const children = model.agentInfos.map((agent) => {
      const agentIssues = issues.filter((i) =>
        i.file.includes(`agents/${agent.name}`) || i.message.includes(`'${agent.name}'`),
      );

      const childAgents = Array.isArray(agent.manifestData?.childAgents) ? agent.manifestData.childAgents as string[] : [];
      const tools = Array.isArray(agent.manifestData?.tools) ? agent.manifestData.tools as string[] : [];
      const toolsets = Array.isArray(agent.manifestData?.toolsets) ? (agent.manifestData.toolsets as Array<Record<string, unknown>>).map((t) => t.toolset as string).filter(Boolean) : [];

      const details: string[] = [];
      if (childAgents.length > 0) { details.push(`${childAgents.length} child agent${childAgents.length > 1 ? "s" : ""}`); }
      if (tools.length > 0) { details.push(`tools: ${tools.join(", ")}`); }
      if (toolsets.length > 0) { details.push(`toolsets: ${toolsets.join(", ")}`); }

      return {
        kind: "agent" as NodeKind,
        label: agent.name,
        description: `${this.statusBadge(agentIssues)}${details.length > 0 ? "  " + details.join(" · ") : ""}`,
        filePath: agent.manifestPath,
        status: this.statusFromIssues(agentIssues),
        tooltip: `Agent: ${agent.name}\n${details.join("\n")}`,
        children: agentIssues.length > 0 ? agentIssues.map((i) => this.issueNode(i)) : undefined,
      };
    });

    const allAgentIssues = issues.filter((i) => i.code.startsWith("CES_AGENT") || i.code.startsWith("CES_CHILD") || i.code === "CES_ROOT_AGENT_DIR_MISSING" || i.code === "CES_ROOT_AGENT_MANIFEST_MISSING");
    return {
      kind: "category",
      label: `Agents (${model.agentInfos.length})`,
      status: this.statusFromIssues(allAgentIssues),
      description: this.statusBadge(allAgentIssues),
      iconId: "robot",
      children,
    };
  }

  private buildToolsetsNode(model: PackageModel, issues: ValidationIssue[]): TreeNode {
    const children = model.toolsetInfos.map((toolset) => {
      const tsIssues = issues.filter((i) =>
        i.file.includes(`toolsets/${toolset.name}`) || i.message.includes(`'${toolset.name}'`),
      );

      return {
        kind: "toolset" as NodeKind,
        label: toolset.name,
        description: this.statusBadge(tsIssues),
        filePath: toolset.manifestPath,
        status: this.statusFromIssues(tsIssues),
        children: tsIssues.length > 0 ? tsIssues.map((i) => this.issueNode(i)) : undefined,
      };
    });

    const allTsIssues = issues.filter((i) => i.code.startsWith("CES_TOOLSET") || i.code.startsWith("CES_OPENAPI") || i.code === "CES_AGENT_TOOLSET_REFERENCE_MISSING");
    return {
      kind: "category",
      label: `Toolsets (${model.toolsetInfos.length})`,
      status: this.statusFromIssues(allTsIssues),
      description: this.statusBadge(allTsIssues),
      iconId: "tools",
      children,
    };
  }

  private buildEvaluationsNode(model: PackageModel, issues: ValidationIssue[]): TreeNode {
    if (model.evaluationInfos.length === 0) {
      return {
        kind: "category",
        label: "Evaluations",
        description: "none",
        status: "none",
        iconId: "beaker",
        children: [],
      };
    }

    const children = model.evaluationInfos.map((ev) => {
      const evIssues = issues.filter((i) =>
        i.file.includes(`evaluations/${ev.name}`) || (i.code.startsWith("CES_EVALUATION") && i.message.includes(`'${ev.name}'`)),
      );

      return {
        kind: "evaluation" as NodeKind,
        label: ev.name,
        description: this.statusBadge(evIssues),
        filePath: ev.manifestPath,
        status: this.statusFromIssues(evIssues),
        children: evIssues.length > 0 ? evIssues.map((i) => this.issueNode(i)) : undefined,
      };
    });

    const allEvIssues = issues.filter((i) => i.code.startsWith("CES_EVALUATION"));
    return {
      kind: "category",
      label: `Evaluations (${model.evaluationInfos.length})`,
      status: this.statusFromIssues(allEvIssues),
      description: this.statusBadge(allEvIssues),
      iconId: "beaker",
      children,
    };
  }

  private buildGuardrailsNode(model: PackageModel, issues: ValidationIssue[]): TreeNode {
    const grIssues = issues.filter((i) => i.code.startsWith("CES_GUARDRAIL"));

    const children = model.guardrailDirs.map((dirPath) => {
      const name = path.basename(dirPath);
      const childIssues = grIssues.filter((i) => i.file.includes(name));
      return {
        kind: "guardrail" as NodeKind,
        label: name.replace(/_/g, " "),
        description: this.statusBadge(childIssues),
        filePath: path.join(dirPath, `${name}.json`),
        status: this.statusFromIssues(childIssues),
        children: childIssues.length > 0 ? childIssues.map((i) => this.issueNode(i)) : undefined,
      };
    });

    return {
      kind: "category",
      label: `Guardrails (${model.guardrailDirs.length})`,
      status: this.statusFromIssues(grIssues),
      description: this.statusBadge(grIssues),
      iconId: "shield",
      children,
    };
  }

  private buildToolInventoryNode(model: PackageModel): TreeNode {
    const directChildren: TreeNode[] = [...model.directTools].sort().map((t) => ({
      kind: "tool" as NodeKind,
      label: t,
      description: "direct tool",
      iconId: "symbol-method",
      status: "pass" as const,
    }));

    const opChildren: TreeNode[] = [...model.openApiOperations].sort().map((op) => ({
      kind: "tool" as NodeKind,
      label: op,
      description: "OpenAPI operation",
      iconId: "cloud",
      status: "pass" as const,
    }));

    const total = model.directTools.size + model.openApiOperations.size;
    return {
      kind: "category",
      label: `Tool Inventory (${total})`,
      status: "none",
      iconId: "symbol-key",
      children: [
        ...(directChildren.length > 0 ? directChildren : [{ kind: "info" as NodeKind, label: "(no direct tools)", status: "none" as const }]),
        ...(opChildren.length > 0 ? opChildren : [{ kind: "info" as NodeKind, label: "(no OpenAPI operations)", status: "none" as const }]),
      ],
    };
  }

  private buildEnvironmentNode(model: PackageModel, issues: ValidationIssue[]): TreeNode {
    const envIssues = issues.filter((i) => i.code.startsWith("CES_ENVIRONMENT"));

    if (!model.environment) {
      return {
        kind: "file",
        label: "Environment",
        description: "not present",
        status: "none",
        iconId: "globe",
        children: [],
      };
    }

    return {
      kind: "file",
      label: "environment.json",
      description: this.statusBadge(envIssues),
      filePath: model.environment.filePath,
      status: this.statusFromIssues(envIssues),
      iconId: "globe",
      children: envIssues.length > 0 ? envIssues.map((i) => this.issueNode(i)) : undefined,
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private issueNode(issue: ValidationIssue): TreeNode {
    return {
      kind: "info",
      label: issue.message,
      description: issue.code,
      filePath: issue.file,
      line: issue.line,
      status: issue.severity === "error" ? "error" : "warn",
      tooltip: `[${issue.code}] ${issue.message}\n${issue.file}${issue.line ? `:${issue.line}` : ""}`,
    };
  }

  private statusFromIssues(issues: ValidationIssue[]): "pass" | "warn" | "error" {
    if (issues.some((i) => i.severity === "error")) { return "error"; }
    if (issues.some((i) => i.severity === "warning")) { return "warn"; }
    return "pass";
  }

  private statusBadge(issues: ValidationIssue[]): string {
    const errors = issues.filter((i) => i.severity === "error").length;
    const warns = issues.filter((i) => i.severity === "warning").length;
    if (errors > 0) { return `❌ ${errors} error${errors > 1 ? "s" : ""}`; }
    if (warns > 0) { return `⚠️ ${warns}`; }
    return "✅";
  }

  private resolveIcon(node: TreeNode): vscode.ThemeIcon | undefined {
    if (node.iconId) {
      return new vscode.ThemeIcon(node.iconId);
    }

    switch (node.status) {
      case "error": return new vscode.ThemeIcon("error", new vscode.ThemeColor("errorForeground"));
      case "warn": return new vscode.ThemeIcon("warning", new vscode.ThemeColor("editorWarning.foreground"));
      case "pass": return new vscode.ThemeIcon("pass", new vscode.ThemeColor("testing.iconPassed"));
      default: return new vscode.ThemeIcon("circle-outline");
    }
  }
}
