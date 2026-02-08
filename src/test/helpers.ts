/*
 * Created by Codex on 2026-02-08.
 * Test helpers for CES validator fixtures.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export function createFixture(files: Record<string, string>): string {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "ces-validator-"));

  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(rootPath, relativePath);
    const parent = path.dirname(absolutePath);
    fs.mkdirSync(parent, { recursive: true });
    fs.writeFileSync(absolutePath, contents, "utf8");
  }

  return rootPath;
}

export function cleanupFixture(rootPath: string): void {
  fs.rmSync(rootPath, { recursive: true, force: true });
}
