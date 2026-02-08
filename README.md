# CES Package Validator Extension

Created by Codex on 2026-02-08.

VS Code extension MVP that validates Google Customer Engagement Suite (CES) / Dialogflow CX Agent Studio package structures in real time.

## Implemented MVP checks

- Manifest discovery and parse checks for `app.yaml` or `app.json`
- `rootAgent` reference validation
- `globalInstruction` path validation
- Guardrail reference resolution checks
- Agent manifest and `instruction.txt` path consistency checks
- Toolset manifest and OpenAPI schema existence/syntax checks
- Nesting depth checks for `agents`, `toolsets`, `guardrails`, `tools`, and `examples`
- Unsupported directory checks (`evaluations`, `evaluationDatasets`)
- `environment.json` structure checks and localhost warnings

## Commands

- `CES Validator: Validate Current Package`
- `CES Validator: Clear Diagnostics`

## Development

1. Install dependencies: `npm install`
2. Build extension: `npm run build`
3. Run tests: `npm test`
4. In VS Code, launch extension host from this folder.
