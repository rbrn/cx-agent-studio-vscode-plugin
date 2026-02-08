# CES Package Validator — VS Code Extension

Real-time validation, syntax highlighting, and package exploration for **Google Customer Engagement Suite (CES) / Dialogflow CX Agent Studio** packages.

![VS Code](https://img.shields.io/badge/VS%20Code-%3E%3D1.96-blue)
![Version](https://img.shields.io/badge/version-0.4.0-green)

---

## ⚡ Quick Install (pre-built)

A ready-to-use `.vsix` is checked into the **`releases/`** folder.

### Option A — Command line

```bash
code --install-extension releases/ces-package-validator-0.4.0.vsix
```

> **Tip:** On macOS if `code` is not on your PATH, use the full path:
> ```bash
> "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
>   --install-extension releases/ces-package-validator-0.4.0.vsix
> ```

### Option B — VS Code UI

1. Open VS Code
2. Press `Cmd+Shift+P` (macOS) / `Ctrl+Shift+P` (Windows/Linux)
3. Type **"Extensions: Install from VSIX…"**
4. Navigate to `ces-plugin/releases/ces-package-validator-0.4.0.vsix`
5. Reload window when prompted (`Developer: Reload Window`)

### Verify installation

After reload you should see:

- **CES Package Explorer** sidebar in the Activity Bar (📦 icon)
- Running `Cmd+Shift+P` → `CES Validator: Validate Current Package` works without errors
- Diagnostics appear in the **Problems** panel for any CES package in your workspace

---

## 🔍 Features

### Real-time validation

The extension automatically detects CES Agent Studio package roots (folders containing `app.json` or `app.yaml`) and validates:

| Check | Description |
|-------|-------------|
| **Manifest** | `app.json` / `app.yaml` parse and schema validation |
| **Root agent** | `rootAgent` reference resolves to an existing agent directory |
| **Global instruction** | `globalInstruction` path exists and is not inlined |
| **Agents** | Each agent has a valid manifest and matching `instruction.txt` |
| **Toolsets** | Toolset manifests parse correctly; OpenAPI schemas exist and are valid YAML/JSON |
| **Guardrails** | Guardrail references resolve to existing guardrail directories |
| **Evaluations** | Evaluation `displayName` matches directory; L-01 `toolCall` references valid direct tools (not OpenAPI operations) |
| **Environment** | `environment.json` structure check; warns on `localhost` URLs |
| **Nesting** | Warns on excessive directory nesting beyond standard CES patterns |
| **Unsupported dirs** | Flags non-standard directories like `evaluationDatasets` |

### Instruction file support

CES agent instruction files (`instruction.txt`, `global_instruction.txt`) get:

- **Syntax highlighting** — XML-like sections (`<role>`, `<task>`, `<examples>`), `{@AGENT:name}` and `{@TOOL:name}` references, `tool_call()` patterns
- **Structural validation** — missing required sections, unknown agent/tool references, invalid tool_call targets
- **Auto language detection** — files matching CES patterns are automatically set to the `CES Instruction` language mode

### Package Explorer tree view

A dedicated **CES Package** sidebar shows the full package structure:

- Agents (with instruction sections, references, and issue counts)
- Toolsets (direct tools and OpenAPI operations)
- Guardrails
- Evaluations
- Environment variables

### Commands

| Command | Description |
|---------|-------------|
| `CES Validator: Validate Current Package` | Run validation on the package containing the active file |
| `CES Validator: Clear Diagnostics` | Clear all CES validation diagnostics |
| `Refresh` (tree view title bar) | Re-run validation and refresh the Package Explorer |

---

## 🛠️ Development

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9
- VS Code ≥ 1.96

### Setup

```bash
cd ces-plugin
npm install
```

### Build

```bash
npm run build          # TypeScript compile + esbuild bundle
npm run compile        # TypeScript compile only (for tests)
npm run bundle         # esbuild bundle only
```

### Test

```bash
npm test               # Runs all 30 tests
```

### Package a new VSIX

```bash
npx @vscode/vsce package --no-dependencies
# Output: ces-package-validator-<version>.vsix
# Copy to releases/ and commit
cp ces-package-validator-*.vsix releases/
```

> `--no-dependencies` is safe because **esbuild** bundles all runtime dependencies (including `yaml`) into `dist/extension.js`.

### Run in development

1. Open the `ces-plugin` folder in VS Code
2. Press `F5` to launch the Extension Development Host
3. Open a folder containing a CES agent package (e.g. `ces-agent/acme_voice_agent`)

---

## 📁 Project Structure

```
ces-plugin/
├── src/
│   ├── extension.ts              # VS Code extension entry point
│   ├── cli.ts                    # CLI entry point (ces-validate)
│   └── core/
│       ├── types.ts              # TypeScript interfaces
│       ├── parsers.ts            # YAML/JSON parsing utilities
│       ├── pathUtils.ts          # Path detection helpers
│       ├── packageIndex.ts       # Package model builder
│       ├── rules.ts              # All validation rules
│       ├── instructionParser.ts  # Instruction file parser
│       ├── orchestrator.ts       # Validation orchestration
│       └── treeProvider.ts       # Package Explorer tree view
├── syntaxes/
│   └── ces-instruction.tmLanguage.json  # TextMate grammar
├── releases/
│   └── ces-package-validator-0.4.0.vsix # Pre-built extension
├── esbuild.mjs                   # Bundle configuration
├── package.json
└── tsconfig.json
```

---

## 📝 CLI Usage

The extension also ships a standalone CLI validator:

```bash
npx ces-validate /path/to/agent-package
```

Or after global install:

```bash
npm install -g .
ces-validate /path/to/agent-package
```

---

## License

UNLICENSED — Internal use only.
