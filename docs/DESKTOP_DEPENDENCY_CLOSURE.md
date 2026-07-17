# DevPilot Desktop Dependency Closure

The tracked repository is the complete desktop source closure. It does not
read source from an ignored `happier/` checkout and does not clone a sibling
DevPilot CLI repository.

```text
apps/ui (typed renderer)
  -> apps/desktop (preload and Electron IPC)
  -> packages/devpilot-runtime/acpProcessClient.cjs
  -> .venv/Scripts/devpilot.exe acp --stdio
  -> src/sdk -> Coordinator / Executors / runtime
```

The root `src/` directory remains the Python `devpilot` package. React and
Electron code remains under `apps/` and `packages/`, never under root `src/`.

## Verified workspace decisions

| Former issue | Classification | Desktop decision |
| --- | --- | --- |
| UI required the original Happier monorepo | Incorrect workspace assumption | `apps/ui/scripts/ensureWorkspacePackagesBuilt.mjs` recognizes the tracked DevPilot workspace. |
| UI typecheck exhausted the default Node heap | Environment/resource limit | `apps/ui/scripts/typecheck.mjs` provisions an 8 GB heap. |
| `featureTestGating` support module was absent | Missing support file | The local feature-test gate is supplied by `scripts/testing/featureTestGating.ts`. |
| Protocol baseline test reads `packages/tests/baselines` | Upstream cross-product fixture | That one test is explicitly excluded; DevPilot does not import the upstream fixture workspace. |
| Upstream `apps/cli` Node daemon builds/tests | Hosted/unused Node runtime | Excluded from desktop typecheck and unit gates. Electron calls Python ACP and does not import it. |
| `research` mobile persistence literal and DevPilot locale labels | DevPilot TypeScript errors | Corrected in the tracked UI workspace. |

## Retained internal packages

The imported `@happier-dev/*` names are retained as temporary internal
TypeScript package identities. They are local Yarn workspaces, not replacements
for the DevPilot Python runtime:

- `@happier-dev/protocol`, `@happier-dev/transfers`, and
  `@happier-dev/agents` provide UI contracts.
- `@happier-dev/cli-common`, `@happier-dev/connection-supervisor`, and
  `@happier-dev/bootstrap` are needed by the retained desktop UI build path.
- `@happier-dev/app` is the Happier-derived renderer under `apps/ui`.

`packages/devpilot-runtime` owns the reusable ACP child-process client. The
Electron packager copies it as an explicit resource, so packaged Electron does
not resolve a source file outside its application bundle.

## Explicitly outside the local desktop milestone

Hosted Relay, account authentication, QR login, public collaboration, push
notifications, the original Node daemon CLI, mobile targets, server packages,
and upstream cross-product test fixtures are not Electron runtime dependencies.
They are protected by route/feature gates or excluded from the desktop build
and test commands rather than copied into this repository.

## Validation boundary

`corepack yarn typecheck` and the focused desktop tests pass without an ignored
Happier checkout. A clean Windows environment must still run the package step
to prove the Forge artifact; the current workstation cannot do so while a live
Expo process locks `packages/cli-common/dist`.
