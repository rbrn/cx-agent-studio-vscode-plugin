# Changelog

All notable changes to `ces-package-validator` are documented in this file.

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
- `validate-package.py` was updated with matching environment validation coverage

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
