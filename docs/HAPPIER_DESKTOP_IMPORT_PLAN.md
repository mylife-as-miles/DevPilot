# Happier Desktop Import Plan

## Objective

Create a reviewable, repeatable import from the ignored `happier/` reference checkout into tracked DevPilot desktop paths. A clean DevPilot clone must build without the upstream checkout.

## Planned tracked layout

```text
apps/
  bootstrap/
  cli/
  stack/
  ui/
packages/
  agents/
  audio-stream-native/
  branding/
  cli-common/
  connection-supervisor/
  protocol/
  release-runtime/
  sherpa-native/
  transfers/
scripts/
docs/
package.json
yarn.lock
app.json
vitest.config.ts
```

`packages/branding/` is DevPilot-owned and is never sourced from Happier.

## Import allowlist

The import tool will use explicit source-to-target entries rather than copying the repository root:

```text
apps/bootstrap
apps/cli
apps/ui
apps/stack/package.json
apps/stack/bin
apps/stack/scripts/tauri_dev.mjs
apps/stack/scripts/utils
packages/agents
packages/audio-stream-native
packages/cli-common
packages/connection-supervisor
packages/protocol
packages/release-runtime
packages/sherpa-native
packages/transfers
scripts/workspaces
scripts/postinstall
package.json
yarn.lock
app.json
vitest.config.ts
LICENCE
```

Before the real import, the allowlist will be validated against local imports from the retained stack and UI scripts. Missing support files are added deliberately and documented in the generated report.

## Global exclusions

The import tool rejects or excludes:

- `.git/` at any depth;
- `node_modules/`, caches, temporary files, `dist/`, `build/`, and `target/`;
- `.env` and `.env.*` files;
- credentials, signing keys, updater keys, analytics keys, error-reporting tokens, and store credentials;
- `android/`, `ios/`, `.eas/`, store submission files, and mobile release scripts;
- `apps/ui/src-tauri/icons/android/` and `apps/ui/src-tauri/icons/ios/`;
- Happier website, docs-app, server, relay, deployment, and hosted-service assets;
- local generated sidecars and Tauri binaries;
- nested repository metadata or Git links.

## Conflict policy

1. Every copied file is hashed.
2. A missing target is reported as a safe addition.
3. An identical target is reported as unchanged.
4. A differing target is a conflict unless the file is explicitly marked upstream-owned in the import state.
5. DevPilot-owned files are never overwritten automatically.
6. Upstream deletions are reported but never applied automatically.
7. The real import stops before writing if any unsafe conflict exists.
8. Executable bits from the upstream Git index are restored on supported platforms.

## Import state and report

The tool will write a tracked source-state manifest and a generated report containing:

- upstream repository, branch, and SHA;
- import timestamp;
- allowlisted and excluded paths;
- upstream-added, upstream-changed, and upstream-deleted files;
- local differences and unsafe conflicts;
- safe additions and updates;
- manual-review requirements;
- rejected secret or nested-repository paths.

The report must be deterministic apart from the timestamp and must not include local secrets or full environment values.

## Commands

```powershell
node scripts/import-happier-desktop.mjs --dry-run
node scripts/import-happier-desktop.mjs
```

The implementation phase will add tests covering ignored-source verification, dry-run behavior, allowlist enforcement, secret and `.git` exclusion, conflict refusal, upstream SHA recording, executable permissions, and clean-clone independence.

## Post-import sequence

1. Replace the imported root workspace manifest with the DevPilot desktop-only workspace closure and clear root commands.
2. Keep the root Python runtime and packaging files in this repository. Do not import Python or React source into the wrong application boundary.
3. Remove `.gitmodules` once no parent-repository Git links remain.
4. Remove or relocate the legacy standalone project website because a public web product is deferred; retain only assets intentionally reused by the desktop application.
5. Add attribution in `NOTICE.md` and merge required third-party notices without losing existing DevPilot notices.
6. Add central DevPilot branding and rebrand only user-visible desktop surfaces and safe development identifiers.
7. Add repository-local `.venv` runtime discovery and readiness diagnostics.
8. Add the built-in `devpilot` ACP provider through Happier's canonical provider catalogs.
9. Replace hosted assumptions with local ACP-backed Research Run, Coordinator, Executor, evidence, report, memory, audit, Git, and approval views.
10. Run package tests and typechecks before attempting Tauri development and production builds.
