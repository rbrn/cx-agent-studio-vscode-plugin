/*
 * Created by Codex on 2026-02-08.
 * Package root discovery for CES validator.
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { isRelevantFilesystemPath } from "./pathUtils";

const FIND_EXCLUDE_GLOB = "{**/node_modules/**,**/.git/**,**/dist/**,**/out/**}";

export async function findPackageRoots(): Promise<string[]> {
  const [yamlManifests, jsonManifests] = await Promise.all([
    vscode.workspace.findFiles("**/app.yaml", FIND_EXCLUDE_GLOB),
    vscode.workspace.findFiles("**/app.json", FIND_EXCLUDE_GLOB),
  ]);

  const roots = new Set<string>();
  for (const uri of [...yamlManifests, ...jsonManifests]) {
    roots.add(path.dirname(uri.fsPath));
  }

  return [...roots].sort();
}

export function findPackageRootForPath(filePath: string): string | null {
  let current = path.resolve(filePath);
  if (!fs.existsSync(current)) {
    current = path.dirname(current);
  } else {
    const stat = fs.statSync(current);
    if (!stat.isDirectory()) {
      current = path.dirname(current);
    }
  }

  while (true) {
    const hasManifest =
      fs.existsSync(path.join(current, "app.yaml")) ||
      fs.existsSync(path.join(current, "app.json"));

    if (hasManifest) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }

    current = parent;
  }

  return null;
}

export function isRelevantUri(uri: vscode.Uri): boolean {
  if (uri.scheme !== "file") {
    return false;
  }

  return isRelevantFilesystemPath(uri.fsPath);
}
