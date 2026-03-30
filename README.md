# CES Package Validator — VS Code Extension

Real-time validation, packaging, full-app import, incremental resource push, syntax highlighting, and package exploration for **Google Customer Engagement Suite (CES) / Dialogflow CX Agent Studio** packages.

![VS Code](https://img.shields.io/badge/VS%20Code-%3E%3D1.96-blue)
![Version](https://img.shields.io/badge/version-0.12.0-green)

---

## ⚡ Quick Install (pre-built)

A ready-to-use `.vsix` is checked into the **`releases/`** folder.

### Option A — Command line

```bash
code --install-extension releases/ces-package-validator-0.12.0.vsix
```

> **Tip:** On macOS if `code` is not on your PATH, use the full path:
> ```bash
> "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
>   --install-extension releases/ces-package-validator-0.12.0.vsix
> ```

### Option B — VS Code UI

1. Open VS Code
2. Press `Cmd+Shift+P` (macOS) / `Ctrl+Shift+P` (Windows/Linux)
3. Type **"Extensions: Install from VSIX…"**
4. Navigate to `ces-plugin/releases/ces-package-validator-0.12.0.vsix`
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
| **Child agents** | `childAgents` references resolve to existing agent directories |
| **Callbacks** | Agent callback `pythonCode` paths (`afterAgentCallbacks`, `beforeModelCallbacks`, etc.) resolve to existing files |
| **Agent tools** | Each tool in agent `tools[]` exists as `tools/<name>/<name>.json` or is a known built-in (`end_session`) |
| **Toolsets** | Toolset manifests parse correctly; OpenAPI schemas exist and are valid YAML/JSON |
| **Guardrails** | Guardrail references resolve to existing guardrail directories |
| **Evaluations** | Evaluation `displayName` matches directory; L-01 `toolCall` references valid direct tools; `agentResponse.role` references known agents; scenario `expectedToolCall`/`mockToolResponse` reference valid tools |
| **Environment** | `environment.json` structure check; `app` section validation (loggingSettings); toolset cross-references match `toolsets/`; warns on unknown top-level keys; warns on `localhost` URLs |
| **$env_var placeholders** | Detects CES-managed `$env_var` placeholders in manifests; errors if `environment.json` missing when placeholders found |
| **Nesting** | Warns on excessive directory nesting beyond standard CES patterns |
| **Unsupported dirs** | Flags non-standard directories like `evaluationDatasets` |

### Package, import, and push workflows

The extension can now package the currently selected CES package, validate that the generated ZIP still contains every required referenced runtime file, and deploy to CES in two ways: full ZIP import or incremental resource push.

What the deploy commands do:

- run the same package validation rules as the sidebar/Problems panel
- create a versioned ZIP beside the package root plus a `latest` ZIP copy
- validate the finished archive contents before upload
- import a new CES app or re-import an existing one via `apps:importApp`
- build incremental plans for `toolsets/`, `tools/`, and `agents/`, with local hash-based state under `.ces-validator/`
- write per-run JSON artifacts under `.ces-validator/artifacts/` and surface them in the Package Explorer
- reuse your last-used project/location/app ID values per package root

> **Requirements:** ZIP packaging/import needs `zip`, `unzip`, and `gcloud`. Incremental push needs `gcloud` and currently applies create/patch operations for toolsets, tools, and agents (it does not delete remote resources).

### Clickable tool navigation

In the **Tool Inventory** section of the CES Package Explorer, and inside agent-specific **Tools** / **Toolsets** sections, clicking a tool now jumps directly to its definition:

- **Python tools** open the underlying `pythonCode` file when available
- **OpenAPI operations** open the matching schema file at the relevant `operationId`
- **Toolset references** open the toolset manifest, with nested operations opening the schema target
- tools without a direct code target fall back to their manifest file

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
| `CES Validator: Package Current Package` | Validate and create a deployable ZIP archive for the current CES package |
| `CES Validator: Import Current Package to CES` | Package the current CES package and import it as a new or existing CES app |
| `CES Validator: Push Current Package Incrementally to CES` | Validate the current CES package, show a resource-level plan, and create/patch changed toolsets, tools, and agents |
| `CES Validator: Show Current Package Deployment Status` | Open the latest local deployment state and artifact summary for the current CES package |
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
npm test               # Runs all 105 tests
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
│   └── ces-package-validator-0.12.0.vsix # Pre-built extension
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

## 📋 Changelog

The full release history also lives in [`CHANGELOG.md`](./CHANGELOG.md).

### 0.12.0 (2026-03-30)

**Callback visibility and packaging hardening:**

- Package Explorer now shows agent callback attachments directly under each agent
- Callback validation and deployment now share the same callback field list, including `beforeAgentCallbacks`
- Python tool aliases are recognized consistently across direct-tool inventory and evaluation validation
- Packaging no longer depends on filename-specific exclusions tied to external helper scripts

### 0.11.1 (2026-03-29)

**Deployment reliability fixes:**

- Incremental CES push now revalidates remote existence for locally tracked resources before reporting a no-op
- Built-in CES tools like `end_session` are preserved during incremental agent creation
- Packaging now excludes import-unsafe root helper files and validates unsupported root ZIP entries before CES import

### 0.11.0 (2026-03-28)

**Incremental CES deployment and status tracking:**

- Added incremental CES push planning and apply support for toolsets, tools, and agents
- Added local deployment-state artifacts under `.ces-validator/` and a command to open the latest status summary
- Package Explorer now shows the latest deployment plan/status details for faster rollout checks
- Added regression tests covering incremental deployment planning and status reporting

### 0.10.2 (2026-03-27)

**Tree navigation improvements:**

- Clicking agent instructions now opens the underlying `instruction.txt` file directly in VS Code
- Global instruction nodes in the explorer now open `global_instruction.txt`
- File-backed subagent tool references now use a dedicated extension command for reliable navigation
- Added regression tests covering instruction navigation targets

### 0.10.1 (2026-03-27)

**Bundled VSIX load fix:**

- Fixed instruction-contract file resolution in packaged VSIX builds
- Explorer load failures now show the underlying runtime error for faster troubleshooting
- Added regression tests for compiled and bundled contract-resolution layouts

### 0.10.0 (2026-03-27)

**Shared instruction contracts and stricter prompt validation:**

- Added shared declarative instruction contracts in `contracts/instruction-contract-rules.json`
- CES instruction files now validate required sections, allowed section order, and non-empty `<examples>` blocks
- Tool references and `tool_call(...)` examples are now checked against the owning agent's declared direct tools and attached toolset operations
- Added regression tests for the new instruction-contract parsing and validation flow

### 0.9.1 (2026-03-24)

**Clickable tool-definition navigation:**

- Tool Inventory entries now open tool definitions directly when clicked
- Agent node `Tools` and `Toolsets` sections now expose clickable references
- Python tools open their `pythonCode` implementation when available
- OpenAPI operations open the schema file at the matching `operationId`
- Toolset references open the toolset manifest, with nested operations opening schema targets

### 0.9.0 (2026-03-24)

**Packaging and CES deployment support:**

- Added `CES Validator: Package Current Package`
- Added `CES Validator: Import Current Package to CES`
- Added `CES Validator: Push Current Package to Remote CES App`
- Added archive-member validation to catch ZIP packaging mismatches before CES import fails
- Added CES `apps:importApp` integration using active `gcloud` credentials

### 0.8.1 (2026-03-12)

**Manifest import-compatibility hardening:**

- Added `CES_MANIFEST_IMPORT_INT32_INVALID` to catch known import-sensitive manifest fields that must be integer literals for CES import compatibility.
- First protected field: `evaluationMetricsThresholds.goldenEvaluationMetricsThresholds.turnLevelMetricsThresholds.semanticSimilaritySuccessThreshold`
- Rejects decimal values such as `2.5` and float-like literals such as `3.0` before VSIX users hit CX Studio import-time proto errors.
- Added focused regression tests and updated validation rule documentation.

### 0.7.0 (2026-02-12)

**Environment.json validation — alignment with official CES export docs:**

- **Toolsets no longer required** — `environment.json` can contain only `app` without `toolsets` (was incorrectly reported as an error)
- **`app` section validation** — validates structure of `app.loggingSettings` (for `AudioRecordingConfig.gcs_bucket`, `bigqueryExportSettings.project`)
  - `CES_ENVIRONMENT_APP_INVALID` — `app` is not an object
  - `CES_ENVIRONMENT_APP_LOGGING_INVALID` — `app.loggingSettings` is not an object
- **Unknown top-level keys** — warns about environment.json keys that are not `app` or `toolsets`
  - `CES_ENVIRONMENT_UNKNOWN_KEY` — unrecognised key in environment.json root
- **`$env_var` placeholder validation** — CES replaces managed fields with `"$env_var"` during export; if any manifest contains these placeholders but no `environment.json` exists, import will fail
  - `CES_ENV_VAR_NO_ENVIRONMENT` — manifest has `$env_var` placeholder(s) without environment.json

**Coverage alignment:** checks 13 (enhanced env.json validation) and 14 (new `$env_var` placeholder scanning) were added to match the standalone package validator.

### 0.6.0 (2026-02-12)

**New rules — aligned with standalone validator gap analysis (sample app coverage):**

- **Agent callback pythonCode validation** — validates all 5 callback types (`afterAgentCallbacks`, `beforeModelCallbacks`, `afterModelCallbacks`, `afterToolCallbacks`, `beforeToolCallbacks`)
  - `CES_CALLBACK_CODE_MISSING` — referenced `.py` callback file does not exist
  - `CES_CALLBACK_MISSING_CODE_PATH` — callback entry has no `pythonCode` path
- **Agent tools[] existence** — verifies each tool in agent `tools: [...]` resolves to `tools/<name>/<name>.json` or is a known built-in
  - `CES_AGENT_TOOL_NOT_FOUND` — tool name has no matching folder and is not `end_session`
- **Environment.json toolset cross-references** — validates that toolset names in `environment.json` match existing `toolsets/` directories
  - `CES_ENVIRONMENT_TOOLSET_NOT_FOUND` — environment references a toolset that doesn't exist on disk
- **Golden evaluation `agentResponse.role` validation** — verifies role names in golden eval expectations match known agents
  - `CES_EVALUATION_AGENT_ROLE_UNKNOWN` — role doesn't match any agent directory (warning)
- **Scenario evaluation tool references** — validates `expectedToolCall` and `mockToolResponse` in scenario-based evaluations
  - `CES_EVALUATION_SCENARIO_TOOL_UNKNOWN` — `expectedToolCall` tool not found in tools/toolsets
  - `CES_EVALUATION_SCENARIO_MOCK_TOOL_UNKNOWN` — `mockToolResponse` tool not found in tools/toolsets

### 0.5.0 (2026-02-09)

**New rules — aligned with standalone validator coverage:**

- **Python function tools** (`tools/` directory) — validates `pythonFunction.pythonCode` file exists
  - `CES_PYTHON_TOOL_MANIFEST_INVALID` — invalid manifest JSON
  - `CES_PYTHON_TOOL_MISSING_FUNCTION` — missing `pythonFunction` object
  - `CES_PYTHON_TOOL_MISSING_CODE_PATH` — missing `pythonCode` path
  - `CES_PYTHON_TOOL_CODE_MISSING` — referenced `.py` file does not exist
  - Python function tools are registered as direct tools in the tool inventory
- **Namespaced OpenAPI refs in evaluations** (L-01 hardening) — `toolset.operationId` form (e.g. `location.searchBranches`) is now specifically caught as `CES_EVALUATION_TOOLCALL_OPENAPI_OPERATION` instead of falling through to "unknown tool"

### 0.4.0 (2026-02-08)

- Initial public release with full CES package validation

---

## License

UNLICENSED — Internal use only.
