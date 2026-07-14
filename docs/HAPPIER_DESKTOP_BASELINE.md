# Happier Desktop Baseline

Baseline date: 2026-07-14 (Africa/Lagos)

This document records the unchanged Happier desktop baseline before any source is imported into DevPilot. The reference checkout is local-only at `happier/` and is ignored by the DevPilot repository.

## Source state

| Item | Value |
| --- | --- |
| Upstream repository | `https://github.com/happier-dev/happier.git` |
| Branch | `dev` |
| Commit | `212776ed66af179d1bb26a1d9a6fe9576441632c` |
| Working tree | Clean after clone, fetch, checkout, and baseline commands |
| Desktop UI package | `@happier-dev/app` version `0.2.10` |
| Tauri JavaScript CLI | `~2.8.2` |
| Tauri Rust crate | `2.8.2` |
| Tauri minimum Rust version | `1.94.1` |

The checkout was established with a full fetch, checked out on `dev`, and fast-forwarded from `origin/dev`. No production changes were made inside `happier/`.

## Host toolchain

| Tool | Observed value |
| --- | --- |
| Operating system | Windows 10 Pro, build `26100` |
| Node.js | `v24.14.0` |
| Corepack | `0.34.6` |
| Yarn | `1.22.22` via `corepack yarn` |
| Rust | Not installed or not on `PATH` |
| Cargo | Not installed or not on `PATH` |

`corepack enable` could not write shims under `C:\Program Files\nodejs` and failed with `EPERM`. Running Yarn explicitly through Corepack works and reports the package-manager version declared by Happier.

## Command results

| Command | Result | Baseline evidence |
| --- | --- | --- |
| `corepack enable` | Failed | Windows denied creation of the Corepack `pnpm` shim under `C:\Program Files\nodejs`. |
| `corepack yarn install` | Incomplete | Dependency resolution started, then fetching remained in Yarn's network retry path. The process was stopped after an extended no-progress interval. |
| `corepack yarn install --network-timeout 600000` | Incomplete | A second cache-preserving attempt remained in dependency fetching without progress for more than ten minutes and was stopped cleanly. |
| `corepack yarn build:packages` | Failed | `typescript/bin/tsc` was unavailable because dependencies had not been linked. |
| `corepack yarn test` | Failed | `node_modules/vitest/vitest.mjs` was unavailable because dependencies had not been linked. |
| `corepack yarn tui:with-tauri` | Did not reach desktop | The interactive launcher did not produce a desktop window before timeout. Its child processes were stopped cleanly. Rust/Cargo are also absent. |

The build and test failures above are baseline environment/dependency failures. They predate DevPilot import or rebranding work and must not be attributed to DevPilot changes.

## Warnings and observations

- Node emitted the upstream `DEP0169` warning for legacy `url.parse()` usage during Yarn operations.
- The package graph is large and includes native, Expo, Tauri, voice, and provider dependencies; a successful install needs stable access to every referenced registry or Git source.
- Happier's Tauri build generates an internal Expo web export in `apps/ui/dist`. This is a desktop build input, not a public DevPilot web product.
- The unchanged Tauri configuration still uses Happier product identifiers and updater endpoints. Those values are inventory items for the rebrand phase and must not ship in a DevPilot production build.
- No Happier window was available for visual inspection in this baseline because the dependency and Rust prerequisites were not satisfied.

## Reproduction

From the ignored upstream checkout:

```powershell
corepack yarn install --network-timeout 600000
corepack yarn build:packages
corepack yarn test
corepack yarn tui:with-tauri
```

Install a Rust toolchain satisfying `apps/ui/src-tauri/Cargo.toml` before expecting Tauri development or production builds to complete.
