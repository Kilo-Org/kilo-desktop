# CONTEXT.md — Anaconda Agentic Desktop

## What is this project?

An Electron desktop app (React renderer) that will evolve into a plugin-based platform. Features are developed today against a shim SDK that mirrors the future plugin SDK. This allows features to migrate to plugins (and later to separate repos) via filesystem moves rather than rewrites.

## Architecture

```
apps/
├── desktop/   @anaconda-agentic-desktop/desktop   Electron main + preload
└── web/       @anaconda-agentic-desktop/web       React 19 renderer (runs in Electron or standalone browser)

packages/
├── contracts/    @anaconda-agentic-desktop/contracts    Shell-internal IPC contracts (Zod schemas, LocalApi)
├── feature-sdk/  @anaconda-agentic-desktop/feature-sdk  Shim SDK — stable interface features program against
├── sdk-react/    @anaconda-agentic-desktop/sdk-react    React SDK bindings (SdkProvider, useSdk, useSdkQuery, useSdkMutation)
├── testing/      @anaconda-agentic-desktop/testing      Test utilities (createFakeSdk, createFakeMainSdk, createFakeFeatureSystem)
└── ui/           @anaconda-agentic-desktop/ui           Anaconda Design System primitives (shadcn) — shell-owned, ONE set shared by apps and plugins; never vendor copies

e2e/              @anaconda-agentic-desktop/e2e          Playwright/Electron e2e (plugin-aware)
plugins/          Bundled plugins — self-contained workspace packages
├── todos/        @anaconda-agentic-desktop/plugin-todos Demo plugin (plugin.json + src/{contracts,main,web})
├── kilo-server/  @anaconda-agentic-desktop/plugin-kilo-server Kilo CLI packaging and server lifecycle
└── kilo-ui/      @anaconda-agentic-desktop/plugin-kilo-ui Chat UI and workspace management
```

## Key architectural decisions

### Feature SDK (shim layer)

Features program against `@anaconda-agentic-desktop/feature-sdk`, not `LocalApi`.

- `sdk.invoke(channel, args)` — transport-agnostic call to the feature's backend handlers
- `sdk.client` — proxy that maps method calls to `invoke`; typed via `useSdk<ServiceType>(featureId)`
- `sdk.events` / `mainSdk.events` — symmetric, namespaced, cross-process pub/sub
- `sdk.state` — observable stores
- `sdk.plugins.expose/get` / `mainSdk.plugins.expose/get` — process-local cross-feature capabilities
- `sdk.contribute` — imperatively register UI in a shell zone (canonical `ShellZone` ids: `sidebar`, `status-bar`, `dashboard`, `home-composer-leading-action`; the shell renders only these). Page-scoped/conditional; for always-present widgets prefer declarative `contributes.zones` in `plugin.json`
- `contributes.providers` — declarative app-lifetime React providers from a plugin's web entry, composed by the shell inside its SDK/query providers so plugin lifecycle state and listeners are route-independent
- `contributes.settings` — declarative settings-page sections (`id` + `component` export). The shell owns `/settings` and lists sections in a left nav; not a zone (exclusive selection, not stacked chrome). Optional `featureFlag` hides the nav entry the same way as `contributes.nav`
- `sdk.commands` — command palette entries
- `sdk.navigate` / `sdk.location` — shell navigation delegate (the router never leaks to features; full pages and nav entries are declared in `plugin.json` `contributes` and mounted by the shell)
- `sdk.notifications/theme/shell/fs` — shell-provided services (delegate to LocalApi). `sdk.fs` is sandboxed per feature: paths are relative to `${userData}/plugins/<id>/fs/` (a sibling of the feature's SQLite `data.db`, so fs calls can't reach it); absolute/escaping paths are rejected, and browser mode has no fs (calls reject)
- `mainSdk.logger` / `mainSdk.net.fetch` — main-process shell delegates. Electron supplies a feature-scoped `electron-log` sink and `net.fetch`; browser/test environments provide runtime implementations or explicit fakes. Plugins never import Electron or shell logging modules directly.

In Electron: `sdk.invoke` routes through a generic `feature:invoke` IPC channel.
In browser: `sdk.invoke` calls the handler directly in-process (no Electron needed). Only `browserRegister` boots in this mode — features without one are skipped with a warning. Node-free features opt in with `browserRegister: register`; features using Node APIs (SQLite, fs) must provide browser-safe fakes.

**Events:** renderer and main use the same `emit`/`on` shape. `emit("changed", payload)` is always stamped with the caller's feature ID, while `on("other-feature.changed", handler)` takes a fully-qualified name. In Electron, the shell relays `feature:event` envelopes between the main bus and every renderer window; origin-aware delivery prevents echo loops. Browser `SDK` and `MainSdk` share one in-process bus. Delivery is fire-and-forget, at-most-once, with no replay; late subscribers miss prior events. Payloads must be structured-cloneable and are guarded at the SDK boundary.

**Main-side capabilities:** every process owns a shared `CapabilityRegistry`. A feature may expose an API from `mainRegister` with `mainSdk.plugins.expose`; another main feature resolves it lazily with `mainSdk.plugins.get<T>(featureId)`. Missing or inactive providers return `null`, so activation order does not matter. Capabilities stay process-local—the event bridge is the cross-process primitive.

Main-side cross-feature `invoke` through the shared `FeatureRouter` is intentionally not exposed. Main uses capabilities for the same typed, graceful-null contract as the renderer.

**Handlers and validation:** `mainSdk.channels(channelMap)` binds the map once; `.handleAll({ ... })` registers a handler per channel and is exhaustive by type (preferred), `.handle(channel, handler)` registers one at a time. Handler types are inferred, and input and output schemas are validated at the routing boundary. Use `z.undefined()` for channels that take no input.

**Errors:** expected failures throw `FeatureError` from the SDK (`throw new FeatureError("Todo not found.", "NOT_FOUND")`). The shell translates it across the IPC boundary so the message survives; generic errors are scrubbed to a generic string.

**Storage:** the shell provides a per-feature data directory as `mainSdk.storageDir` (`${userData}/plugins/<id>/`, created lazily). Features that persist open their own SQLite file there (`data.db`) and ship their drizzle migrations inside the feature directory. Nothing shares a shell database.

**Lifecycles:** `useSdk(featureId)` returns a shared per-feature SDK instance that is NOT destroyed on component unmount. `sdk.destroy()` cleans up only what was registered through that instance. Full feature teardown (`teardownFeature`) is shell-owned and happens on feature/plugin unload only.

### FEATURES array (mandatory registration)

Every feature registers in `apps/desktop/src/main/features/registry/features.ts`. Adding a feature = adding an entry. Never hand-edit `Application.ts` for feature-specific code.

Bundled plugins register in `BUNDLED_PLUGINS` instead (`apps/desktop/src/main/features/registry/bundled-plugins.ts` for the `main` entry, `apps/web/src/features/bundled-plugins.ts` for the `web` entry). The loader (`discoverPlugins` in feature-sdk) validates each `plugin.json` at boot and feeds the registrations into the same `FEATURES` / `WEB_FEATURES` boot paths, so features and plugins boot identically.

### LocalApi scope

`LocalApi` (`packages/contracts/src/local-api.ts`) is reserved for **shell-level services only**: theme, notifications, shell, filesystem. Features never add methods to `LocalApi`. Feature-scoped backend calls go through `sdk.invoke`.

### Feature file structure

Features live in three predictable locations inside apps:

```
apps/desktop/src/main/features/<id>/    # Node services, DB, handlers (mainRegister)
apps/web/src/features/<id>/             # React components, hooks
packages/contracts/src/features/<id>.ts # Zod schemas (moves to plugin on migration)
```

### Plugin migration path

```
Feature in apps → Plugin in plugins/ → Plugin in external repo
```

Each transition is a filesystem move. Source code stays the same because it programs against the SDK, not shell internals.

### Dependency ownership (shell vs plugin)

Three tiers decide where a dependency lives:

**Tier 1 — Shared Runtime Set (shell-owned singletons).** Plugins declare these as `peerDependencies` and never bundle them; the host provides exactly one runtime copy. Shared because TWO copies break correctness, not for convenience:

| Package                                 | Why a singleton                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| `react` / `react-dom`                   | Two copies = invalid hook calls, broken context                                    |
| `@anaconda-agentic-desktop/feature-sdk` | Shared in-memory EventBus/StateBroker/CapabilityRegistry — a 2nd copy splits them  |
| `@anaconda-agentic-desktop/sdk-react`   | React bindings must resolve the same SDK context                                   |
| `@anaconda-agentic-desktop/ui`          | One design system: context identity in stateful components; upgrades apply at once |
| `@tanstack/react-query`                 | `useSdkQuery` must hit the host's single QueryClientProvider/cache                 |
| `zod`                                   | `instanceof ZodError` identity across the `feature:invoke` validation boundary     |

**Deliberately shell-only (plugins never import these):** `@tanstack/react-router` (navigation is a shell delegate — `sdk.navigate`; the host creates routes from `plugin.json`), `@anaconda-agentic-desktop/contracts` (shell-internal; contract helpers come from feature-sdk), the Tailwind pipeline + `@anaconda/shadcn-theme` tokens (plugins ship class names only; the shell's `globals.css` scans `packages/ui` and `plugins/` via `@source`), and all Electron APIs (use SDK shell delegates).

**Tier 2 — Per-plugin runtime deps (plugin-owned).** Implementation details of one plugin's feature (e.g. todos: `better-sqlite3`, `drizzle-orm`, its drizzle migrations). Normal workspace deps in-repo (pnpm dedupes); bundled into the plugin's build when external.

**Tier 3 — Dev/test tooling.** Per-plugin `devDependencies`, never shipped: vitest, playwright, typescript, `@anaconda-agentic-desktop/testing`, `@anaconda-agentic-desktop/e2e`, drizzle-kit, tailwind-for-tests.

**Rule of thumb:** two copies would break correctness or fork the design system → Tier 1. One plugin's business → Tier 2. Tooling → Tier 3. The singleton guarantee is implicit today (workspace hoisting); it becomes an enforced contract in Slice 5 (canonical externals list + peerDependencies + host-provided runtime).

## Terminology

| Term               | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Feature**        | A product capability developed inside `apps/` that programs against the SDK. Will become a plugin later.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Plugin**         | A self-contained package in `plugins/` (or external repo) with its own manifest, web code, main code, and contracts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Shell**          | The host application infrastructure: Electron lifecycle, routing, theme, notifications, IPC server. Lives in `apps/` and `packages/contracts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **SDK**            | `@anaconda-agentic-desktop/feature-sdk` — the stable interface. Today it's a shim; later it becomes the real plugin SDK.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **MainSdk**        | The main-process counterpart of the SDK. Features register typed handlers, use `mainSdk.events` / `mainSdk.plugins` for main-side communication, and consume host logging/network delegates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **`sdk.invoke`**   | Transport-agnostic call from renderer to a handler registered by the same feature's `mainRegister`. NOT raw IPC.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **FEATURES array** | `apps/desktop/src/main/features/registry/features.ts` — mandatory data-driven registration for all features.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Shell delegate** | A shell-owned service exposed through the SDK (theme, notifications, shell, fs, auth).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Contribution**   | UI or lifecycle behavior a plugin adds through `plugin.json`: app-lifetime providers, host-mounted zone widgets, routes, nav, and settings sections; conditional zone UI uses `sdk.contribute`. Settings is a contribution point (section registry on `/settings`), not a zone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Capability**     | A named API exposed by one feature for others to consume via `sdk.plugins.expose/get`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Anaconda MCP**   | Core feature (`apps/desktop/src/main/features/anaconda-mcp/`) that automatically connects to the Anaconda Remote MCP HTTP server when the user is logged in. Gated by the LaunchDarkly flag `remote-anaconda-mcp` (default `false`); when the flag is off the feature is fully inert. When enabled, contributes the `anaconda-remote` MCP entry as a config overlay via the kilo-server plugin's `configOverlay.contribute` capability — injected into the spawned `kilo serve` through the `KILO_CONFIG_CONTENT` env var, never written to the shared `~/.config/kilo/kilo.jsonc` — and contributes `ANACONDA_API_KEY` to the Kilo server's spawn env, referenced from the entry via `{env:ANACONDA_API_KEY}`. Kilo CLI / VS Code never see the entry, and it vanishes when the contribution is disposed. User opt-out is the settings toggle (persisted to the feature's `storageDir/settings.json`). |

## Conventions

- **TypeScript 7**, strict, `verbatimModuleSyntax: true`
- **ESM** everywhere (`"type": "module"`)
- **Zod 4** for schemas (workspace catalog `^4.4.3`)
- **React 19** — function components + hooks only
- **TanStack Router** (file-based, hash history) + **TanStack Query**
- **shadcn/ui** (`base-nova` style, `lucide-react` icons, `@base-ui/react` primitives)
- **@anaconda/shadcn-theme** for design tokens (CSS custom properties, Tailwind v4)
- **Vitest** — `*.test.ts` (node unit), `*.integration.test.ts` (serial node), `*.browser.test.tsx` (Chromium component), `*.app.test.tsx` (full app tree)
- **Playwright e2e** — packaged Electron via `@anaconda/playwright-utils` in the root `e2e/` package; every feature ships at least one `@smoke` spec
- **Coverage** — 80% lines/branches/functions/statements (`pnpm coverage`)
- **oxlint + oxfmt** (not ESLint/Prettier)
- **peerDependencies** for react, react-dom, zod in publishable packages
- Tests use `createFakeSdk` / `createFakeMainSdk` / `createLinkedFakeSdkPair` from `@anaconda-agentic-desktop/testing`
- Interactive elements use stable `data-qa-id` attributes (queried by Vitest browser + Playwright)
- Cross-feature communication only through SDK primitives (events, state, plugins.get)
- All events namespaced by feature ID: `featureId.eventName`
- Expected handler failures throw `FeatureError` (never plain `Error` — its message gets scrubbed at the IPC boundary)
- Each feature owns its own SQLite file if it persists data

The kilo-ui plugin can therefore resolve kilo-server capabilities directly in main. Its renderer invokes only kilo-ui channels; it does not acquire kilo-server's SDK identity or perform cross-feature invokes. Capability lookup stays lazy so missing or later-activated providers fail gracefully without activation-order coupling.

See [docs/TESTING.md](./docs/TESTING.md) for the full tier taxonomy and how to run each suite.

## What NOT to do

- Don't add feature methods to `LocalApi`
- Don't import from other features' source
- Don't import from `apps/*/src/lib/` or `apps/*/src/platform/` in feature code
- Don't copy shadcn/design-system components into features or plugins — import from `@anaconda-agentic-desktop/ui`
- Don't share DB tables across features
- Don't use React Context for cross-feature communication
- Don't emit un-namespaced events
- Don't use ESLint/Prettier (use oxlint/oxfmt)
