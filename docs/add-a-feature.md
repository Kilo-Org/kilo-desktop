# Add a feature

> **Note:** the original version of this tutorial predated the feature SDK and walked
> through the retired `LocalApi`/`IpcHandlers` architecture (typed `todos:*` channels,
> hand-written adapters). That path no longer exists: features program against
> `@anaconda-agentic-desktop/feature-sdk`, and todos itself now lives in
> `plugins/todos/` as the first real plugin.

## The current path

A feature ships two halves that communicate only through the SDK:

- **Backend** (`mainRegister`): register typed handlers with
  `mainSdk.channels(contract).handleAll({ ... })`; persist to your own SQLite file under
  `mainSdk.storageDir`. Expected failures throw `FeatureError`.
- **Frontend** (`useSdk`): call the backend through the typed proxy client
  (`useSdk<ServiceType>(featureId)`) with `useSdkQuery` / `useSdkMutation` from
  `@anaconda-agentic-desktop/sdk-react`.
- **Contract**: Zod channel map built with `defineContract` — one source of truth,
  validated on both sides of the boundary.
- **Registration**: add the feature to the `FEATURES` array
  (`apps/desktop/src/main/features/registry/features.ts`) and, for browser mode,
  `WEB_FEATURES` (`apps/web/src/features/features.ts`). Plugins instead ship a
  `plugin.json` and register in `BUNDLED_PLUGINS`.
- **UI surfaces**: declared statically in `plugin.json` `contributes` — `routes` (full
  pages the shell mounts), `nav` (sidebar entries), and `zones` (persistent status-bar /
  dashboard widgets, host-mounted at activation). No shell edits. The imperative
  `sdk.contribute` remains for conditional, page-scoped widgets.

## Follow these instead

| Resource                                                                            | Use it for                                                              |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [CONTEXT.md](../CONTEXT.md)                                                         | Architecture, terminology, and the rules feature code must follow       |
| [packages/feature-sdk/README.md](../packages/feature-sdk/README.md)                 | Quick start with the full backend + frontend example (the todos plugin) |
| [`.agents/skills/new-feature/`](../.agents/skills/new-feature/SKILL.md)             | Step-by-step scaffold for a new feature in `apps/`                      |
| [`.agents/skills/migrate-to-plugin/`](../.agents/skills/migrate-to-plugin/SKILL.md) | Moving a feature into `plugins/<id>/`                                   |
| **Live plugin reference:** `plugins/todos/`                                         | A complete self-contained plugin (routes, zones, own DB, e2e)           |

## Verify

The same gate CI runs:

```bash
pnpm check && pnpm lint && pnpm format:check && pnpm test
```

Every feature also ships at least one `@smoke` e2e spec — see
[docs/TESTING.md](TESTING.md).
