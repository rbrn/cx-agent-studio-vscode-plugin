# CES Package Validation Rules — Complete Reference

> **Auto-generated from source:** `ces-plugin/src/core/rules.ts` (v0.8.0) and `ces-agent/scripts/validate-package.py`
>
> Last updated: 2026-03-12

This document is the single source of truth for every validation check performed by the **CES Package Validator VS Code Extension** and the **standalone Python validation script**. Both tools aim for parity — where a check exists in one but not the other, it is noted.

---

## Coverage Matrix

| # | Category | Python check | Plugin diagnostic codes | Count |
|---|----------|:------------:|:-----------------------:|:-----:|
| 1 | [Manifest](#1-manifest) | ✅ 1, 1a | 6 codes | 6 |
| 2 | [Root agent](#2-root-agent) | ✅ 2 | 3 codes | 3 |
| 3 | [Global instruction](#3-global-instruction) | ✅ 3 | 1 code | 1 |
| 4 | [Guardrails](#4-guardrails) | ✅ 4 | 3 codes | 3 |
| 5 | [Agents](#5-agents) | ✅ 5, 10 | 5 codes | 5 |
| 6 | [Agent callbacks](#6-agent-callbacks) | ✅ 11 | 2 codes | 2 |
| 7 | [Agent tools](#7-agent-tools) | ✅ 12 | 1 code | 1 |
| 8 | [Toolsets & OpenAPI](#8-toolsets--openapi) | ✅ 6, 7 | 5 codes | 5 |
| 9 | [Python function tools](#9-python-function-tools) | ✅ 7b | 4 codes | 4 |
| 10 | [Google Search tools](#10-google-search-tools) | ✅ 7b | 4 codes | 4 |
| 11 | [Evaluations](#11-evaluations) | ✅ 9 | 7 codes | 7 |
| 12 | [Instructions](#12-instruction-files) | ✅ 5b | 11 codes | 11 |
| 13 | [Environment](#13-environment) | ✅ 13 | 8 codes | 8 |
| 14 | [$env_var placeholders](#14-env_var-placeholders) | ✅ 14 | 1 code | 1 |
| 15 | [Nesting depth](#15-nesting-depth) | — | 3 codes | 3 |
| 16 | [Unsupported dirs](#16-unsupported-directories) | — | 1 code | 1 |
| | | | **Total** | **60** |

---

## 1. Manifest

Validates that a CES package root contains a valid `app.json` or `app.yaml`.

| Diagnostic Code | Severity | Description | Python |
|-----------------|----------|-------------|:------:|
| `CES_MANIFEST_MISSING` | error | Neither `app.json` nor `app.yaml` found | ✅ #1 |
| `CES_MANIFEST_BOTH_PRESENT` | warning | Both `app.json` and `app.yaml` exist (ambiguous) | — |
| `CES_APP_JSON_ONLY` | info | Only `app.json` found; `app.yaml` is preferred | — |
| `CES_MANIFEST_PARSE_ERROR` | error | Manifest file is not valid JSON/YAML | ✅ #1 |
| `CES_MANIFEST_INVALID_ROOT` | error | Parsed manifest root is not an object | — |
| `CES_MANIFEST_IMPORT_INT32_INVALID` | error | Known import-sensitive manifest field uses a non-integer value (for example decimal `semanticSimilaritySuccessThreshold`) | ✅ #1a |

---

## 2. Root Agent

Verifies the `rootAgent` field in the manifest references a valid agent directory.

| Diagnostic Code | Severity | Description | Python |
|-----------------|----------|-------------|:------:|
| `CES_ROOT_AGENT_MISSING` | error | Manifest has no `rootAgent` field | ✅ #2 |
| `CES_ROOT_AGENT_DIR_MISSING` | error | `agents/<rootAgent>/` directory not found | ✅ #2 |
| `CES_ROOT_AGENT_MANIFEST_MISSING` | error | Agent directory exists but `<name>.json` missing | ✅ #2 |

---

## 3. Global Instruction

Validates the `globalInstruction` path in the manifest.

| Diagnostic Code | Severity | Description | Python |
|-----------------|----------|-------------|:------:|
| `CES_GLOBAL_INSTRUCTION_MISSING` | error | `globalInstruction` path does not exist on disk (also detects inlined text) | ✅ #3 |

---

## 4. Guardrails

Validates guardrail references in the manifest against `guardrails/` directories. Handles the CES convention where `app.json` uses spaces but folder names use underscores (L-04).

| Diagnostic Code | Severity | Description | Python |
|-----------------|----------|-------------|:------:|
| `CES_GUARDRAIL_REFERENCE_MISSING` | error | Guardrail folder/manifest not found for a declared guardrail | ✅ #4 |
| `CES_GUARDRAIL_JSON_INVALID` | error | Guardrail manifest is not valid JSON | ✅ #4 |
| `CES_GUARDRAIL_DISPLAYNAME_MISMATCH` | warning | Guardrail `displayName` doesn't match folder name | ✅ #4 |

---

## 5. Agents

Validates each agent directory under `agents/`.

| Diagnostic Code | Severity | Description | Python |
|-----------------|----------|-------------|:------:|
| `CES_AGENT_MANIFEST_INVALID` | error | Agent manifest is not valid JSON | — |
| `CES_AGENT_INSTRUCTION_MISSING` | error | Agent manifest has no `instruction` field | ✅ #5 |
| `CES_AGENT_INSTRUCTION_PATH_MISMATCH` | warning | Instruction path doesn't follow convention `agents/<name>/instruction.txt` | — |
| `CES_AGENT_INSTRUCTION_FILE_MISSING` | error | Instruction file referenced in manifest doesn't exist | ✅ #5 |
| `CES_CHILD_AGENT_MISSING` | error | `childAgents` entry references a non-existent agent directory | ✅ #10 |
| `CES_AGENT_TOOLSET_REFERENCE_MISSING` | error | Agent `toolsets[].toolset` references a toolset that matches neither a `toolsets/` directory name nor a toolset manifest `displayName` | ✅ #6 |

---

## 6. Agent Callbacks

Validates all 5 callback types: `afterAgentCallbacks`, `beforeModelCallbacks`, `afterModelCallbacks`, `afterToolCallbacks`, `beforeToolCallbacks`.

| Diagnostic Code | Severity | Description | Python |
|-----------------|----------|-------------|:------:|
| `CES_CALLBACK_MISSING_CODE_PATH` | warning | Callback entry has no `pythonCode` path | ✅ #11 |
| `CES_CALLBACK_CODE_MISSING` | error | Callback `pythonCode` path doesn't exist on disk | ✅ #11 |

---

## 7. Agent Tools

Validates each entry in agent `tools: [...]` arrays.

| Diagnostic Code | Severity | Description | Python |
|-----------------|----------|-------------|:------:|
| `CES_AGENT_TOOL_NOT_FOUND` | error | Tool name matches neither a `tools/<name>/<name>.json` directory ID nor a tool manifest `displayName`/`pythonFunction.name`, and is not a known built-in (`end_session`) | ✅ #12 |

---

## 8. Toolsets & OpenAPI

Validates toolset manifests and their OpenAPI schemas.

| Diagnostic Code | Severity | Description | Python |
|-----------------|----------|-------------|:------:|
| `CES_TOOLSET_MANIFEST_INVALID` | error | Toolset manifest is not valid JSON | ✅ #7 |
| `CES_OPENAPI_SCHEMA_MISSING` | error | Toolset declares `openApiSchema` but path doesn't exist | ✅ #7 |
| `CES_OPENAPI_SCHEMA_NOT_FOUND` | error | No schema file found in `open_api_toolset/` directory | ✅ #7 |
| `CES_OPENAPI_PARSE_ERROR` | error | OpenAPI schema is not valid YAML/JSON | — |
| `CES_OPENAPI_INVALID_ROOT` | error | Parsed OpenAPI schema root is not an object | — |
| `CES_OPENAPI_VERSION_MISSING` | warning | OpenAPI schema missing `openapi` or `swagger` version field | — |

---

## 9. Python Function Tools

Validates Python function tool manifests under `tools/`. Tools with a `googleSearchTool` key are handled separately in [§10](#10-google-search-tools).

| Diagnostic Code | Severity | Description | Python |
|-----------------|----------|-------------|:------:|
| `CES_PYTHON_TOOL_MANIFEST_INVALID` | error | Tool manifest is not valid JSON | ✅ #7b |
| `CES_PYTHON_TOOL_MISSING_FUNCTION` | error | Manifest missing `pythonFunction` object (and not a `googleSearchTool`) | ✅ #7b |
| `CES_PYTHON_TOOL_MISSING_CODE_PATH` | error | `pythonFunction.pythonCode` path not defined | ✅ #7b |
| `CES_PYTHON_TOOL_CODE_MISSING` | error | Referenced `.py` file doesn't exist on disk | ✅ #7b |

---

## 10. Google Search Tools

Validates Google Search (Vertex AI Search) tool manifests under `tools/`. These tools use a `googleSearchTool` key instead of `pythonFunction` and reference either inline `contextUrls` or a Vertex AI Search `dataStoreId`.

| Diagnostic Code | Severity | Description | Python |
|-----------------|----------|-------------|:------:|
| `CES_GOOGLE_SEARCH_TOOL_MISSING_SOURCE` | error | `googleSearchTool` has neither `contextUrls` nor `dataStoreId` — no data source configured | ✅ #7b |
| `CES_GOOGLE_SEARCH_TOOL_DUAL_SOURCE` | warning | Both `contextUrls` and `dataStoreId` present — ambiguous data source; prefer `dataStoreId` for production | ✅ #7b |
| `CES_GOOGLE_SEARCH_TOOL_DATASTORE_FORMAT` | warning | `dataStoreId` doesn't match expected format `projects/*/locations/*/collections/*/dataStores/*` | ✅ #7b |
| `CES_GOOGLE_SEARCH_TOOL_INVALID_URL` | error | `contextUrls` entry is empty or not a string | ✅ #7b |

**Key constraint (L-01):** Golden evaluations cannot use `toolCall` expectations with Google Search tools — use `agentResponse` expectations instead. See [§11 → `CES_EVALUATION_TOOLCALL_GOOGLE_SEARCH`](#11-evaluations).

---

## 11. Evaluations

Validates evaluation manifests under `evaluations/`, including golden and scenario-based evaluation structures.

| Diagnostic Code | Severity | Description | Python |
|-----------------|----------|-------------|:------:|
| `CES_EVALUATION_MANIFEST_INVALID` | error | Evaluation manifest is not valid JSON | — |
| `CES_EVALUATION_DISPLAYNAME_MISMATCH` | warning | `displayName` differs from folder name | ✅ #9 |
| `CES_EVALUATION_TOOLCALL_OPENAPI_OPERATION` | error | Golden eval `toolCall` references an OpenAPI operation (L-01: CES only accepts direct tools) | ✅ #9 |
| `CES_EVALUATION_TOOLCALL_GOOGLE_SEARCH` | error | Golden eval `toolCall` references a Google Search tool (L-01: use `agentResponse` expectations instead) | ✅ #9 |
| `CES_EVALUATION_TOOLCALL_UNKNOWN` | error | Golden eval `toolCall` references an unknown tool | ✅ #9 |
| `CES_EVALUATION_AGENT_ROLE_UNKNOWN` | warning | Golden eval `agentResponse.role` doesn't match any agent directory | ✅ #9b |
| `CES_EVALUATION_SCENARIO_TOOL_UNKNOWN` | error | Scenario `expectedToolCall.tool` not found in tools/toolsets | ✅ #9c |
| `CES_EVALUATION_SCENARIO_MOCK_TOOL_UNKNOWN` | error | Scenario `mockToolResponse.tool` not found in tools/toolsets | ✅ #9c |

---

## 12. Instruction Files

Validates CES instruction files (`instruction.txt`, `global_instruction.txt`) against the shared declarative contract in `ces-plugin/contracts/instruction-contract-rules.json`. The Python script and plugin now use the same rule set.

| Diagnostic Code | Severity | Description | Python |
|-----------------|----------|-------------|:------:|
| `CES_INSTRUCTION_PARSE_ERROR` | error | Instruction file has unclosed XML sections | ✅ 5b |
| `CES_INSTRUCTION_CONTRACT_MISSING` | warning | No shared instruction contract matched the file path | ✅ 5b |
| `CES_INSTRUCTION_MISSING_SECTION` | error | Contract-required top-level section is missing | ✅ 5b |
| `CES_INSTRUCTION_UNEXPECTED_SECTION` | error | Top-level section is present but not allowed by the matched contract | ✅ 5b |
| `CES_INSTRUCTION_SECTION_ORDER_INVALID` | error | Top-level sections are present but out of contract order | ✅ 5b |
| `CES_INSTRUCTION_EXAMPLES_EMPTY` | error | `<examples>` section exists but contains no `<example>` blocks | ✅ 5b |
| `CES_INSTRUCTION_AGENT_REF_UNKNOWN` | error | `{@AGENT:name}` references unknown agent | ✅ 5b |
| `CES_INSTRUCTION_TOOL_REF_UNKNOWN` | error | `{@TOOL:name}` references a direct tool not declared by the owning agent | ✅ 5b |
| `CES_INSTRUCTION_TOOLCALL_UNKNOWN_TOOLSET` | error | `tool_call("toolset.op")` references a toolset not attached to the owning agent | ✅ 5b |
| `CES_INSTRUCTION_TOOLCALL_UNKNOWN_OPERATION` | error | `tool_call("toolset.op")` references an undeclared operation within an attached toolset | ✅ 5b |
| `CES_INSTRUCTION_TOOLCALL_UNKNOWN_TOOL` | error | `tool_call("tool")` references an unknown direct tool | ✅ 5b |

---

## 13. Environment

Validates `environment.json` structure and cross-references. Aligned with the [official CES export docs](https://docs.cloud.google.com/customer-engagement-ai/conversational-agents/ps/export).

| Diagnostic Code | Severity | Description | Python |
|-----------------|----------|-------------|:------:|
| `CES_ENVIRONMENT_PARSE_ERROR` | error | `environment.json` is not valid JSON | ✅ #13 |
| `CES_ENVIRONMENT_INVALID_ROOT` | error | Parsed root is not an object | ✅ #13 |
| `CES_ENVIRONMENT_UNKNOWN_KEY` | warning | Unknown top-level key (expected: `app`, `toolsets`) | ✅ #13 |
| `CES_ENVIRONMENT_TOOLSETS_INVALID` | error | `toolsets` is present but not an object | ✅ #13 |
| `CES_ENVIRONMENT_TOOLSET_ENTRY_INVALID` | error | Individual toolset entry is not an object | ✅ #13 |
| `CES_ENVIRONMENT_OPENAPI_TOOLSET_INVALID` | error | `openApiToolset` within a toolset entry is not an object | — |
| `CES_ENVIRONMENT_OPENAPI_URL_INVALID` | error | `openApiToolset.url` is not a string | — |
| `CES_ENVIRONMENT_APP_INVALID` | error | `app` is present but not an object | ✅ #13 |
| `CES_ENVIRONMENT_APP_LOGGING_INVALID` | error | `app.loggingSettings` is not an object | ✅ #13 |
| `CES_ENVIRONMENT_TOOLSET_NOT_FOUND` | error | Toolset name in env.json matches neither a `toolsets/` directory name nor a toolset manifest `displayName` | ✅ #13 |
| `CES_ENVIRONMENT_LOCALHOST_WARNING` | warning | Contains `localhost` or `127.0.0.1` URLs | — |

---

## 14. $env_var Placeholders

CES replaces certain managed fields with the literal string `"$env_var"` during export. On import, these are substituted from `environment.json`. This check detects orphaned placeholders.

| Diagnostic Code | Severity | Description | Python |
|-----------------|----------|-------------|:------:|
| `CES_ENV_VAR_NO_ENVIRONMENT` | error | Manifest contains `$env_var` placeholder(s) but no `environment.json` exists | ✅ #14 |

**Scanned manifests:** `app.json`/`app.yaml`, all agent manifests, all tool manifests, all toolset manifests.

---

## 15. Nesting Depth

Warns when directory nesting exceeds standard CES patterns. **Plugin-only.**

| Diagnostic Code | Severity | Description | Python |
|-----------------|----------|-------------|:------:|
| `CES_NESTING_DEPTH_EXCEEDED` | warning | File nested > 2 levels deep in `agents/`, `tools/`, `evaluations/`, `guardrails/` | — |
| `CES_TOOLSET_NESTING_DEPTH_EXCEEDED` | warning | File nested > 3 levels deep in `toolsets/` | — |
| `CES_GUARDRAIL_NESTING_DEPTH_EXCEEDED` | warning | File nested > 2 levels deep in `guardrails/` | — |

---

## 16. Unsupported Directories

Flags directories that CES does not support during import. **Plugin-only.**

| Diagnostic Code | Severity | Description | Python |
|-----------------|----------|-------------|:------:|
| `CES_UNSUPPORTED_IMPORT_DIRECTORY` | warning | Non-standard directory (e.g. `evaluationDatasets`) found at package root | — |

---

## Python Script Check Index

Quick reference mapping Python script check numbers to categories above:

| Python # | What it checks | Section |
|:--------:|----------------|:-------:|
| 1 | `app.json` exists and parses | [§1](#1-manifest) |
| 1a | Known manifest import-compatibility rules (for example int32-only threshold fields) | [§1](#1-manifest) |
| 2 | `rootAgent` resolves | [§2](#2-root-agent) |
| 3 | `globalInstruction` path exists | [§3](#3-global-instruction) |
| 4 | Guardrail cross-references | [§4](#4-guardrails) |
| 5 | Agent instruction paths | [§5](#5-agents) |
| 6 | Agent toolset references | [§5](#5-agents) |
| 7 | Toolset OpenAPI schemas | [§8](#8-toolsets--openapi) |
| 7b | Python function tools | [§9](#9-python-function-tools) |
| 8 | Tool inventory (informational) | — |
| 9 | Evaluation golden toolCalls (L-01) | [§10](#10-evaluations) |
| 9b | Evaluation agentResponse.role | [§10](#10-evaluations) |
| 9c | Scenario evaluation tool refs | [§10](#10-evaluations) |
| 10 | childAgent references | [§5](#5-agents) |
| 11 | Callback pythonCode files | [§6](#6-agent-callbacks) |
| 12 | Agent tools[] existence | [§7](#7-agent-tools) |
| 13 | environment.json validation | [§12](#12-environment) |
| 14 | $env_var placeholders | [§13](#13-env_var-placeholders) |

---

## Plugin-Only Features (not in Python script)

These features exist only in the VS Code extension:

- **Instruction file parsing** (§11) — structural validation of `instruction.txt` files
- **Nesting depth warnings** (§14) — directory depth limits
- **Unsupported directory warnings** (§15) — e.g. `evaluationDatasets`
- **OpenAPI schema deep validation** — parse errors, missing version fields
- **`app.json`-only info** — recommends `app.yaml`
- **Both manifests warning** — when both `app.json` and `app.yaml` exist
- **Localhost URL warning** — environment.json contains development URLs
- **Real-time diagnostics** — issues appear in VS Code Problems panel as you edit
- **Package Explorer tree view** — visual overview of package structure
- **Syntax highlighting** — for CES instruction files
