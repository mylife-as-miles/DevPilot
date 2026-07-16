# DevPilot Desktop Identifier Inventory

## Milestone-one desktop identity

| Surface | Production value | Development value | Status |
| --- | --- | --- | --- |
| Product and window name | `DevPilot` | `DevPilot (dev)` | DevPilot-owned |
| Electron application identifier | `com.devpilot.desktop` | `com.devpilot.desktop.dev` | DevPilot-owned |
| Desktop package | `devpilot-desktop` | same | DevPilot-owned |
| Desktop companion command | `devpilot-app` | `devpilot-app-dev` | Reserved; runtime command remains `devpilot` |
| Deep-link scheme | `devpilot://` | `devpilot-dev://` | New installs only; Happier compatibility parsing is retained until migration is designed |
| Repository | `mylife-as-miles/DevPilot` | same | DevPilot-owned |
| Runtime repository | `mylife-as-miles/DevPilot` | root `src/` package | Repository-local runtime |
| Electron updates | disabled | disabled | No Happier release endpoints; DevPilot signing/update lane is not configured yet |
| Expo updates | disabled by default | disabled by default | Internal web export remains available; mobile delivery is deferred |
| Associated domains | disabled | disabled | Hosted web/mobile links are deferred |

## Preserved compatibility identifiers

The imported `.happier` storage directory, protocol field names, cryptographic
namespaces, session metadata, daemon compatibility names, and accepted legacy
deep-link schemes are not renamed in this phase. Changing them could orphan
existing encrypted state or break protocol compatibility. A later migration
must define dual-read/dual-write behavior, rollback, and data verification before
those identifiers change.

## Deferred identifiers

These values intentionally remain unset until their owning infrastructure
exists: updater signing identity and public key, Windows Store identity, Apple
signing team, Linux repository coordinates, OAuth callbacks, notification
channels, telemetry and crash-reporting projects, hosted API/relay origins, and
mobile store identifiers.

No production desktop configuration points to Happier-hosted update
infrastructure. Happier URLs that remain in tests or compatibility layers are
upstream protocol/reference fixtures, not DevPilot production service defaults.
