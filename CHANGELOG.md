# Changelog

All notable changes to `ces-package-validator` are documented in this file.

## 0.11.1 — 2026-03-29

### Fixed

- Incremental CES push now rechecks remote resource existence before trusting local deployment state, so missing remote resources are redeployed instead of being reported as a false no-op
- Incremental agent deployment now preserves built-in CES tools such as `end_session` instead of rewriting them as app-managed direct tool resource names
- Full CES package import now validates unsupported root-level ZIP members before upload instead of depending on filename-specific exclusions

### Changed

- Incremental deployment failure messages now explain when the target CES app must be bootstrapped first

## 0.11.0 — 2026-03-28

### Added

- Incremental CES deployment support for toolsets, tools, and agents with local hash-based state tracking under `.ces-validator/`
- Deployment artifact generation under `.ces-validator/artifacts/` plus a dedicated `CES Validator: Show Current Package Deployment Status` command
- Regression coverage for incremental deployment planning, apply flows, and deployment status summaries

### Changed

- The extension now presents an incremental deployment plan before applying remote CES changes, including actionable add/update/remove summaries
- The CES Package Explorer now surfaces the latest deployment plan and status details directly in the tree view

## 0.10.2 — 2026-03-27

### Added

- Direct tree-item navigation command that opens represented CES resources in VS Code
- Clickable navigation for agent `instruction.txt` nodes and global instruction nodes
- Regression coverage for instruction navigation targets

### Changed

- Agent instruction rows now act as direct openable resources, with structural metadata moved under a separate details node
- Subagent tool and other file-backed tree nodes now use the extension's dedicated open-resource command for more reliable editor navigation

## 0.10.1 — 2026-03-27

### Fixed

- VSIX builds now resolve `contracts/instruction-contract-rules.json` correctly in bundled extension layout
- CES Package Explorer load failures now surface the underlying runtime error message instead of only showing a generic failed-to-load state
- Added regression coverage for both compiled and bundled instruction-contract path resolution

## 0.10.0 — 2026-03-27

### Added

- Shared declarative instruction contract rules in `contracts/instruction-contract-rules.json`
- Instruction validation for contract matching, missing sections, unexpected sections, section ordering, and empty `<examples>` blocks
- Agent-aware validation for direct-tool references and attached toolset operation references used in instruction examples
- Regression coverage for shared instruction-contract parsing and validation behavior

### Changed

- The extension now validates CES instruction files against the same contract model used by the standalone package validator
- Instruction reference diagnostics are now scoped to each owning agent inventory instead of the package-wide tool inventory

## 0.9.1 — 2026-03-24

### Added

- CES Package Explorer tool inventory nodes now navigate to tool definitions when clicked
- Agent node `Tools` and `Toolsets` references now navigate to their definitions when clicked
- Direct Python tools open their `pythonCode` implementation when available
- OpenAPI operations open the schema file at the matching `operationId`
- Toolset references open the toolset manifest, with nested toolset operations opening their schema definition

## 0.9.0 — 2026-03-24

### Added

- New command: `CES Validator: Package Current Package`
- New command: `CES Validator: Import Current Package to CES`
- New command: `CES Validator: Push Current Package to Remote CES App`
- Shared deployment module for packaging CES packages, validating archive contents, and importing via CES `apps:importApp`
- Targeted deployment tests covering required archive members and missing direct-tool runtime files

### Changed

- The extension now validates the finished ZIP archive before upload so packaging exclusions are caught locally instead of failing later in CES
- Release documentation now reflects the packaged `0.9.0` VSIX and current test count

## 0.8.1 — 2026-03-12

### Added

- `CES_MANIFEST_IMPORT_INT32_INVALID` to catch known import-sensitive manifest fields that must be integer literals for CES import compatibility
- Protection for `evaluationMetricsThresholds.goldenEvaluationMetricsThresholds.turnLevelMetricsThresholds.semanticSimilaritySuccessThreshold`

### Changed

- Decimal values such as `2.5` and float-like literals such as `3.0` are rejected before CX Studio import-time proto errors occur
- Focused regression tests and validation-rule documentation were updated

## 0.7.0 — 2026-02-12

### Added

- Validation for `environment.json app.loggingSettings`
- Warning for unknown `environment.json` top-level keys
- Error when `$env_var` placeholders exist without `environment.json`

### Changed

- `environment.json` with only `app` is now accepted without requiring `toolsets`
- Standalone package validation coverage was updated to match the extension's environment checks

## 0.6.0 — 2026-02-12

### Added

- Validation for callback `pythonCode` files across all CES callback hooks
- Validation that agent `tools[]` references resolve to direct tools or known built-ins
- Validation that `environment.json` toolset references resolve to existing `toolsets/`
- Validation for golden evaluation `agentResponse.role`
- Validation for scenario evaluation `expectedToolCall` and `mockToolResponse`

## 0.5.0 — 2026-02-09

### Added

- Validation for Python function tool manifests and `pythonCode` paths
- Tracking for direct tools in the tool inventory
- L-01 hardening for namespaced OpenAPI operation references in evaluations

## 0.4.0 — 2026-02-08

### Added

- Initial public release with CES package validation, tree exploration, and instruction-file support
