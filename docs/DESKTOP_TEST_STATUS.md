# DevPilot Desktop Test Status

Recorded on Windows on 2026-07-17 with Python 3.12.0, Node 24.14.0, and Yarn
1.22.22. Root and UI `node_modules` directories were present for these runs.

## Implemented and unit-tested

- `python -m pytest --collect-only -q` collects **2** tracked Python tests.
  This is the full tracked Python scope today, not a claim of a broad legacy
  suite.
- `python -m pytest -vv` passes: **2 passed, 0 failed, 0 skipped**. The tests
  cover SDK configuration precedence and ACP stdout/stderr isolation.
- `corepack yarn test:runtime-discovery` passes: **9 tests**. This includes
  repository runtime discovery plus the real ACP process integration test.
- `corepack yarn electron:verify` passes: **3 tests**. It checks the Electron
  shell boundary and that the shared ACP client is included in package
  resources.
- `corepack yarn test:research` passes: **5 tests**.
- `corepack yarn workspace @happier-dev/protocol test` passes: **209 files,
  1,240 tests**. The one test requiring the deliberately excluded upstream
  `packages/tests` fixture tree is excluded from the desktop closure.
- The local Electron ACP route allowlist has a focused Node test. Local ACP
  session routes work without cloud auth; hosted/browser routes remain gated.

## Integration-tested

`packages/devpilot-runtime/src/acpProcessClient.test.cjs` starts the actual
repository `.venv\\Scripts\\devpilot.exe` against a temporary clean Git
project. In an opt-in, no-network test mode it verifies `--version`, ACP
initialization, session creation, clean-project preflight, structured runtime
updates, a final result, JSON-RPC-only stdout, stderr draining, cancellation
acknowledgement, no unresolved request, and a fresh ACP process/session after
restart. It does not contact a Relay, Happier account, hosted API, or paid
model.

Electron consumes this same process-client implementation; it no longer keeps
a separate copy of ACP JSON-RPC request/response handling.

## Type checking

`corepack yarn typecheck` passes. The UI typecheck uses an 8 GB Node heap,
which is a resource requirement of the imported UI program. The DevPilot
workspace guard replaces the upstream `not-monorepo` assumption. The upstream
Node daemon CLI is excluded from desktop typecheck and unit-test gates because
the Electron application launches Python ACP instead of importing that daemon.

## Currently blocked locally

- `corepack yarn install --frozen-lockfile` did not complete or emit output
  within five minutes and was stopped. Existing root and UI dependency trees
  remain present, but a fresh-install completion is not claimed while the
  development server is active.
- `corepack yarn test:unit` reaches `@happier-dev/cli-common` after the
  protocol, transfers, and agents suites, then fails to rename
  `packages/cli-common/dist` with Windows `EPERM`. The same generated-directory
  lock also blocks `corepack yarn desktop:build`. An active Expo desktop server
  owns the directory. No test or package pass is claimed for either command.
- Electron Forge packaging and packaged-app runtime-discovery smoke testing are
  therefore **not yet verified locally**. Do not stop a user's development
  server merely to release this lock; run the package checks in a clean shell
  after it exits.

## Deferred

- Python checkpoint-level ACP `session/list`, `session/load`, and
  `session/resume` APIs. On restart the desktop reconnects safely to the
  selected project with a new process-local ACP session; it does not claim to
  resume an in-flight Coordinator run.
