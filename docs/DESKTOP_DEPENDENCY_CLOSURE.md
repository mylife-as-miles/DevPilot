# DevPilot Desktop Dependency Closure

This audit describes the source closure needed to build the Happier-derived
Electron desktop shell without making a clean DevPilot build depend on the
ignored `happier/` checkout.

## Verified closure state

`apps/ui/scripts/ensureWorkspacePackagesBuilt.mjs` recognizes the tracked
DevPilot Yarn workspace and no longer delegates to the upstream stack helper's
full-services-monorepo test. The retained `@happier-dev/*` packages resolve
from DevPilot's own `packages/` workspaces. The UI typecheck passes with an
8 GB Node heap via `apps/ui/scripts/typecheck.mjs`.

| Historical failure | Classification | Resolution |
| --- | --- | --- |
| `apps/ui must be run from inside the Happier monorepo checkout` | Incorrect upstream monorepo guard | Replaced by a DevPilot workspace check; no `happier/` clone required. |
| `featureTestGating` absent from `scripts/testing` | Missing generated/support file | Added a local no-hosted-feature gate. |
| `research` rejected by local mobile-surface persistence | Actual DevPilot type error | Added the `research` persisted-surface variant. |
| DevPilot labels missing in non-English locales | Actual DevPilot code error | Added safe fallback labels to retained locales. |
| UI `tsc` OOM near 4 GB | Environment/resource limit | Repository script raises the typecheck heap to 8 GB. |

`apps/cli` is intentionally excluded from the desktop typecheck command. The
Electron architecture launches the repository's Python `devpilot acp --stdio`
runtime and does not import the upstream Node daemon/terminal CLI. Keeping its
heavy hosted-provider build out of the desktop gate prevents an unreachable
feature from imposing a separate runtime closure.

Audit source: Happier `dev` at `212776ed66af179d1bb26a1d9a6fe9576441632c`.

## Required workspaces

| Workspace | Upstream location | Need | Phase | Classification |
| --- | --- | --- | --- | --- |
| `@happier-dev/app` | `apps/ui/` | React/Expo UI, internal web export, Tauri configuration, Rust shell, desktop assets, file/diff/session UI | Runtime and build | Required |
| `@happier-dev/bootstrap` | `apps/bootstrap/` | Builds the `hsetup` sidecar expected by `prepareTauriSidecar.mjs` and Tauri's `externalBin` configuration | Build and initial runtime | Required initially; replacement candidate |
| `@happier-dev/cli` | `apps/cli/` | Existing ACP plumbing, provider catalog, daemon/session lifecycle, local process and Git interfaces | Runtime and reference | Required initially while DevPilot provider replaces Happier-specific execution |
| `@happier-dev/stack` | selected `apps/stack/` files | Tauri development launcher and workspace build/process utilities imported by UI scripts | Development/build | Selected closure only |
| `@happier-dev/protocol` | `packages/protocol/` | Shared schemas, feature contracts, ACP/session and system-task protocol types | Runtime and build | Required |
| `@happier-dev/agents` | `packages/agents/` | Provider metadata and shared agent capabilities used directly by UI and CLI | Runtime and build | Required |
| `@happier-dev/cli-common` | `packages/cli-common/` | System tasks, first-party runtime resolution, shared CLI/Tauri bootstrap contracts | Runtime and build | Required |
| `@happier-dev/connection-supervisor` | `packages/connection-supervisor/` | Connection state and reconnection behavior used by UI and CLI | Runtime and build | Required |
| `@happier-dev/release-runtime` | `packages/release-runtime/` | Shared release/runtime component metadata imported by UI, CLI, and CLI common | Runtime and build | Required initially |
| `@happier-dev/transfers` | `packages/transfers/` | File-transfer contracts used by UI and CLI, built on protocol | Runtime and build | Required |
| `@happier-dev/audio-stream-native` | `packages/audio-stream-native/` | Direct dependency of the UI manifest | Build resolution | Retain initially; voice features deferred |
| `@happier-dev/sherpa-native` | `packages/sherpa-native/` | Direct dependency of the UI manifest | Build resolution | Retain initially; voice features deferred |

## Build-support closure

The imported workspace also needs:

- root `package.json`, `yarn.lock`, `app.json`, and `vitest.config.ts`;
- the package-local manifests, TypeScript configuration, Babel/Metro/Expo configuration, patches, and test configuration under the imported workspaces;
- `scripts/workspaces/` for TypeScript and package build helpers;
- the minimum postinstall helpers invoked by the retained root and workspace lifecycle scripts;
- selected `apps/stack/scripts/utils/` modules required by UI workspace build checks and Tauri launch;
- `apps/ui/src-tauri/`, excluding Android/iOS icon trees and mobile build output;
- desktop icon, public asset, translation, testkit, and source trees used by the internal Expo web export.

The internal Expo web export remains part of the Tauri build. It does not authorize a public web deployment.

## Key dependency paths

```text
apps/ui
  -> packages/agents
     -> packages/protocol
  -> packages/cli-common
     -> packages/agents
     -> packages/protocol
     -> packages/release-runtime
  -> packages/connection-supervisor
  -> packages/protocol
  -> packages/release-runtime
  -> packages/transfers
     -> packages/protocol
  -> packages/audio-stream-native
  -> packages/sherpa-native

apps/ui/scripts/prepareTauriSidecar.mjs
  -> apps/stack/scripts/utils/proc/pm.mjs
  -> apps/bootstrap
     -> packages/cli-common
     -> packages/protocol
```

## Explicitly excluded workspaces

| Workspace or area | Reason |
| --- | --- |
| `apps/server/` | Milestone one is local desktop operation and must not require Happier-hosted infrastructure. |
| `packages/relay-server/` | Hosted relay is deferred. |
| `apps/website/` | Public web product and deployment are deferred. |
| `apps/docs/` | Upstream documentation application is not a desktop runtime dependency. Relevant attribution and architecture knowledge are documented in DevPilot-owned docs. |
| `packages/tests/` | Broad upstream cross-product E2E harness is not required to build the desktop shell. Relevant UI, CLI, protocol, and package-local tests remain with imported workspaces. |
| Android and iOS build/release assets | Mobile products, store submission, signing, and mobile release pipelines are out of scope. |
| Happier deployment, signing, analytics, hosted updater, and credential material | Must not enter DevPilot history or production configuration. |

## Unresolved dependencies and migration decisions

1. The current UI includes hosted server and account assumptions. Their source may compile without `apps/server`, but the related screens and network paths must be disabled or replaced before the DevPilot desktop is considered locally functional.
2. `apps/bootstrap` is tightly coupled to Happier component installation and its `hsetup` sidecar. Retain it for the initial build, then reduce or replace it only after DevPilot runtime discovery and ACP startup work.
3. `apps/cli` provides proven local ACP and session infrastructure but also Happier daemon/provider behavior. DevPilot integration should extend canonical catalogs first, then delete obsolete Happier-specific runtime paths only after equivalent behavior is verified.
4. Audio and Sherpa packages are direct UI dependencies even though mobile/voice product work is deferred. Keep them in the initial import; remove them only after a successful desktop-only build proves the imports and native configuration are unnecessary.
5. The upstream Tauri config contains Happier identifiers and update endpoints. These are required rebrand inventory items, not values that may ship.
6. Rust/Cargo are absent on the current machine, so native closure validation is pending toolchain installation.

## Closure acceptance check

The closure is sufficient only when a fresh clone of DevPilot, with no `happier/` checkout present, can install dependencies, build workspace packages, typecheck, run unit tests, and produce the desktop frontend assets. Runtime discovery uses the repository-local `.venv` and must not make the desktop build fail when an override is unavailable.
