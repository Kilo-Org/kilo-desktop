# Plugin-Ready Development Guidelines

Guidelines for developing features in Agentic Desktop so they migrate to plugins with a filesystem move, not a rewrite. Features program against the shim SDK (`@anaconda-agentic-desktop/feature-sdk`) today; when a feature moves to `plugins/<id>/` (and later to an external repo), the source stays the same because it never touched shell internals.

This document is a companion to [CONTEXT.md](../CONTEXT.md) (architecture and terminology), [docs/add-a-feature.md](./add-a-feature.md) (the current path end-to-end), and the [new-feature](../.agents/skills/new-feature/SKILL.md) / [migrate-to-plugin](../.agents/skills/migrate-to-plugin/SKILL.md) skills (scaffolding and migration runbooks). Those win if anything here disagrees.

## Table of Contents

1. [Overview](#overview)
2. [Architecture Principles](#architecture-principles)
3. [Feature Structure](#feature-structure)
4. [Backend Design (Main Process)](#backend-design-main-process)
5. [Renderer Design](#renderer-design)
6. [State Management](#state-management)
7. [Communication Patterns](#communication-patterns)
8. [Tool Registration (AI Exposure)](#tool-registration-ai-exposure)
9. [UI Contributions](#ui-contributions)
10. [Dependency Management](#dependency-management)
11. [Migration Checklist](#migration-checklist)
12. [Quick Reference](#quick-reference)

---

## Overview

The migration path is:

```
Feature in apps/ → Plugin in plugins/ → Plugin in external repo
```

Each transition is a filesystem move. That only works if the feature already:

- Talks to its own backend exclusively through `sdk.invoke` / the typed `sdk.client` proxy — never raw IPC, never `LocalApi`.
- Registers typed handlers with `mainSdk.channels(contract).handleAll({ ... })`, validated by a Zod contract.
- Communicates with other features only through SDK primitives (`sdk.events`, `sdk.state`, `sdk.plugins.get`) — never by importing another feature's source.
- Declares UI in `plugin.json` `contributes` (or imperatively via `sdk.contribute`) instead of touching shell files.
- Registers in the `FEATURES` array — no feature-specific code in `Application.ts`.

**Goal**: a feature written today needs only file moves and import path rewrites to become a plugin.

---

## Architecture Principles

### 1. Program against the SDK, not the shell

Feature code imports from `@anaconda-agentic-desktop/feature-sdk`, `@anaconda-agentic-desktop/sdk-react`, `@anaconda-agentic-desktop/contracts` (schemas only), and `@anaconda-agentic-desktop/ui`. Nothing else from the shell.

```typescript
// GOOD
import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk";
import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk";

// BAD — shell internals; breaks the moment the feature becomes a plugin
import { someService } from "@/platform/...";
import { helper } from "@/lib/...";
```

`LocalApi` is reserved for shell-level services (theme, notifications, shell, filesystem). Features never add methods to it.

### 2. Isolate by domain, in three fixed locations

A feature lives in exactly three places:

```
apps/desktop/src/main/features/<id>/    # Node services, DB, handlers (mainRegister)
apps/web/src/features/<id>/             # React components, hooks
packages/contracts/src/features/<id>.ts # Zod channel map (the single source of truth)
```

Keep all feature logic inside these directories. Logic scattered across `services/`, `utils/`, `config/` directories cannot move as a unit.

### 3. Contract-first

The Zod contract is defined before either side is implemented. Main handlers and renderer calls are both typed and validated from the same channel map, so the two halves cannot drift apart.

### 4. Never import across features

Cross-feature communication goes through `sdk.events`, `sdk.state`, or `sdk.plugins.expose`/`get` — nothing else. `sdk.plugins.get()` returns `null` when the provider is missing or inactive; that graceful-null contract is what keeps features independently loadable and removable.

### 5. Register, don't wire

Adding a feature means adding an entry to the `FEATURES` array (`apps/desktop/src/main/features/registry/features.ts`) and, for browser mode, `WEB_FEATURES` (`apps/web/src/features/features.ts`). Never hand-edit `Application.ts`. Plugins instead ship a `plugin.json` and register in `BUNDLED_PLUGINS`; the loader feeds both into the same boot path, so features and plugins boot identically.

---

## Feature Structure

### Main-process feature

```
apps/desktop/src/main/features/<id>/
├── index.ts              # exports mainRegister (and the feature's registration surface)
├── <id>.service.ts       # domain logic
├── <id>.handlers.ts      # channel handlers bound to the contract
├── db/                   # SQLite + drizzle migrations, if the feature persists
└── __tests__/
```

### Renderer feature

```
apps/web/src/features/<id>/
├── index.ts              # public exports (page components, providers)
├── components/           # React components (function components + hooks only)
├── hooks/                # useSdkQuery / useSdkMutation wrappers
└── __tests__/
```

### Contract

```
packages/contracts/src/features/<id>.ts   # defineContract({ ... }) + shared Zod schemas
```

The contract file moves with the feature on migration (to `plugins/<id>/src/contracts/schemas.ts`), so keep everything the feature shares between main and renderer in it — channel schemas, event payload types, shared domain types.

### What a plugin looks like (the target shape)

```
plugins/<id>/
├── plugin.json           # manifest: id, displayName, version, main, web, contributes, ...
├── package.json          # @anaconda-agentic-desktop/plugin-<id>
└── src/
    ├── contracts/        # Zod schemas (moved from packages/contracts)
    ├── main/             # exports mainRegister(mainSdk)
    └── web/              # exports page components, webRegister(sdk), optional browserRegister
```

See `plugins/todos/` for a complete live reference.

---

## Backend Design (Main Process)

### Register handlers from a contract

```typescript
// packages/contracts/src/features/environments.ts
import { z } from "zod";
import { defineContract, defineMethod } from "../contract.js";

export const environmentsContract = defineContract({
	list: defineMethod(z.undefined(), z.array(environmentSchema)),
	activate: defineMethod(z.object({ name: z.string() }), z.object({ ok: z.literal(true) })),
	remove: defineMethod(z.object({ name: z.string() }), z.object({ ok: z.literal(true) })),
});
```

```typescript
// apps/desktop/src/main/features/environments/index.ts
import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk";
import { environmentsContract } from "@anaconda-agentic-desktop/contracts";

export function mainRegister(mainSdk: MainSdk) {
	const service = createEnvironmentsService(mainSdk);

	mainSdk.channels(environmentsContract).handleAll({
		list: () => service.list(),
		activate: ({ name }) => service.activate(name),
		remove: ({ name }) => service.remove(name),
	});
}
```

- `.handleAll({ ... })` is exhaustive by type — prefer it over one-at-a-time `.handle(channel, handler)`.
- Use `z.undefined()` for channels that take no input.
- Input and output are validated at the routing boundary by the contract schemas.
- `mainRegister` runs synchronously at boot; kick off async work from inside it, don't make it `async`.

### Errors

Expected failures throw `FeatureError` from the SDK — its message survives the IPC boundary. Generic `Error` messages are scrubbed to a generic string before reaching the renderer.

```typescript
import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk";

throw new FeatureError("Environment not found.", "NOT_FOUND");
```

### Persistence

- Each feature that persists opens its **own** SQLite file (`data.db`) under `mainSdk.storageDir` (`${userData}/plugins/<id>/`) and ships its drizzle migrations inside the feature directory. Nothing shares a shell database; no tables are shared across features.
- Simple JSON-shaped settings use `mainSdk.storage.kv({ defaults, namespace? })` — an atomic host store with default backfill and corrupt-file recovery.
- For renderer-visible file storage, `sdk.fs` is sandboxed per feature: paths are relative to `${userData}/plugins/<id>/fs/`; absolute or escaping paths are rejected, and browser mode has no fs (calls reject).

### Shell delegates

Main features consume host services through `mainSdk` — never import Electron or shell modules directly:

- `mainSdk.logger` — feature-scoped electron-log sink
- `mainSdk.net.fetch` — network access
- `mainSdk.protocol.handle(scheme, handler)` — custom protocol; schemes must be declared in the manifest's `protocols` array
- `mainSdk.boot.reportProgress("Preparing …")` — boot progress messages during slow `mainRegister` setup (migrations, payload resolution)

---

## Renderer Design

### Call the backend through the typed client

```typescript
// apps/web/src/features/environments/hooks/use-environments.ts
import { useSdk } from "@anaconda-agentic-desktop/sdk-react";
import { useSdkQuery, useSdkMutation } from "@anaconda-agentic-desktop/sdk-react";

export function useEnvironments() {
	const sdk = useSdk("environments");
	return useSdkQuery(sdk, "list");
}

export function useActivateEnvironment() {
	const sdk = useSdk("environments");
	return useSdkMutation(sdk, "activate");
}
```

- `sdk.client` maps method calls to `sdk.invoke`; handler types come from the contract.
- Server state lives in TanStack Query via `useSdkQuery` / `useSdkMutation` — do not hand-roll fetch effects.

### Components

- React 19, function components + hooks only.
- Import design-system primitives from `@anaconda-agentic-desktop/ui` — never vendor or copy shadcn components into a feature.
- Interactive elements carry stable `data-qa-id` attributes (queried by Vitest browser tests and Playwright e2e).

---

## State Management

### Shared observable state: `sdk.state`

Use `sdk.state` for values other features (or many of your own components) observe over time — counts, selection, status:

```typescript
// Owner side (registers under "environments.active")
const active = sdk.state.register("active", initialState);
active.set(nextState);

// Consumer side (any feature)
const store = sdk.state.get<Environment | null>("environments.active");
const unsub = store.subscribe((value) => /* ... */); // fires synchronously
```

- Stores are namespaced by feature id automatically (`featureId.storeName`).
- `get()` returns `ReadableStore<T | null>` — `null` until the owner hydrates it. Use `has()` to distinguish "not loaded yet" from a legitimately null value.
- `subscribe` + `peek` are `useSyncExternalStore`-compatible.
- In-memory and renderer-side only: not persistence, and every `set()` notifies synchronously — avoid high-frequency data.

### What not to use

- No React Context for cross-feature communication.
- No singleton module state as a cross-feature channel.
- Renderer-local component state stays in the component; feature-scoped server state stays in TanStack Query.

---

## Communication Patterns

### Decision tree

```
Talking to your own backend?
  └─ Yes → sdk.invoke / sdk.client (typed by your contract)

Need a response from another feature?
  └─ Yes → sdk.plugins.get<T>(featureId) — lazy, may be null, handle it

Announcing something happened, don't care who listens?
  └─ Yes → sdk.events.emit("somethingHappened", payload)

Need a value readable at any time (not an event stream)?
  └─ Yes → sdk.state.register / sdk.state.get
```

### Events

```typescript
// Emitter — stamped as "environments.changed" automatically
sdk.events.emit("changed", { name: env.name });

// Subscriber — fully-qualified name
const unsub = sdk.events.on("environments.changed", (payload) => refresh());
```

- Payloads must be structured-cloneable (same contract in Electron and browser mode).
- Delivery is fire-and-forget, at-most-once, with no replay — late subscribers miss prior events. For read-any-time values, use `sdk.state`.
- Always emit un-namespaced (`emit` prefixes for you); always subscribe fully-qualified.

### Capabilities (cross-feature request/response)

```typescript
// Provider — in webRegister/mainRegister
sdk.plugins.expose("environmentService", {
	list: () => sdk.invoke("list"),
	getActive: () => sdk.invoke("getActive"),
});

// Consumer — defensive: the provider may not be loaded
const caps = sdk.plugins.get<EnvironmentCapabilities>("environments");
await caps?.environmentService.list();
```

- Capabilities are process-local: `sdk.plugins` in the renderer, `mainSdk.plugins` in main. The event bridge is the cross-process primitive.
- Resolution is lazy — missing or later-activated providers return `null`, so activation order never matters.
- Main-side cross-feature `invoke` is intentionally not exposed; main uses capabilities for the same typed, graceful-null contract.

---

## Tool Registration (AI Exposure)

Tools adapt a domain function for AI runtimes (the WebMCP bridge). Register them from `webRegister` so they work without central-file edits:

```typescript
import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";
import { z } from "zod";
import { environmentsContract } from "../contracts/schemas.js";

export function webRegister(sdk: SDK) {
	const listInput = z.object({});

	sdk.tools.register({
		name: "list",
		description: "List all available conda environments.",
		inputSchema: z.toJSONSchema(listInput, { target: "draft-2020-12" }),
		validate: listInput,
		annotations: { readOnlyHint: true },
		exposeToModelContext: true,
		handler: () => sdk.invoke("list"),
	});
}
```

- `inputSchema` is the JSON Schema advertised to MCP clients; `validate` is the Zod schema run before the handler (the handler receives its parsed output). Derive both from the same contract schema so they cannot drift.
- `annotations` mirror the MCP hint vocabulary (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`).
- **`exposeToModelContext` defaults to `false` and is a security boundary**: opting in publishes the tool to the local, _unauthenticated_ MCP relay reachable by any local process. Leave mutating or destructive tools unexposed unless external agent access is intended.
- Prefer `[A-Za-z0-9_]`-only tool names — names are namespaced internally as `featureId.name` and sanitized to `featureId_name` on the MCP wire.
- Tools are the AI adapter over a domain function, not an RPC mechanism. Plugin code must never round-trip through a tool to reach code it owns; cross-plugin calls go through `sdk.plugins.get`. The idiomatic pattern: (1) write the domain function, (2) expose it via `sdk.plugins.expose`, (3) optionally adapt it as a tool whose handler calls the same function.
- Gate tools on feature flags with `sdk.featureFlags.subscribe` so the LLM only sees them while the flag is on (see `plugins/todos/src/web/index.ts`).

---

## UI Contributions

### Declarative first: `plugin.json` `contributes`

Everything a feature adds to the shell is declared statically, VS Code–style — no shell edits:

```json
{
	"contributes": {
		"providers": [{ "component": "EnvironmentsProvider", "priority": 10 }],
		"routes": [
			{ "path": "/environments", "component": "EnvironmentsPage", "title": "Environments" }
		],
		"nav": [{ "to": "/environments", "label": "Environments", "icon": "layers", "priority": 50 }],
		"zones": [{ "zone": "status-bar", "component": "ActiveEnvironmentBadge", "priority": 100 }],
		"settings": [
			{ "id": "environments", "title": "Environments", "component": "EnvironmentSettings" }
		]
	}
}
```

- `providers` — app-lifetime React providers composed by the shell inside its SDK/query providers; use for lifecycle state and listeners that must stay mounted across routes.
- `routes` — full pages the shell mounts; the component receives `PluginPageProps` (`path`, `search`). Use `sdk.location` for a live subscription instead of the render-time snapshot.
- `nav` — sidebar entries (pure data); decoupled from routes.
- `zones` — plugin-lifetime registrations into shell zones or plugin-owned zones (`"<plugin-id>/<zone-id>"`).
- `settings` — sections on the shell-owned `/settings` page; optional `category` groups sidebar entries (default `Personal`).

### Imperative: `sdk.contribute`

For conditional UI, register at runtime:

```typescript
const remove = sdk.contribute("status-bar", {
	id: "active-env",
	component: ActiveEnvironmentBadge,
	label: "Active Environment",
	priority: 10,
});
// cleaned up automatically on sdk.destroy(), or call remove()
```

Zone hosts consume the live, priority-ordered registry with `useSdkContributions(zone)`.

### Navigation and commands

- Navigate with `sdk.navigate(path)`; read the router with `sdk.location`. Never import the router — it's deliberately shell-only.
- Command palette entries: `sdk.commands.register({ id, label, handler })`.

---

## Dependency Management

### Within a feature: constructors and factories

```typescript
export interface EnvironmentsServiceDeps {
	logger: MainSdk["logger"];
	storageDir: string;
}

export function createEnvironmentsService(deps: EnvironmentsServiceDeps) {
	return new EnvironmentsService(deps.logger, deps.storageDir);
}
```

Keep dependencies explicit so the feature is testable in isolation (`createFakeSdk` / `createFakeMainSdk` from `@anaconda-agentic-desktop/testing`).

### Across features: capabilities, not injection

Never inject another feature's service — that requires importing its types and couples activation order. Depend on the capability contract instead:

```typescript
// GOOD — lazy, nullable, no import of the other feature's source
const auth = mainSdk.plugins.get<AuthCapabilities>("auth");
const passport = await auth?.authService.getPassport();

// BAD — direct import of another feature (forbidden)
import { authService } from "../auth/index.js";
```

### Package ownership (three tiers)

- **Tier 1 — shared runtime (shell-owned singletons):** `react`, `react-dom`, `zod`, `@anaconda-agentic-desktop/feature-sdk`, `sdk-react`, `ui`, `@tanstack/react-query`. Declared as peer dependencies; never bundled — two copies break correctness.
- **Tier 2 — plugin-owned runtime deps:** implementation details of one feature (`better-sqlite3`, `drizzle-orm`, ...). Normal dependencies.
- **Tier 3 — dev/test tooling:** vitest, typescript, `@anaconda-agentic-desktop/testing`, etc. Never shipped.

Shell-only (features never import these): `@tanstack/react-router` (use `sdk.navigate`), the Tailwind pipeline and theme tokens (ship class names only), all Electron APIs (use SDK delegates).

---

## Migration Checklist

Follow the [migrate-to-plugin skill](../.agents/skills/migrate-to-plugin/SKILL.md) — it is the maintained runbook. In outline:

### 1. Move the three locations into the plugin shape

```bash
mkdir -p plugins/<id>/src/{contracts,main,web}

git mv packages/contracts/src/features/<id>.ts plugins/<id>/src/contracts/schemas.ts
git mv apps/desktop/src/main/features/<id>/*    plugins/<id>/src/main/
git mv apps/web/src/features/<id>/*             plugins/<id>/src/web/
```

### 2. Create `plugin.json`

Validated by `pluginManifestSchema` in feature-sdk at discovery; unknown keys are rejected. The schema is the source of truth.

```json
{
	"id": "<id>",
	"displayName": "<Human Name>",
	"version": "1.0.0",
	"main": "./src/main/index.ts",
	"web": "./src/web/index.ts",
	"contributes": {
		"routes": [{ "path": "/<id>", "component": "<PageExportName>", "title": "<Human Name>" }],
		"nav": [{ "to": "/<id>", "label": "<Human Name>", "icon": "<lucide-icon-name>" }]
	}
}
```

Entry points are `mainRegister(mainSdk)` in the `main` module and page-component exports (plus optional `webRegister(sdk)` / `browserRegister(sdk)`) in the `web` module. The shell mounts route components — plugins never mount their own DOM.

### 3. Rewrite imports

| Old                                                 | New                                   |
| --------------------------------------------------- | ------------------------------------- |
| `@anaconda-agentic-desktop/contracts` (own schemas) | `../contracts/schemas.js`             |
| `@/features/<id>/...`                               | relative within `src/web/`            |
| `@/platform/sdk`                                    | `@anaconda-agentic-desktop/sdk-react` |

### 4. Update registration

Remove the feature from `FEATURES` / `WEB_FEATURES`; add it to `BUNDLED_PLUGINS` (`apps/desktop/src/main/features/registry/bundled-plugins.ts` and `apps/web/src/features/bundled-plugins.ts`).

### 5. Verify

- [ ] No imports from other features' source (contracts/schemas moves with the feature)
- [ ] No imports from `apps/*/src/lib/` or `apps/*/src/platform/`
- [ ] All backend calls go through `sdk.invoke` / `sdk.client` — no raw IPC, no `LocalApi` additions
- [ ] Cross-feature calls use `sdk.plugins.get` / `mainSdk.plugins.get`, with null handled
- [ ] Events emitted un-namespaced, subscribed fully-qualified (`featureId.event`)
- [ ] Shared state registered via `sdk.state.register`; no cross-feature React Context or singletons
- [ ] Expected handler failures throw `FeatureError`
- [ ] Persistence uses the feature's own SQLite under `mainSdk.storageDir` (or `mainSdk.storage.kv`); no shared tables
- [ ] UI declared in `plugin.json` `contributes` or via `sdk.contribute` — no shell file edits
- [ ] Tools opt into `exposeToModelContext` deliberately, not by default
- [ ] `pnpm check && pnpm lint && pnpm format:check && pnpm test` passes, including the feature's `@smoke` e2e spec

---

## Quick Reference

### Pattern mapping

| Need                                        | Use                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| Renderer → own backend                      | `sdk.invoke(channel, args)` / `sdk.client` via `useSdk<ServiceType>(featureId)` |
| Main handler registration                   | `mainSdk.channels(contract).handleAll({ ... })`                                 |
| Contract definition                         | `defineContract({ "channel": defineMethod(input, output) })`                    |
| Expected failure                            | `throw new FeatureError(message, code)`                                         |
| Cross-feature request/response              | `sdk.plugins.expose` / `sdk.plugins.get` (renderer), `mainSdk.plugins.*` (main) |
| Announcement, fire-and-forget               | `sdk.events.emit` / `sdk.events.on("featureId.event", ...)`                     |
| Read-any-time shared value                  | `sdk.state.register` / `sdk.state.get("featureId.key")`                         |
| Server state in components                  | `useSdkQuery` / `useSdkMutation`                                                |
| Conditional UI in a zone                    | `sdk.contribute(zone, { id, component, ... })`                                  |
| Static UI (pages, nav, settings, providers) | `plugin.json` `contributes`                                                     |
| Navigation                                  | `sdk.navigate` / `sdk.location` (never the router)                              |
| Command palette                             | `sdk.commands.register({ id, label, handler })`                                 |
| Per-feature file storage (renderer)         | `sdk.fs.readFile` / `writeFile` (sandboxed, Electron-only)                      |
| Persistence (main)                          | own SQLite under `mainSdk.storageDir`; `mainSdk.storage.kv` for settings        |
| AI tool exposure                            | `sdk.tools.register({ name, inputSchema, validate, handler, ... })`             |
| Cleanup on SDK teardown                     | `sdk.onDispose(fn)` (handlers themselves are shell-torn-down)                   |

### Entry-point hooks

| Hook                       | Where      | Runs                                                                                      |
| -------------------------- | ---------- | ----------------------------------------------------------------------------------------- |
| `mainRegister(mainSdk)`    | main entry | Boot (Electron only); registers handlers, opens DB                                        |
| `webRegister(sdk)`         | web entry  | Boot, Electron and browser; tool registration, providers wiring                           |
| `browserRegister(mainSdk)` | web entry  | Standalone browser mode only (in-process MainSdk); omit to mark the feature Electron-only |

### Testing

- Unit/integration/browser tests use `createFakeSdk` / `createFakeMainSdk` / `createLinkedFakeSdkPair` / `createFakeFeatureSystem` from `@anaconda-agentic-desktop/testing` — never hand-roll fakes.
- Every feature ships at least one `@smoke` Playwright e2e spec (see [docs/TESTING.md](./TESTING.md)).
- CI gate: `pnpm check && pnpm lint && pnpm format:check && pnpm test`.
