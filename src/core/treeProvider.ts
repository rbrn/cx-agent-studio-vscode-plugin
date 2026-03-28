/*
 * TreeDataProvider for CES Package Explorer sidebar.
 * Shows package structure with ✅/❌ status per component.
 *
 * Created by Augment Agent on 2026-02-08.
 */

import * as path from "path";
import * as vscode from "vscode";
import { loadDeploymentStatusSummary } from "./incrementalDeployment";
import { buildPackageModel } from "./packageIndex";
import { runRules } from "./rules";
import { resolveDirectToolNavigation, resolveInstructionNavigation, resolveOpenApiOperationNavigation, resolveToolsetNavigation } from "./toolNavigation";
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
  | "instruction"
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

interface ResourceOpenArgs {
  filePath: string;
  line?: number;
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
        command: "cesValidator.openResource",
        title: "Open File",
        arguments: [{ filePath: element.filePath, line: element.line } satisfies ResourceOpenArgs],
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        kind: "package",
        label: path.basename(rootPath),
        description: "⚠️ failed to load",
        status: "error",
        tooltip: `${rootPath}\n${message}`,
        children: [
          {
            kind: "info",
            label: message,
            description: "CES_VALIDATOR_RUNTIME_ERROR",
            status: "error",
          },
        ],
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
        this.buildDeploymentNode(rootPath),
      ],
    };
  }

  private buildManifestNode(model: PackageModel, issues: ValidationIssue[]): TreeNode {
    const manifestIssues = issues.filter((i) =>
      i.code.startsWith("CES_MANIFEST") || i.code === "CES_APP_JSON_ONLY" || i.code === "CES_ROOT_AGENT_MISSING" || i.code === "CES_GLOBAL_INSTRUCTION_MISSING",
    );

    const globalInstructionTarget = resolveInstructionNavigation(model, "__global__");
    const children = manifestIssues.map((i) => this.issueNode(i));
    if (globalInstructionTarget) {
      children.unshift({
        kind: "instruction",
        label: "global_instruction.txt",
        description: globalInstructionTarget.description,
        tooltip: globalInstructionTarget.tooltip,
        filePath: globalInstructionTarget.filePath,
        line: globalInstructionTarget.line,
        status: "pass",
        iconId: "file-text",
      });
    }

    const format = model.manifestFormat === "yaml" ? "app.yaml" : model.manifestFormat === "json" ? "app.json" : "missing";
    return {
      kind: "file",
      label: `Manifest: ${format}`,
      filePath: model.manifestPath ?? undefined,
      status: this.statusFromIssues(manifestIssues),
      description: this.statusBadge(manifestIssues),
      iconId: "file",
      children,
    };
  }

  private buildAgentsNode(model: PackageModel, issues: ValidationIssue[]): TreeNode {
    const children = model.agentInfos.map((agent) => {
      const agentIssues = issues.filter((i) =>
        i.file.includes(`agents/${agent.name}`) || i.message.includes(`'${agent.name}'`),
      );

      const childAgents = Array.isArray(agent.manifestData?.childAgents) ? agent.manifestData.childAgents as string[] : [];
      const tools = Array.isArray(agent.manifestData?.tools) ? agent.manifestData.tools as string[] : [];
      const toolsetEntries = Array.isArray(agent.manifestData?.toolsets)
        ? (agent.manifestData.toolsets as Array<Record<string, unknown>>).filter((entry) => this.isRecord(entry))
        : [];
      const toolsets = toolsetEntries
        .map((entry) => typeof entry.toolset === "string" ? entry.toolset : "")
        .filter((name) => name.length > 0);

      const details: string[] = [];
      if (childAgents.length > 0) { details.push(`${childAgents.length} child agent${childAgents.length > 1 ? "s" : ""}`); }
      if (tools.length > 0) { details.push(`tools: ${tools.join(", ")}`); }
      if (toolsets.length > 0) { details.push(`toolsets: ${toolsets.join(", ")}`); }

      // Build instruction child node
      const instrInfo = model.instructionInfos.find((info) => info.agentName === agent.name);
      const instrChildren: TreeNode[] = [];
      if (instrInfo) {
        const instrTarget = resolveInstructionNavigation(model, agent.name);
        const instrIssues = issues.filter((i) =>
          i.file === instrInfo.filePath && i.code.startsWith("CES_INSTRUCTION"),
        );
        const sectionList = instrInfo.sections.map((s) => s.name).join(", ") || "none";
        const refCount = instrInfo.references.length;
        const callCount = instrInfo.toolCalls.length;

        const instrDetailNodes: TreeNode[] = [];
        instrDetailNodes.push({
          kind: "info",
          label: `Sections: ${sectionList}`,
          status: "none",
        });
        if (refCount > 0) {
          instrDetailNodes.push({
            kind: "info",
            label: `References: ${refCount} (${instrInfo.references.filter((r) => r.type === "agent").length} agent, ${instrInfo.references.filter((r) => r.type === "tool").length} tool)`,
            status: "none",
          });
        }
        if (callCount > 0) {
          instrDetailNodes.push({
            kind: "info",
            label: `Tool calls: ${callCount}`,
            status: "none",
          });
        }
        if (instrIssues.length > 0) {
          instrDetailNodes.push(...instrIssues.map((i) => this.issueNode(i)));
        }

        instrChildren.push({
          kind: "instruction",
          label: "instruction.txt",
          description: `${this.statusBadge(instrIssues)}  §${instrInfo.sections.length} refs:${refCount}`,
          tooltip: instrTarget?.tooltip,
          filePath: instrTarget?.filePath ?? instrInfo.filePath,
          line: instrTarget?.line ?? 1,
          status: this.statusFromIssues(instrIssues),
          iconId: "file-text",
        });

        if (instrDetailNodes.length > 0) {
          instrChildren.push({
            kind: "category",
            label: "Instruction details",
            description: `${instrInfo.sections.length} section${instrInfo.sections.length === 1 ? "" : "s"}`,
            status: this.statusFromIssues(instrIssues),
            iconId: "list-unordered",
            children: instrDetailNodes,
          });
        }
      }

      const referenceChildren = this.buildAgentReferenceNodes(model, tools, toolsetEntries);

      const issueChildren = agentIssues.filter((i) => !i.code.startsWith("CES_INSTRUCTION")).map((i) => this.issueNode(i));
      const childNodes = [...instrChildren, ...referenceChildren, ...issueChildren];

      return {
        kind: "agent" as NodeKind,
        label: agent.name,
        description: `${this.statusBadge(agentIssues)}${details.length > 0 ? "  " + details.join(" · ") : ""}`,
        filePath: agent.manifestPath,
        status: this.statusFromIssues(agentIssues),
        tooltip: `Agent: ${agent.name}\n${details.join("\n")}`,
        children: childNodes.length > 0 ? childNodes : undefined,
      };
    });

    const allAgentIssues = issues.filter((i) => i.code.startsWith("CES_AGENT") || i.code.startsWith("CES_CHILD") || i.code === "CES_ROOT_AGENT_DIR_MISSING" || i.code === "CES_ROOT_AGENT_MANIFEST_MISSING" || i.code.startsWith("CES_INSTRUCTION"));
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
    const directChildren: TreeNode[] = [...model.directTools].sort().map((toolName) => {
      const navigation = resolveDirectToolNavigation(model, toolName);
      return {
        kind: "tool" as NodeKind,
        label: toolName,
        description: navigation?.description ?? "direct tool",
        tooltip: navigation?.tooltip ?? `${toolName} direct tool`,
        filePath: navigation?.filePath,
        line: navigation?.line,
        iconId: "symbol-method",
        status: "pass" as const,
      };
    });

    const opChildren: TreeNode[] = [...model.openApiOperations].sort().map((operationName) => {
      const navigation = resolveOpenApiOperationNavigation(model, operationName);
      return {
        kind: "tool" as NodeKind,
        label: operationName,
        description: navigation?.description ?? "OpenAPI operation",
        tooltip: navigation?.tooltip ?? `${operationName} OpenAPI operation`,
        filePath: navigation?.filePath,
        line: navigation?.line,
        iconId: "cloud",
        status: "pass" as const,
      };
    });

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

  private buildAgentReferenceNodes(model: PackageModel, tools: string[], toolsetEntries: Array<Record<string, unknown>>): TreeNode[] {
    const children: TreeNode[] = [];

    if (tools.length > 0) {
      const toolNodes = tools.map((toolName) => {
        const navigation = resolveDirectToolNavigation(model, toolName);
        const isBuiltin = toolName === "end_session";

        return {
          kind: "tool" as NodeKind,
          label: toolName,
          description: isBuiltin
            ? "built-in tool"
            : navigation?.description ?? "direct tool reference",
          tooltip: isBuiltin
            ? `${toolName} is a CES built-in tool`
            : navigation?.tooltip ?? `${toolName} direct tool reference`,
          filePath: navigation?.filePath,
          line: navigation?.line,
          iconId: isBuiltin ? "symbol-key" : "symbol-method",
          status: "pass" as const,
        };
      });

      children.push({
        kind: "category",
        label: `Tools (${toolNodes.length})`,
        description: "click to open definitions",
        iconId: "symbol-method",
        status: "none",
        children: toolNodes,
      });
    }

    if (toolsetEntries.length > 0) {
      const toolsetNodes = toolsetEntries.map((entry) => {
        const toolsetName = typeof entry.toolset === "string" ? entry.toolset : "(unknown toolset)";
        const toolIds = Array.isArray(entry.toolIds)
          ? entry.toolIds.filter((toolId): toolId is string => typeof toolId === "string" && toolId.trim().length > 0)
          : [];
        const navigation = resolveToolsetNavigation(model, toolsetName);

        const operationChildren = toolIds.map((operationName) => {
          const operationNavigation = resolveOpenApiOperationNavigation(model, operationName);
          return {
            kind: "tool" as NodeKind,
            label: operationName,
            description: operationNavigation?.description ?? "OpenAPI operation",
            tooltip: operationNavigation?.tooltip ?? `${operationName} OpenAPI operation`,
            filePath: operationNavigation?.filePath,
            line: operationNavigation?.line,
            iconId: "cloud",
            status: "pass" as const,
          };
        });

        return {
          kind: "toolset" as NodeKind,
          label: toolsetName,
          description: toolIds.length > 0 ? `${toolIds.length} operation${toolIds.length === 1 ? "" : "s"}` : "toolset reference",
          tooltip: navigation?.tooltip ?? `${toolsetName} toolset reference`,
          filePath: navigation?.filePath,
          line: navigation?.line,
          iconId: "tools",
          status: "pass" as const,
          children: operationChildren.length > 0 ? operationChildren : undefined,
        };
      });

      children.push({
        kind: "category",
        label: `Toolsets (${toolsetNodes.length})`,
        description: "click to inspect manifests and operations",
        iconId: "tools",
        status: "none",
        children: toolsetNodes,
      });
    }

    return children;
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

  private buildDeploymentNode(rootPath: string): TreeNode {
    const summary = loadDeploymentStatusSummary(rootPath);
    const latestRun = summary.latestRun;
    const status = this.statusFromDeploymentRun(latestRun?.status);
    const description = latestRun
      ? `${latestRun.status} · ${latestRun.completedAt ?? latestRun.startedAt ?? "pending"}`
      : summary.components.length > 0
        ? `${summary.components.length} tracked resource${summary.components.length === 1 ? "" : "s"}`
        : "not deployed";

    const children: TreeNode[] = [
      {
        kind: "file",
        label: "deploy-state.json",
        description: summary.components.length > 0 ? `${summary.components.length} tracked resource${summary.components.length === 1 ? "" : "s"}` : "empty",
        filePath: summary.stateFile,
        status,
        iconId: "database",
      },
    ];

    if (summary.latestArtifactPath) {
      children.unshift({
        kind: "file",
        label: path.basename(summary.latestArtifactPath),
        description: latestRun?.status ?? "artifact",
        filePath: summary.latestArtifactPath,
        status,
        iconId: "history",
      });
    }

    if (latestRun) {
      children.unshift({
        kind: "info",
        label: `Latest run: ${latestRun.runId}`,
        description: latestRun.status,
        status,
        tooltip: latestRun.message ?? latestRun.runId,
      });
    }

    if (summary.components.length > 0) {
      children.push({
        kind: "category",
        label: `Resources (${summary.components.length})`,
        description: `${summary.project ?? "-"}/${summary.location ?? "-"}/apps/${summary.appId ?? "-"}`,
        status,
        iconId: "cloud-upload",
        children: summary.components.map((component) => ({
          kind: component.kind === "agent" ? "agent" : component.kind === "tool" ? "tool" : "toolset",
          label: component.resourceId,
          description: `${component.kind} · ${component.deployedAt}`,
          tooltip: `${component.displayName}\n${component.resourceName}`,
          status: "pass",
          iconId: component.kind === "agent" ? "robot" : component.kind === "tool" ? "symbol-method" : "tools",
        })),
      });
    }

    return {
      kind: "category",
      label: "Deployment",
      description,
      tooltip: `${rootPath}\nTarget: ${summary.project ?? "-"}/${summary.location ?? "-"}/apps/${summary.appId ?? "-"}`,
      status,
      iconId: "cloud-upload",
      children,
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

  private statusFromDeploymentRun(status: string | undefined): "pass" | "warn" | "error" | "none" {
    switch (status) {
      case "success":
      case "noop":
        return "pass";
      case "failed":
        return "error";
      case "planned":
      case "cancelled":
        return "warn";
      default:
        return "none";
    }
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

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
}
