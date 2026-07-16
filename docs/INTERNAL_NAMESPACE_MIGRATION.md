# Internal namespace migration

## Desktop milestone boundary

DevPilot Desktop is selectively rebranded for this milestone. User-visible product names, Electron window metadata, icons, onboarding, and local-runtime flow use **DevPilot**. The upstream TypeScript workspace remains compatible by design.

## Kept for compatibility

The following remain unchanged until a planned package migration:

- `@happier-dev/*` workspace package names and import paths.
- Protocol identifiers, RPC/message types, database migration keys, encryption namespaces, and persisted storage keys.
- Legacy deep-link schemes and compatibility IDs.
- Happier-derived configuration aliases such as `EXPO_PUBLIC_HAPPIER_SERVER_URL`; they are accepted only as compatibility inputs and are not the DevPilot desktop default.

These identifiers can be present in saved client state, encrypted payloads, other workspace packages, and upstream interoperability boundaries. Renaming them now would be a breaking data and package migration, not a desktop branding change.

## Cloud and Relay configuration

`api.happier.dev` remains an upstream compatibility endpoint; it is not renamed to a fictional DevPilot domain. The desktop launcher does not inject it by default.

`apps/ui/sources/config/devpilotServices.ts` is the product-facing configuration boundary:

```ts
export const devpilotServices = {
  apiUrl: process.env.EXPO_PUBLIC_DEVPILOT_API_URL ?? null,
  relayUrl: process.env.EXPO_PUBLIC_DEVPILOT_RELAY_URL ?? null,
  hostedServicesEnabled: false,
};
```

Hosted services are opt-in with `DEVPILOT_HOSTED_SERVICES=1`; a Relay URL is supplied only with `DEVPILOT_RELAY_URL`. The normal Electron flow is local and does not require an account, QR login, a hosted Relay, or cross-device sync.

## Local desktop flow

Electron resolves DevPilot in this order: configured executable, this repository's `.venv`/`venv`, then PATH. It verifies `devpilot --version`, allows the user to select a local project, and launches `devpilot acp --stdio` without a shell.

## Future migration plan

1. Publish and validate `@devpilot/*` workspace packages with compatibility shims.
2. Version and migrate protocol/message identifiers and storage records explicitly.
3. Introduce a real DevPilot API/Relay domain before changing hosted endpoint defaults.
4. Migrate encryption and deep-link namespaces only with import/export and rollback support.
5. Remove legacy Happier identifiers after compatibility telemetry and release support windows close.
