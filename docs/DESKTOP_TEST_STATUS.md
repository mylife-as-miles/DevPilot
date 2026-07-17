# DevPilot Desktop Test Status

Recorded on Windows with Python 3.12.0, Node 24.14.0, and Yarn 1.22.22.

## Implemented and unit-tested

- `python -m pytest --collect-only -q` collects **2** tracked Python tests.
  They cover SDK configuration precedence and ACP JSON-only stdout/stderr
  isolation. This is the full currently tracked Python test scope, not a claim
  of a broad legacy runtime suite.
- `python -m pytest -vv` passes: **2 passed, 0 failed, 0 skipped**.
- `yarn test:runtime-discovery` passes: **8 Node tests**.
- `yarn electron:verify` passes: **2 Electron shell/security tests**.
- `yarn test:research` passes: **5 Node tests**.
- The local unauthenticated ACP route allowlist has a focused Node test.

## Type checking

`yarn workspace @happier-dev/app typecheck` passes when its repository-owned
script provisions an 8 GB Node heap. The imported UI program is large enough
to exceed Node's default ~4 GB heap; this is a resource setting, not a missing
Happier checkout. The historical `not-monorepo` failure is resolved by the
DevPilot workspace guard in `apps/ui/scripts/ensureWorkspacePackagesBuilt.mjs`.

`corepack yarn typecheck` passes after excluding the unreachable upstream Node
daemon CLI from the desktop-only gate. It remains a typecheck, not a package
build verification.

## Manually smoke-tested

- Repository-local `.venv\\Scripts\\devpilot.exe --version` succeeds.
- A real `devpilot acp --stdio` initialize request produces JSON-RPC on stdout
  only; malformed input diagnostics use stderr.
- Electron runtime-discovery and shell-boundary tests pass.

## Not yet integration-tested or packaged

- A deterministic renderer/Node ACP client → Python ACP → fake runtime prompt
  test is still pending.
- Electron Forge packaging and a packaged-app runtime-discovery smoke test are
  pending; no packaged verification is claimed.
- Python checkpoint-level `session/list/load/resume` ACP APIs remain deferred.
