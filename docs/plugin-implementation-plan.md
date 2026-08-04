# Plugin System — Implementation Plan

Vertical slices for evolving the shim SDK into a real plugin system.

---

## Current State (synced with `main`, July 2026)

What already exists on `main` — the plan is written against this reality:

- **The SDK pipeline is already proven in production.** Two reference features, `sdk-producer` and `sdk-consumer`, are migrated to the SDK, registered in **both** `FEATURES` (`apps/desktop/src/main/features/registry/features.ts`) and `WEB_FEATURES` (`apps/web/src/features/features.ts`), run in Electron **and** browser mode, and between them exercise every SDK API. `sdk-producer` is effectively the SDK conformance demo — keep it in `apps/` as the living reference, do not move it to `plugins/`.
- **Typed client + typed registration exist.** Features define a contract (e.g. `sdkProducerContract` in `packages/contracts/src/features/sdk-producer.ts`), register with `mainSdk.channels(contract).handleAll(...)`, and call it from the renderer via `sdk.client.<method>()` (a typed front-end over `sdk.invoke`). New feature code should prefer this over raw `sdk.invoke`.
- **React SDK bindings still live in the app.** `useSdk`, `SdkProvider`, `createFeatureSystem`, `useFeatureSystem` are all in `apps/web/src/platform/sdk/SdkProvider.tsx`. There is **no** `packages/sdk-react/` and **no** `useSdkQuery`/`useSdkMutation` yet. Features wire TanStack Query by hand via `queryOptions`/`mutationOptions` factories (e.g. `apps/web/src/features/sdk-producer/useNotes.ts`).
- **Todos is the last legacy holdout.** It still uses `LocalApi` + `todos:*` IPC + `createTodoHandlers`, is registered **directly in `Application.ts`** (not via `FEATURES`), and `LocalApi` still carries `todos` methods (`packages/contracts/src/local-api.ts`) — violating the "LocalApi = shell-only" rule. It now lives on its own `/todos` route (`apps/web/src/routes/todos.tsx`). An **unused** `todosContract` + `TodoService` type already exists in `packages/contracts/src/features/todos.ts` — a leg-up for migration.
- **Routing is flat and file-based.** `apps/web/src/routes/` holds hand-authored flat files (`index.tsx`, `todos.tsx`, `sdk-producer.tsx`, `sdk-consumer.tsx`, `split.tsx`) generated into `routeTree.gen.ts` by `@tanstack/router-plugin`. There is no `routes/features/` subdirectory.
- **The sidebar is hand-maintained.** `apps/web/src/components/layout/AppSidebarLayout.tsx` has hardcoded nav items; adding a feature does **not** auto-add a nav entry. This is the target to convert into a contribution zone in Slice 3.
- **Shell delegates: partially wired.** `sdk.theme` and `sdk.shell` are wired; `sdk.notifications` is a safe no-op (`delivered: false`); `sdk.fs` rejects (all in `apps/web/src/platform/sdk/SdkProvider.tsx`). `sdk.navigate` / `sdk.tools` / `sdk.intents` / `sdk.dispatch` throw "not available yet" — note these stubs live **inside the SDK itself** (`packages/feature-sdk/src/services/create-sdk.ts`), not in `SdkProvider`; `ShellDelegates` has no `navigate` member today, so wiring them means extending the **feature-sdk** interface, not just the app. (Decision #19 records the _plan_ for `sdk.navigate`; the code stub is still deferred.)
- **`MainSdk` provides no storage path.** `MainSdk` is only `{ featureId, channels, onDispose }` (`packages/feature-sdk/src/types/sdk.ts`). There is no shell-provided data directory, and CONTEXT.md forbids feature code from importing `apps/*/src/platform/` (where `createDatabase` lives). Todos currently persists into the **shared** `app.db` created in `Application.ts` with migrations in `apps/desktop/drizzle/` — violating "each feature owns its own SQLite file". Closing this is Decision #20 / Slice 1.
- **Zone names have drifted.** The SDK docstring and its internal tests use `"statusbar"` (`packages/feature-sdk/src/types/sdk.ts`, `services.test.ts`) while `sdk-producer` uses `"status-bar"` (`SdkProducerView.tsx`). `getForZone` matches raw strings, so a mismatched contribution silently renders nowhere. Slice 3 defines the canonical zone list.
- **`pnpm-workspace.yaml` covers only `apps/*` and `packages/*`** — no `plugins/*` glob yet (added in Slice 2).
- **`plugins/` is empty** (`.gitkeep` only).
- **CONTEXT.md drift:** CONTEXT.md still uses `todos` as its canonical SDK example even though todos was never migrated; the real migrated examples are `sdk-producer`/`sdk-consumer`. Worth a follow-up doc fix (out of scope for this plan).

---

## Decisions Record

Decisions made during planning (July 2026).

| #   | Decision                     | Choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | First move                   | Retire the last legacy feature: migrate todos off `LocalApi` to the SDK. (Pipeline already proven by `sdk-producer`/`sdk-consumer`, so this is cleanup, not proof.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2   | Where code lives (slice 1)   | Stay in `apps/` — three-location pattern                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 3   | Legacy code after migration  | Delete immediately (clean cut)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 4   | Renderer data-fetching       | Generic `useSdkQuery` / `useSdkMutation` adapter over TanStack Query                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 5   | Where the adapter lives      | New `packages/sdk-react/` (publishable, proper peerDeps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 6   | External plugin distribution | Workspace-only for now; designed toward host-provided SDK (frictionless path to publish)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 7   | Browser mode for todos       | No `browserRegister` — Electron-only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 8   | Slice 2 target               | Plugin manifest + loader                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 9   | Manifest format              | Dedicated `plugin.json`, validated with Zod schema                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 10  | Discovery mechanism          | Hybrid — static build-time now (workspace deps); runtime scanning deferred                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 11  | Activation strategy          | Eager now; loader structured with discover → activate phases for lazy later                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 12  | Isolation model              | Shared process; SDK is the isolation boundary by convention; process separation deferred                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 13  | Renderer code in bundle      | Static imports (wiring via workspace deps — see #17)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 14  | UI contributions             | Routes (full pages) + zones (small contributions) — both coexist                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 15  | Plugin-to-plugin deps        | None explicit; `sdk.plugins.get` at runtime returns capability or `undefined`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 16  | Plugin package structure     | Self-contained workspace package: `src/main/`, `src/web/`, `src/contracts/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 17  | Build wiring                 | Workspace dependency — app lists plugins in `package.json`; `BUNDLED_PLUGINS` registry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 18  | Plugin dependency management | In-repo: normal workspace deps (pnpm dedupes). Bundled/external: plugin bundles its own deps; only the shared host set is `external` + `peerDependencies` (see Shared Runtime Set)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 19  | Navigation / router          | Router stays internal to the shell; navigation is a shell delegate (`sdk.navigate`), like theme/notifications/fs. Router is NOT in the Shared Runtime Set; host owns route creation from `plugin.json`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 20  | Feature/plugin storage       | Shell provides a per-feature data directory through the SDK: `mainSdk.storageDir` = `${userData}/plugins/<id>/` (created lazily by the shell). Features open their own SQLite file there (`data.db`) and ship their own drizzle migrations inside the feature/plugin directory. No feature imports `apps/*/src/platform/db` and nothing shares `app.db`. Lands in **Slice 1** (todos needs it before it can have a `mainRegister`); the path is already plugin-shaped so the Slice 2 move changes nothing                                                                                                                                                                                                                               |
| 21  | Zone names                   | Canonical zone ids exported from `feature-sdk` as a `ShellZone` union + constants: `"sidebar"`, `"status-bar"`, `"dashboard"`. Kebab-case. Existing `"statusbar"` usages (SDK docstring + SDK tests) are aligned in Slice 3; `sdk.contribute` stays open to unknown strings but shell zones render only canonical ids                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 22  | Cross-process events         | `sdk.events` is symmetric and cross-process. The same `emit`/`on` API exists on the renderer `SDK` **and** on `MainSdk`; the shell bridges the main and renderer event buses over a `feature:event` IPC channel (both directions). Feature-namespaced (`featureId.name`); the SDK stamps the emitter's id (no spoofing). Fire-and-forget, at-most-once, no replay; payloads must be structured-cloneable. Browser mode shares one in-process bus (no bridge). Features never touch `webContents.send`/IPC directly                                                                                                                                                                                                                      |
| 23  | Main-side cross-feature      | `MainSdk` gains `plugins.expose`/`plugins.get`, backed by a main-process capability registry built in `bootFeatures` — symmetric with the renderer. A feature's main code consumes another feature's main-side capability directly (`mainSdk.plugins.get("workspaces")`), so **no feature relays cross-feature data through the renderer** or keeps a correctness-critical cache. `get` returns `null` when the provider isn't active (same graceful-degradation contract as the renderer). Considered and rejected: main-side cross-feature `invoke` via the shared `FeatureRouter` — capability parity with the renderer is cleaner and typed                                                                                         |
| 24  | `sdk.fs` scoping             | `sdk.fs` is a capability boundary, not raw fs. `ShellDelegates.fs` takes the calling `featureId` (bound by `createSdk`, so a feature cannot name another feature) and confines every operation to a dedicated `fs/` subdirectory of the feature's Decision #20 storage dir (`${userData}/plugins/<id>/fs/`). The subdir is a **sibling** of the feature's SQLite `data.db`, so `sdk.fs` (including a recursive remove of its own root) can never reach the database. The main-process service rejects absolute paths, `..` escapes, and invalid feature ids; browser mode rejects entirely (no filesystem). Expected failures throw `BusinessError` with feature-relative paths only — absolute host paths never cross the IPC boundary |

### Guardrails for external-readiness

These are non-negotiable from day one to ensure a frictionless path to publishing:

1. `packages/sdk-react/` has proper `peerDependencies` on the full Shared Runtime Set (see below) — no `workspace:*` in peer deps
2. Zero imports from `apps/` or any workspace-internal path
3. Explicit `exports` map in `package.json` — only public surface
4. All types needed by plugin authors exported from the package itself
5. The package could be `npm publish`-ed today and work outside the monorepo

### Shared Runtime Set

The host provides exactly one runtime copy of these packages; plugins declare them as `peerDependencies` and mark them `external` in their bundler. Everything else a plugin uses is bundled into the plugin.

| Package                                 | Why it MUST be a singleton (correctness, not convention)                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react`                                 | Hooks and context break with two copies ("invalid hook call")                                                                                                 |
| `react-dom`                             | Must match the single `react` instance                                                                                                                        |
| `@anaconda-agentic-desktop/feature-sdk` | Shared in-memory `EventBus` / `StateBroker` / `CapabilityRegistry` — a second copy silently breaks cross-plugin events, state, and capabilities               |
| `@anaconda-agentic-desktop/sdk-react`   | React bindings over the same SDK instance/context                                                                                                             |
| `@tanstack/react-query`                 | `useSdkQuery` calls `useQueryClient()` against the host's single `QueryClientProvider` (`apps/web/src/main.tsx`); a bundled copy resolves a different context |
| `zod`                                   | `instanceof` / `ZodError` identity must hold across the `feature:invoke` validation boundary                                                                  |

**Deliberately NOT in this set — TanStack Router (see Decision #19):** navigation is a shell delegate, not a shared package. The router stays internal to `apps/web`; plugins never import it and neither does `sdk-react` (which would drag it back in transitively). The host injects a navigation adapter (`navigate(path)`, subscribable current-location, params/search) exactly like `theme`/`notifications`/`shell`/`fs`. This keeps the shared set minimal, avoids making a future router swap a platform-breaking release, and sidesteps the fact that file-based route codegen (`routeTree.gen.ts`) can't see external plugins — the host creates plugin routes programmatically from `plugin.json`.

**Canonical list:** this set is the single source of truth for both `peerDependencies` and the bundler `external` config. Export it once (e.g. a shared bundler preset) so plugin builds can't drift from it.

**Compatibility contract:** the Shared Runtime Set is a versioned contract. Within a major, a host upgrade (React 19.0 → 19.5) keeps pre-built plugins working. A **major** bump of any entry (React 19 → 20, Zod 4 → 5) is a breaking change for every pre-built plugin — they must be recompiled against the new host. Treat shared-package majors as platform-breaking releases.

---

## Plugin Package Structure

```
plugins/<id>/
├── plugin.json
├── package.json
├── vitest.config.ts
└── src/
    ├── contracts/
    │   └── schemas.ts
    ├── main/
    │   ├── index.ts          (mainRegister)
    │   └── ...services, tests
    └── web/
        ├── index.ts          (browserRegister / renderer entry)
        └── ...components, hooks, tests
```

This mirrors the `apps/` three-location split inside a single self-contained package.
Migration from `apps/` is a filesystem move. Migration to an external repo is `npm publish` of SDK packages + `workspace:*` → `^1.0.0` in `package.json`.

---

## Vertical Slices

### Slice 1 — `packages/sdk-react/` + retire legacy todos

**Goal:** Extract the React SDK bindings into a publishable package and remove the last `LocalApi` feature, so every feature runs on the SDK and nothing violates "LocalApi = shell-only". (The pipeline itself is already proven by `sdk-producer`/`sdk-consumer` — this slice is cleanup + packaging, not proof.)

**Starting state (already in the repo):**

- `useSdk`, `SdkProvider`, `createFeatureSystem`, `useFeatureSystem` live in `apps/web/src/platform/sdk/SdkProvider.tsx`. No `packages/sdk-react/`, no `useSdkQuery`/`useSdkMutation`.
- `FEATURES` + `WEB_FEATURES` already contain `sdk-producer` + `sdk-consumer` (do not touch them; they are the reference impls).
- Todos is still legacy: `LocalApi` (`api.todos.list()` in `apps/web/src/features/todos/todos.ts`), `createTodoHandlers` + `todos:*` channels, registered directly in `Application.ts`, `todos` methods on `LocalApi`. Todos already has its own `/todos` route.
- An unused `todosContract` + `TodoService` type exists in `packages/contracts/src/features/todos.ts` — reuse it instead of writing a new contract.
- **Persistence blockers this slice must clear:** `TodoService` builds on `AppDatabase` from `apps/desktop/src/main/platform/db/client.ts` and throws `BusinessError` from `apps/desktop/src/main/platform/BusinessError.js` — both imports are forbidden for feature code by CONTEXT.md, and `MainSdk` currently offers no storage path at all.

**Scope:**

- **Extend `MainSdk` with `storageDir` (Decision #20):** a shell-provided per-feature directory (`${userData}/plugins/<id>/`, lazily created). `bootFeatures` receives the base path from `Application.ts` (`app.getPath("userData")`); `createFakeMainSdk` provides a temp dir; browser-mode `MainSdk`s get no real dir (todos is Electron-only, and Node-free features don't need one).
- **Give todos its own database:** open `${mainSdk.storageDir}/data.db` inside `mainRegister`; move the todos drizzle schema/migrations out of the shared barrel (`apps/desktop/src/main/platform/db/schema.ts` / `apps/desktop/drizzle/`) into the feature directory (`apps/desktop/src/main/features/todos/drizzle/`), so they travel with the Slice 2 move. The todos table in the shared `app.db` is abandoned, not migrated — todos is throwaway demo data. Close the DB in `mainSdk.onDispose`.
- **Convert expected failures to `FeatureError`:** `TodoService.toggle` throws `BusinessError` today; after migration it must throw `FeatureError("Todo not found.", "NOT_FOUND")` or the message gets scrubbed at the IPC boundary. Drop the `BusinessError` / platform imports entirely.
- Create `packages/sdk-react/` with `useSdkQuery`, `useSdkMutation` (generalize the existing hand-rolled `queryOptions`/`mutationOptions` pattern from `sdk-producer/useNotes.ts`; wrap `sdk.client`/`sdk.invoke`, key cache by `[featureId, channel, ...args]`)
- **Move** (not re-export) `useSdk`, `SdkProvider`, `createFeatureSystem`, `useFeatureSystem` out of `apps/web/src/platform/sdk/` into `packages/sdk-react/`; update `apps/web` (and the existing demo features) to import from the new package. Required — CONTEXT.md forbids feature/plugin code importing `apps/*/src/platform/`, so plugins cannot consume `useSdk` while it lives there.
- Publishable shape: `peerDependencies` on the full Shared Runtime Set, explicit `exports` map, no internal imports
- Migrate todos to the SDK: `mainRegister` via `mainSdk.channels(todosContract).handleAll(...)` backed by the existing `TodoService`; add `{ id: "todos", mainRegister }` to `FEATURES`; repoint `TodoList.tsx` from `useLocalApi()` to `useSdk("todos")` + `useSdkQuery`
- No `browserRegister` for todos (Electron-only) → `WEB_FEATURES` stays as-is; browser mode skips todos with a warning. **Known regression:** browser mode currently has working in-memory todos via `browserLocalApi.ts`; after this slice the `/todos` route is dead in browser mode — the page must render an explicit "not available in browser" state rather than crash (Decision #7 accepts the loss).
- Delete legacy: `createTodoHandlers`, the `todos:*` channels, the direct `#todoService`/todos wiring in `Application.ts`, and the `todos` methods on `LocalApi`. This includes the **web platform adapters**: the `todos` sections of `electronLocalApi.ts` and `browserLocalApi.ts` plus their tests (`createLocalApi.test.ts`, `browserLocalApi.test.ts`), and the todos migration entries in the shared `apps/desktop/drizzle/` folder

**Exit criteria:**

- Todos works end-to-end via the SDK on its existing `/todos` route; `LocalApi` no longer has feature methods
- Todos persists to its own `${userData}/plugins/todos/data.db` via `mainSdk.storageDir`; no feature imports `apps/*/src/platform/`
- `apps/web` and both demo features import SDK React bindings from `packages/sdk-react/`, not `apps/web/src/platform/`
- `TodoList.browser.test.tsx` rewritten to use `createFakeSdk` instead of `LocalApiProvider`; all tests pass
- No legacy todos code remains

---

### Slice 2 — Plugin infrastructure (manifest + loader + first plugin)

**Goal:** A self-contained plugin in `plugins/` boots identically to a feature in `apps/`.

**Scope:**

- Define `plugin.json` Zod schema (`id`, `displayName`, `version`, `main`, `web`, `routes`, `zones`)
- **Add `plugins/*` to `pnpm-workspace.yaml`** (one-time; today the globs are only `apps/*` and `packages/*`)
- Move **todos** to `plugins/todos/` with the package structure above (todos is throwaway and now fully SDK-based after Slice 1 — the ideal first plugin; keep `sdk-producer`/`sdk-consumer` in `apps/` as the conformance reference)
- **Persistence:** with Decision #20 done in Slice 1, this is a pure move — todos already opens `${mainSdk.storageDir}/data.db` and its drizzle schema/migrations already live inside the feature directory; `git mv` them to `plugins/todos/drizzle/` and verify the runtime path is unchanged (`${userData}/plugins/todos/data.db`)
- Wire as pnpm workspace dependency in `apps/desktop` + `apps/web`
- Create `BUNDLED_PLUGINS` registry (re-export from workspace deps). Decide whether it replaces the dual `FEATURES` / `WEB_FEATURES` arrays or feeds both — a plugin manifest carries `main` and `web` entry points, so one registry should be able to populate both the desktop and browser boot paths.
- Loader: discover manifests → eager activate → wire into existing boot sequence
- Remove the migrated feature from `apps/`, and from both the `FEATURES` and `WEB_FEATURES` arrays

**Exit criteria:**

- Plugin in `plugins/` is discovered, activated, and fully functional
- Adding a new plugin = create directory + add workspace dep + register in `BUNDLED_PLUGINS` (the `plugins/*` workspace glob is already in place; no other shell edits)

---

### Slice 3 — Routes + zones (contribution rendering)

**Goal:** Plugins surface UI without shell code changes.

**Starting state:** the sidebar (`apps/web/src/components/layout/AppSidebarLayout.tsx`) has **hardcoded** nav items and routes are hand-authored flat files in `apps/web/src/routes/`. Neither is contribution-driven yet — converting them is the work of this slice.

**Scope:**

- **Canonical zone ids (Decision #21):** export a `ShellZone` union + constants from `feature-sdk` (`"sidebar"`, `"status-bar"`, `"dashboard"`) and align the drifted `"statusbar"` usages (SDK docstring in `types/sdk.ts`, `services.test.ts`). Without this, `getForZone` string mismatches make contributions silently render nowhere.
- Shell defines initial zones (sidebar nav, status-bar, dashboard) and renders `sdk.contribute` contributions in each (priority-ordered)
- Convert the hand-maintained sidebar nav into a `sidebar` zone so registered plugins add nav entries via `sdk.contribute` (or their manifest `routes`) instead of editing `AppSidebarLayout.tsx`
- **Host owns route creation:** the loader reads `plugin.json` `routes` and programmatically registers routes on the shell's TanStack Router, mounting the plugin's page component. The plugin does not import the router (see Decision #19). File-based codegen (`routeTree.gen.ts`) stays for shell-owned routes only.
  - **Known risk:** runtime route injection is not a first-class TanStack Router feature alongside file-based codegen. If injecting routes into the generated tree fights the router, the sanctioned fallback is a shell-owned catch-all route (e.g. `/plugin/$pluginId`) that resolves the page component from the manifest registry at render time. Either approach satisfies the exit criteria — plugins never see the router.
- Wire `sdk.navigate` as a shell delegate (navigate + subscribable current-location); pass route params/search into the mounted plugin page as props (or via an `sdk-react` hook backed by the delegate). Router never leaks to the plugin or to `sdk-react`. Note this requires **extending `ShellDelegates` in `feature-sdk`** — today `navigate` is a hardcoded throw inside `createSdk`, not a delegate.
- At least one plugin demonstrates both a full-page route and a zone contribution

**Exit criteria:**

- A plugin surfaces a navigable page via declared route, and can navigate via `sdk.navigate` — without importing `@tanstack/react-router`
- A plugin renders a widget in a shell zone via `sdk.contribute`
- No shell source changes required for either

---

### Slice 4 — Wire remaining SDK shell delegates

**Goal:** Plugins can use platform capabilities beyond `sdk.invoke`.

> **Where the stubs actually live:** `notifications` (no-op) and `fs` (rejects) are delegates in `apps/web/src/platform/sdk/SdkProvider.tsx` (post-Slice-1: `packages/sdk-react/`); but `navigate` / `tools` / `intents` / `dispatch` throw **inside `createSdk`** (`packages/feature-sdk/src/services/create-sdk.ts`) and are not part of `ShellDelegates` at all. Wiring those means extending the `ShellDelegates` interface in **feature-sdk** first, then implementing the delegate in the host.

**Scope:**

- `sdk.notifications` → real Electron notifications. **Done:** `show`/`setBadge` are async and return an honest `NotificationResult` envelope. Electron: OS `Notification` + `app.setBadgeCount` behind `notifications:*` IPC channels (`ElectronNotifications` + handlers). Browser mode: Web Notification API (permission-gated, never prompts) + Badging API where available; otherwise `delivered: false` with a reason.
- `sdk.fs` → scoped filesystem access via shell delegate. **Done — scoping model (Decision #24):** `ShellDelegates.fs` is a `ShellFsDelegate` whose methods take the calling `featureId` first; `createSdk` binds the feature's own id so `sdk.fs` cannot name another feature. Every path is relative to the feature's private sandbox — a dedicated `fs/` subdirectory of the Decision #20 storage root, i.e. `${userData}/plugins/<id>/fs/`. That subdir is a **sibling** of the feature's SQLite `data.db`, never its parent, so no `sdk.fs` call (including a recursive remove of the sandbox root) can reach the database. The main-process `ScopedFsService` rejects absolute paths, sandbox-escaping paths (`..`), and non-kebab-case feature ids; error messages never leak absolute host paths. Because features share one renderer process (Decision #12), `featureId` over IPC is a convention boundary, not proof of origin — the sandbox-root confinement holds regardless. Browser mode has no filesystem: calls reject (`sdk.fs` is a detectable capability). `createFakeSdk` ships an in-memory sandbox with the same path rules (including file/dir collision rejection).
- `sdk.navigate` → finalize the navigation delegate started in Slice 3 (router stays internal per Decision #19); ensure current-location subscription and params/search are covered. **Done:** navigate (path/search/replace), synchronous `sdk.location.subscribe` + post-navigation snapshots, `peek`, destroy-time cleanup, and the inert fallback are all tested. Manifest routes are deliberately **static paths** — there are no dynamic route params in the plugin model; search params are the parameterization mechanism (`PluginPageProps` carries `path` + `search`).
- Decide on `sdk.tools` / `sdk.intents` / `sdk.dispatch`: **deferred** — see below.

**Deferred APIs (rationale + timeline):**

`sdk.tools`, `sdk.intents`, and `sdk.dispatch` stay as throwing placeholders (stable interface shape, calls throw "not available yet"):

- **No real consumer exists.** Nothing in the repo registers an AI tool, lists intents, or dispatches a cross-plugin action; wiring them now would freeze API shapes against zero usage — exactly how APIs end up wrong. The Slice 4 rule was "implement if there's a real consumer", and there is none.
- **They are not shell delegates.** Unlike notifications/fs/navigate (thin proxies over existing host services), tools/intents need new platform machinery: a tool registry consumed by an AI runtime, an intent catalog, and a cross-plugin dispatcher with permission semantics. That machinery belongs to the AI-assistant integration, not to delegate wiring.
- **Timeline:** revisit when the first AI-runtime consumer lands (the planned kilo-code / assistant integration, expected after Slice 6's cross-process primitives, which it depends on). `sdk.tools` is expected first (register renderer-side tools for the assistant), then `sdk.dispatch`/`sdk.intents` as the command-routing story firms up. Until then the placeholders keep the SDK surface stable for plugin authors.

**Exit criteria:**

- Shell delegates are wired and tested ✅
- Deferred APIs have documented rationale and timeline ✅ (above)

---

### Slice 5 — External plugin readiness

**Goal:** An external team can develop, build, and hand over a working bundled plugin.

**Scope:**

- Bundler config template (produces `main.js` + `renderer.js` from plugin source); marks the full **Shared Runtime Set** as `external` from a single canonical list, so every plugin's externals stay in lockstep with the host
- Publish the Shared Runtime Set packages (`feature-sdk`, `sdk-react`) to a registry; pin `peerDependencies` ranges to the host's supported majors
- Host-provided SDK mechanism: host injects the Shared Runtime Set at runtime; plugins bundle everything else
- Scaffold template or `create-plugin` CLI (pre-wires the externals list + peerDeps)
- Documentation: plugin development guide, API reference, and the Shared Runtime Set compatibility contract

**Exit criteria:**

- External team can `npm init` a plugin, develop against published SDK types, build a bundle
- Core team can drop the bundle into `plugins/`, add workspace dep, and ship
- Zero source changes in the bundled plugin between external dev and in-repo integration

---

### Slice 6 — SDK real-time & cross-process primitives (events bridge + main-side cross-feature)

**Goal:** A feature can push events from its main process to its renderer, and consume another feature's main-side capability directly — with **no renderer relay and no correctness-critical caches**. This closes the gap that forces features (e.g. the planned kilo-code integration) to work around the SDK.

**Ordering / priority:** Foundational SDK+shell work, **independent of the plugin loader (Slice 2)**. Should land alongside Slice 1 and is a **hard prerequisite** for any real-time or cross-feature-in-main feature (kilo-code Phase 1 depends on it). Numbered last only because it was added later — it is **not** last in execution order.

**Why (the need, not a workaround):**

- Today `sdk.events` is an **in-memory, renderer-only** bus and `MainSdk` is just `{ featureId, channels, onDispose }` (+ `storageDir`, #20). A feature's `mainRegister` has **no way** to (a) push an event to its renderer, or (b) read/subscribe to another feature's data on the main side.
- Real features need both: streaming status/usage updates main→renderer, and main-process code resolving another feature's state (e.g. a workspace's folders) to spawn/restart backend processes at cold start.
- Without these, features are pushed into anti-patterns: relaying folder edits through the renderer, and caching another feature's data just so the main process can function. We build the primitives instead.

**Scope:**

- **Cross-process event bus (Decision #22):** add `events.emit`/`events.on` to `MainSdk` (same shape as the renderer SDK). Implement the shell bridge over a new `feature:event` IPC channel (+ preload wiring), forwarding both directions between the main and renderer `EventBus` instances and re-broadcasting to all renderer windows. Stamp the emitter's `featureId` (anti-spoof); prevent echo loops; keep fire-and-forget/at-most-once/no-replay semantics; require structured-cloneable payloads. In browser mode, share **one** in-process bus between the renderer SDK and browser-mode `MainSdk` (no bridge).
- **Main-side capability registry (Decision #23):** add `plugins.expose`/`plugins.get` to `MainSdk`, backed by a main-process `CapabilityRegistry` built in `bootFeatures`. Features expose main-side capabilities in `mainRegister`; consumers call `mainSdk.plugins.get(featureId)` with the same graceful-`null` contract as the renderer.
- **Testing:** extend `createFakeMainSdk` with `events` + `plugins`; provide a linked fake main+renderer pair sharing one bus so a single test asserts main-emit → renderer-receive (and vice-versa). Unit-cover the bridge relay, namespace stamping, echo-loop prevention, dispose cleanup, and capability null-degradation.
- **Docs:** update CONTEXT.md's SDK surface + terminology; record the delivery/serialization semantics.

**Exit criteria:**

- A feature emits from `mainRegister` and its renderer receives via `sdk.events.on("<featureId>.<name>")` in Electron **and** browser mode.
- A feature's main code resolves another feature's capability via `mainSdk.plugins.get(...)` without any renderer involvement.
- No feature needs `webContents.send`, a renderer relay, or a cross-feature cache to function.
- Tests cover both directions and the null-degradation path.

**Downstream (kilo-code spec, not built here):** `workspace_servers` becomes a pure performance cache; `server.syncWorkspace` renderer-relay is replaced by kilo-code main subscribing to `workspaces.workspace-updated` + pulling folders via `mainSdk.plugins.get("workspaces")`; `kilo-code.*` push events ride `feature:event`.

---

## Reference

- [CONTEXT.md](../CONTEXT.md) — architecture, terminology, conventions (note: its `todos` examples are aspirational; the live SDK reference is `sdk-producer`/`sdk-consumer`)
- **Live reference implementation:** `sdk-producer` + `sdk-consumer` in `apps/{desktop,web}/src/features/` and `packages/contracts/src/features/` — copy from these for new SDK features
- Migration Readiness Brief — the shim SDK strategy and migration path (branch `docs/migration-readiness-brief`, `docs/migration-readiness-brief.md`; not yet merged into this branch)
- [PR #20](https://github.com/anaconda/agentic-desktop/pull/20) — demo plugins exercising every SDK API (merged into `main`)

> **Note on a future `packages/ui`:** the Migration Readiness Brief anticipates a `packages/ui` for shared shadcn primitives extracted from `apps/web`. This plan does not create it. `useSdkQuery` / `useSdkMutation` belong in `packages/sdk-react/` (SDK data-fetching bindings), not `ui` (presentational primitives). If `ui` lands later, the split stays clean.
