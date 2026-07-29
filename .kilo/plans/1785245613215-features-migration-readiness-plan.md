# Migration-Ready Feature Development Plan

**Goal:** features written NOW must migrate to plugins with minimal friction, then extract to a separate plugin repo with minimal friction. Every decision optimizes for `feature → in-repo plugin → external repo plugin`.

## Core strategy

Features program against a **shim SDK** whose shape matches the future real SDK. Migration = file moves + package rename; not a rewrite.

## Decisions (settled)

1. **Extract `packages/ui/` now.** shadcn primitives move out of `apps/web/src/components/ui/` before the next feature. Consumers import `@anaconda-agentic-desktop/ui`.
2. **Introduce `packages/feature-sdk/` shim.** Exposes `useSdk()`, `sdk.ipc`, `sdk.events`, `sdk.state`, `sdk.plugins`, `sdk.contribute`, `sdk.notifications`. Wraps `LocalApi` today; becomes the real SDK later (renamed to `packages/sdk`).
3. **Introduce `packages/testing/`.** Exports `createFakeSdk`, `createFakeMainSdk`. All feature tests use it.
4. **Design publishable packages from day one** (`sdk`, `ui`, `testing`):
   - Real build step (`tsc` → `dist/` with `.d.ts`)
   - `main`/`types` point at `dist/`
   - `files: ["dist"]` whitelist
   - `react`, `react-dom`, `zod` as `peerDependencies` (never `dependencies`)
   - CI dry-run of `pnpm publish --dry-run`
5. **`packages/contracts` stays shell-internal.** Plugins never depend on it. Anything plugin-relevant is re-exported through `packages/sdk`.
6. **Data-driven feature registration.** `apps/desktop/src/main/Application.ts` iterates over a `FEATURES` array (rather than hand-registering each feature). Same on the renderer. The array becomes `BUNDLED_PLUGINS` at migration.
7. **Per-feature isolated SQLite.** Features that persist state open `${userData}/features/<id>/data.db` from day one. Path becomes `${userData}/plugins/<id>/data.db` on migration. No data migration ever required.
8. **Per-feature route convention.** Each feature owns exactly one route file at `apps/web/src/routes/features/<id>.tsx`. Migrates to plugin canvas mount without shell route rewrites.
9. **Feature source lives in three predictable locations** (mirrors the plugin's future internal layout):
   - `apps/desktop/src/main/features/<id>/` — Node/service code
   - `apps/web/src/features/<id>/` — React code
   - `packages/contracts/src/features/<id>.ts` — Zod schemas (moves to `plugins/<id>/src/contracts/` on migration)

## Developer guidelines

Publish as `docs/features-that-will-become-plugins.md`.

**Do:**

- Import from `@anaconda-agentic-desktop/feature-sdk` for feature work. Use `LocalApi` only for shell-level things (theme, notifications, shell.openExternal, filesystem).
- Namespace everything by feature ID: events (`todos.deleted`), state keys (`todos.active`), capabilities (`sdk.plugins.expose('todos', ...)`).
- Import shadcn primitives from `@anaconda-agentic-desktop/ui`.
- Own your own SQLite file if you persist state.
- Own your own route at `apps/web/src/routes/features/<id>.tsx`.
- Test with `createFakeSdk` (from `@anaconda-agentic-desktop/testing`).
- Register through the `FEATURES` array; never edit `Application.ts` by hand.

**Don't:**

- Add feature-specific methods to `LocalApi`.
- Import from `@/components/ui/*`, `@/lib/*`, or `apps/desktop/src/main/platform/*`.
- Import from another feature's source. Cross-feature = `sdk.events` / `sdk.plugins.get` / `sdk.state.get`.
- Share DB tables across features.
- Use React Context for cross-feature communication (fine inside one feature).
- Emit un-namespaced events.

## Migration path checkpoint (per feature)

At any time, a feature is "migration-ready" if all of these hold:

- [ ] No imports from other features
- [ ] No imports from `apps/*` internals (only `@anaconda-agentic-desktop/{feature-sdk,ui,testing,contracts}`)
- [ ] Registered via `FEATURES` array
- [ ] Owns its own SQLite file (if persistent)
- [ ] Single route at `apps/web/src/routes/features/<id>.tsx`
- [ ] Tests use `createFakeSdk`, no `LocalApiProvider` in test setup

If all checked, migration to `plugins/<id>/` is a `git mv` + minor import fixes.

## Implementation task list

Ordered. Each is one PR.

1. **Extract `packages/ui/`.** Move shadcn primitives out of `apps/web/src/components/ui/`. Move `components.json` alongside. Update `apps/web` imports. Configure `peerDependencies` for React. Add a build step.
2. **Extract `packages/testing/`.** Move `createFakeLocalApi` (renamed to `createFakeSdk`, shape-adjusted) from `TodoList.browser.test.tsx`. Peer-dep React. Add build step.
3. **Introduce `packages/feature-sdk/`.**
   - Shape: `SDK` interface identical to what the real plugin SDK will expose
   - `useSdk(featureId)` hook + `SdkProvider` (or per-feature scoping via context)
   - Runtime: in-memory `EventBus`, `StateBroker`, `CapabilityRegistry`, `ContributionRegistry`
   - `sdk.ipc.invoke(channel, args)` bridges to `LocalApi[featureId][channel]` today
   - `sdk.notifications`, `sdk.theme`, `sdk.shell` delegate to `LocalApi`
   - Peer-dep React. Build step. Published shape from day one.
4. **Introduce `FEATURES` array.**
   - `apps/desktop/src/main/features/index.ts` — array of feature registrations (main-side)
   - `apps/web/src/features/index.ts` — array of feature registrations (renderer-side)
   - `Application.ts` iterates the array
   - Root React tree iterates the array to render contributions/routes
5. **Migrate `todos` to the new pattern** (in place, still inside `apps/*`, not to `plugins/`):
   - Renderer uses `useSdk('todos').ipc.invoke('list' | 'add' | 'toggle')` instead of `useLocalApi().todos.*`
   - `LocalApi.todos` deleted; both adapters lose the todos methods
   - Handlers register via `FEATURES` array
   - Todos opens its own SQLite file at `${userData}/features/todos/data.db`
   - Route moves to `apps/web/src/routes/features/todos.tsx`
   - Tests use `createFakeSdk`
   - **This becomes the reference implementation** for every future feature
6. **Write `docs/features-that-will-become-plugins.md`.** Reference the migrated `todos` feature.

## Deferred / out of scope for this plan

- Building the real plugin system (already scoped by `docs/plugin-system-tasks.md`).
- Dev shell / harness for external plugin authors (needed at stage 2, not now).
- Third-party plugin ecosystem support (concurrent SDK versions, sandboxing, etc.).
- Migrating any feature other than `todos` in this pass.

## Risks

- **Shim leakage.** If the shim exposes quirks (specific error messages, undocumented behavior) that features rely on, swapping to the real SDK breaks them. Mitigation: shape-check the shim against the SDK type in CI.
- **`LocalApi` becoming a graveyard.** Features drifting back to `LocalApi` for expediency. Mitigation: lint rule forbidding `useLocalApi` in `apps/web/src/features/**` (only shell-level code can call it).
- **peerDep resolution surprises inside the workspace.** pnpm handles this normally but strict/isolated modes can be finicky. Mitigation: verify with `pnpm why react` in a plugin directory after setup.

## Validation

After task 5 (`todos` migrated):

- `pnpm check && pnpm lint && pnpm test` all green
- E2E: launch app, todos still works end-to-end
- `pnpm publish --dry-run` succeeds for `sdk`, `ui`, `testing`
- Grep confirms no `apps/web/src/features/todos/**` file imports from `apps/**` internals

## Open decisions requiring user input

One remaining question before finalizing:

**Q: Aggressive shim (features NEVER touch `LocalApi`) vs. loose shim (`LocalApi` remains for shell-level things: theme, notifications, shell, filesystem)?**

Recommendation: **loose**. `LocalApi` is a good facade for genuinely shell-level features that will always live in the shell. Forbidding it for feature code is enough; reimplementing everything it provides in the shim is wasted work. The shim delegates to `LocalApi` for `sdk.theme`/`sdk.notifications`/`sdk.shell` under the hood.
