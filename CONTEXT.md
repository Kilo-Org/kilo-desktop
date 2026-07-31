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
└── testing/      @anaconda-agentic-desktop/testing      Test utilities (createFakeSdk, createFakeMainSdk, createFakeFeatureSystem)

e2e/              @anaconda-agentic-desktop/e2e          Playwright/Electron e2e (plugin-aware)
plugins/          Bundled plugins (after migration from apps/)
```

## Key architectural decisions

### Feature SDK (shim layer)

Features program against `@anaconda-agentic-desktop/feature-sdk`, not `LocalApi`.

- `sdk.invoke(channel, args)` — transport-agnostic call to the feature's backend handlers
- `sdk.client` — proxy that maps method calls to `invoke`; typed via `useSdk<ServiceType>(featureId)`
- `sdk.events` — namespaced pub/sub
- `sdk.state` — observable stores
- `sdk.plugins.expose/get` — cross-feature capabilities
- `sdk.contribute` — register UI in shell zones
- `sdk.commands` — command palette entries
- `sdk.notifications/theme/shell/fs` — shell-provided services (delegate to LocalApi)

In Electron: `sdk.invoke` routes through a generic `feature:invoke` IPC channel.
In browser: `sdk.invoke` calls the handler directly in-process (no Electron needed). Only `browserRegister` boots in this mode — features without one are skipped with a warning. Node-free features opt in with `browserRegister: register`; features using Node APIs (SQLite, fs) must provide browser-safe fakes.

**Handlers and validation:** `mainSdk.channels(channelMap)` binds the map once; `.handleAll({ ... })` registers a handler per channel and is exhaustive by type (preferred), `.handle(channel, handler)` registers one at a time. Handler types are inferred, and input and output schemas are validated at the routing boundary. Use `z.undefined()` for channels that take no input.

**Errors:** expected failures throw `FeatureError` from the SDK (`throw new FeatureError("Todo not found.", "NOT_FOUND")`). The shell translates it across the IPC boundary so the message survives; generic errors are scrubbed to a generic string.

**Lifecycles:** `useSdk(featureId)` returns a shared per-feature SDK instance that is NOT destroyed on component unmount. `sdk.destroy()` cleans up only what was registered through that instance. Full feature teardown (`teardownFeature`) is shell-owned and happens on feature/plugin unload only.

### FEATURES array (mandatory registration)

Every feature registers in `apps/desktop/src/main/features/registry/features.ts`. Adding a feature = adding an entry. Never hand-edit `Application.ts` for feature-specific code.

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

## Terminology

| Term               | Meaning                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Feature**        | A product capability developed inside `apps/` that programs against the SDK. Will become a plugin later.                                       |
| **Plugin**         | A self-contained package in `plugins/` (or external repo) with its own manifest, web code, main code, and contracts.                           |
| **Shell**          | The host application infrastructure: Electron lifecycle, routing, theme, notifications, IPC server. Lives in `apps/` and `packages/contracts`. |
| **SDK**            | `@anaconda-agentic-desktop/feature-sdk` — the stable interface. Today it's a shim; later it becomes the real plugin SDK.                       |
| **MainSdk**        | The main-process counterpart of the SDK. Features register typed handlers via `mainSdk.channels(channelMap).handle(...)`.                      |
| **`sdk.invoke`**   | Transport-agnostic call from renderer to a handler registered by the same feature's `mainRegister`. NOT raw IPC.                               |
| **FEATURES array** | `apps/desktop/src/main/features/registry/features.ts` — mandatory data-driven registration for all features.                                   |
| **Shell delegate** | A shell-owned service exposed through the SDK (theme, notifications, shell, fs, auth).                                                         |
| **Contribution**   | A React component registered in a shell zone (dashboard widget, status bar item, etc.) via `sdk.contribute`.                                   |
| **Capability**     | A named API exposed by one feature for others to consume via `sdk.plugins.expose/get`.                                                         |

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
- **Coverage** — 90% lines/branches/functions/statements (`pnpm coverage`)
- **oxlint + oxfmt** (not ESLint/Prettier)
- **peerDependencies** for react, react-dom, zod in publishable packages
- Tests use `createFakeSdk` from `@anaconda-agentic-desktop/testing`
- Interactive elements use stable `data-qa-id` attributes (queried by Vitest browser + Playwright)
- Cross-feature communication only through SDK primitives (events, state, plugins.get)
- All events namespaced by feature ID: `featureId.eventName`
- Expected handler failures throw `FeatureError` (never plain `Error` — its message gets scrubbed at the IPC boundary)
- Each feature owns its own SQLite file if it persists data

See [docs/TESTING.md](./docs/TESTING.md) for the full tier taxonomy and how to run each suite.

## What NOT to do

- Don't add feature methods to `LocalApi`
- Don't import from other features' source
- Don't import from `apps/*/src/lib/` or `apps/*/src/platform/` in feature code
- Don't share DB tables across features
- Don't use React Context for cross-feature communication
- Don't emit un-namespaced events
- Don't use ESLint/Prettier (use oxlint/oxfmt)
