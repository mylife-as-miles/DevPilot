# Desktop Milestone Test Status

This file records what can be verified in the current Windows development environment without changing either repository's toolchain.

## Passing focused checks

- Happier import allowlist, exclusion, conflict, upstream-SHA, and nested-Git safeguards
- root desktop command preflight behavior
- central DevPilot branding configuration
- sibling/configured/active-environment/PATH runtime discovery and readiness probing
- Research Run event normalization, transcript extraction, reducer, selectors, parallel Executor isolation, approvals, evidence, artifacts, and usage
- DevPilot Python unit and integration suite after the ACP adapter changes
- TypeScript syntax transpilation for DevPilot provider and Research workspace integration files

## Environment-limited checks

The complete JavaScript dependency graph is not installed in this checkout. The offline Yarn cache is missing `@shopify/react-native-skia@2.2.12`, while the online install did not complete in the available session. Consequently the full workspace TypeScript and Vitest commands are not claimed as passing.

The Electron dependency installation did not complete in this environment: the existing large Yarn workspace graph stalled before dependency resolution produced output. Electron development startup, Forge production bundling, and installer verification remain unexecuted until `corepack yarn install` completes. The root scripts now fail quickly with an actionable dependency message and do not require Rust/Cargo or modify a separate runtime repository.

macOS and Linux packages require their respective CI or host environments. Android, iOS, public web deployment, and mobile end-to-end testing are intentionally outside this desktop milestone.

## Still deferred product coverage

- native searchable Memory, Skills, and Audits navigation backed by DevPilot SDK APIs
- interactive evidence source/open/copy actions and rich on-disk artifact viewers
- standard ACP permission decisions wired to every sensitive runtime operation
- a complete packaged-desktop smoke test on each supported desktop platform

These are explicit gaps, not silently skipped successes. They should be implemented and tested in focused follow-up phases before declaring the full acceptance matrix complete.
