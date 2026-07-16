# Happier Upstream Base

## Revision

| Field | Value |
| --- | --- |
| Upstream repository | `https://github.com/happier-dev/happier` |
| Local reference directory | `happier/` (ignored) |
| Upstream branch | `dev` |
| Upstream commit | `212776ed66af179d1bb26a1d9a6fe9576441632c` |
| Import date | Imported 2026-07-14 through the tracked allowlist |

## Imported areas

- `apps/ui/` for the shared React/Expo desktop frontend and Tauri shell.
- `apps/bootstrap/` for the initial `hsetup` sidecar build dependency.
- `apps/cli/` for the proven local session, ACP, daemon, Git, and process interfaces that the first migration phase must preserve until DevPilot-native replacements work.
- Selected `apps/stack/` development and Tauri orchestration scripts.
- `packages/protocol/`, `packages/agents/`, `packages/cli-common/`, `packages/connection-supervisor/`, `packages/release-runtime/`, and `packages/transfers/`.
- `packages/audio-stream-native/` and `packages/sherpa-native/` initially because the desktop UI manifest resolves them directly; voice product work remains deferred.
- Root workspace manifests, lockfile, TypeScript/test configuration, and the minimum shared build helpers required by the imported workspaces.

The final allowlist is maintained by `scripts/import-happier-desktop.mjs` after the import-tooling phase. This document records the human-reviewed source revision rather than acting as the copy mechanism.

## Explicit exclusions

- `apps/server/`, `packages/relay-server/`, and hosted relay deployment assets.
- `apps/website/` and public web deployment assets.
- `apps/docs/` as an application workspace.
- Mobile release, store submission, signing, push-notification, Android, and iOS build artifacts.
- Upstream `.git/`, dependency directories, build output, caches, local environment files, credentials, signing keys, analytics keys, and error-reporting tokens.

## Known DevPilot-specific changes

- The upstream clone lives at `happier/` and is ignored by the DevPilot repository.
- The DevPilot runtime is the root Python package in this repository.
- The desktop runtime provider resolves this repository's `.venv` before falling back to `venv` or a global `devpilot` executable.
- User-facing product identity, Tauri identifiers, update endpoints, and runtime wiring will be DevPilot-owned.
- Happier hosted-service assumptions will be disabled, deferred, or replaced by local DevPilot ACP integration.

## Synchronization procedure

```powershell
git -C happier status
git -C happier fetch origin
git -C happier checkout dev
git -C happier pull --ff-only origin dev
git -C happier rev-parse HEAD

node scripts/import-happier-desktop.mjs --dry-run
```

The import dry-run must report upstream additions, changes, deletions, local differences, conflicts, safe imports, and manual-review items. It must never overwrite DevPilot-specific changes silently.
