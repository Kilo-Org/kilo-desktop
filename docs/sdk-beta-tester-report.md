# SDK Shim Architecture — Beta Tester Report (v2)

**Feature tested:** `sdk-explorer` (exercises every SDK shim API)
**Date:** 2026-07-29
**Branch:** `demo-plugin` (merged from `feat/feature-sdk` @ `f219c1a`)
**SDK version:** Post-hardening (schema validation, Set-based disposal, factory-based provider)

---

## Summary

The second iteration of the SDK shim addresses several critical issues from v1. The architecture is now significantly more solid:

- `createFeatureSystem()` replaces the global singleton — fully testable
- `useSdk()` returns a **cached, shared instance** per feature — no more StrictMode double-create
- `MainSdk.handle(channel, schema, handler)` validates at the routing boundary
- `createFakeSdk()` now uses real in-memory services — tests behave like production
- `sdk.destroy()` is properly scoped (instance-level) vs. `teardownFeature()` (shell-level)
- Disposables use `Set` with self-cleaning subscriptions — no unbounded growth

The remaining issues are either DX friction or missing convenience APIs, not architectural flaws.

---

## Issues RESOLVED from v1

### ~~1. CRITICAL: Global singleton~~ → FIXED

`createFeatureSystem(api, features)` is now a factory function. Each call returns an independent `FeatureSystem` with its own service instances. `SdkProvider` takes a `system` prop — no globals. Tests can create isolated systems trivially:

```ts
const system = createFeatureSystem(fakeApi, [myFeature]);
render(<SdkProvider system={system}><MyComponent /></SdkProvider>);
```

### ~~2. HIGH: StrictMode double-create~~ → FIXED

`useSdk(featureId)` now calls `system.getSdk(featureId)` which returns a **cached** instance. The SDK is created once per feature and shared by all components. It is NOT destroyed on unmount — teardown is shell-owned. StrictMode double-renders are harmless.

### ~~8. LOW: `createFakeSdk` typing friction~~ → MOSTLY FIXED

The new `createFakeSdk` is built on real services. Most tests don't need overrides at all — just pass `handlers` and everything works:

```ts
const sdk = createFakeSdk({
    featureId: "my-feature",
    handlers: { list: () => [...data] },
});
```

No more manually typing `emit`, `on`, `get`, etc.

### ~~9. LOW: Command deduplication~~ → FIXED

`CommandRegistry.register` now warns and replaces on duplicate `featureId.commandId`.

---

## Issues REMAINING from v1 (re-evaluated)

### 3. MEDIUM: `sdk.state.get` requires full namespaced key (unchanged)

Still must write `sdk.state.get("sdk-explorer.click-count")` instead of `sdk.state.get("click-count")`. The new `ReadableStore<T | null>` return type (lazy resolution) makes this slightly more ergonomic to handle (subscribers get `null` until hydrated), but the naming ergonomics issue persists.

**Severity downgraded:** from HIGH to MEDIUM — the new nullable return type signals "this might not exist yet", which makes the pattern more obvious.

### 4. MEDIUM: `sdk.events.on` asymmetry with `emit` (unchanged)

Still a DX trap. No `onOwn()` method was added. Feature developers must remember:
- `sdk.events.emit("foo")` → emits `"sdk-explorer.foo"`
- `sdk.events.on("sdk-explorer.foo", handler)` → must use full namespace

### 5. MEDIUM: `sdk.plugins.get` returns untyped `Record<string, unknown>` (unchanged)

Still requires unsafe casts at the consumer site.

### 6. LOW: `sdk.contribute` has no return handle (changed behavior)

**Downgraded to LOW.** The internal `disposables.add(unregister)` means `sdk.destroy()` properly cleans up contributions. And since the SDK instance is now cached (not per-component), contributions live for the feature's lifetime. The need for a manual remove handle is less pressing. Still nice-to-have for conditional UI.

### 7. LOW: `sdk.fs` not wired (slightly improved)

The error message is now more explicit: `"sdk.fs is not yet wired to a shell service."` — consistent with the other `notYetWired` services. Still on the type though.

### 10. LOW: No `sdk.runtime.mode` (unchanged)

---

## NEW Issues Found in v2

### 11. MEDIUM: `sdk.notifications.show/setBadge` now throws — no gradual degradation

**File:** `apps/web/src/platform/sdk/SdkProvider.tsx:42-44`

In v1, notifications were silently no-ops (`console.info`). In v2, they throw via `notYetWired()`. This means any feature that calls `sdk.notifications.show()` will crash unless it wraps in try/catch.

**Impact:** The "fail loud" philosophy is debatable here. Features shouldn't silently believe a user saw a notification — but crashing the feature because the notification system isn't wired yet is overly aggressive. In our sdk-explorer, we had to wrap every notification call in try/catch.

**Recommendation:** Use a two-tier approach:
- Development mode: throw (to catch unintended reliance on notifications)
- Production mode: warn + no-op (graceful degradation)
- Or: return a `{ delivered: false }` result instead of throwing

### 12. MEDIUM: `WEB_FEATURES` duplication problem — no shared feature code path

**File:** `apps/web/src/features/features.ts`

The `WEB_FEATURES` array must replicate handler logic from `apps/desktop/src/main/features/`. For Node-free features (like `sdk-explorer`), you can't just import the desktop `mainRegister` because `apps/web/` cannot import from `apps/desktop/src/main/`. This forces you to either:

1. Duplicate the entire handler logic in `features.ts` (what we did)
2. Move shared handler code to a separate package (heavy)
3. Use `browserRegister` which is still just duplication

**Impact:** For our simple `NoteService`, this means maintaining two copies of the same logic. Any bug fix must be applied in both places. This will scale poorly.

**Recommendation:**
- For Node-free features, allow `WEB_FEATURES` to import from a shared location (e.g., a `features/` workspace package, or co-locate browser-safe handlers in `packages/contracts`)
- Or document that `browserRegister` should import from a shared service file that lives outside both apps

### 13. LOW: `FeatureRegistration.browserRegister` is optional but the fallback semantics are surprising

**File:** `packages/feature-sdk/src/types/sdk.ts:229-234`

When `browserRegister` is omitted, browser mode falls back to `mainRegister`. But `mainRegister` might use Node APIs (SQLite, fs, etc.) which will crash in the browser. The type system doesn't prevent this — it's a runtime bomb.

**Impact:** A developer could add a feature with SQLite in `mainRegister`, forget to add `browserRegister`, and the standalone web app crashes silently on boot.

**Recommendation:** Either:
- Make `browserRegister` required (forcing explicit opt-in to "my mainRegister is browser-safe")
- Or add a `nodeOnly: true` flag that skips the feature in browser mode
- Or validate at boot time that `mainRegister` doesn't throw before committing the feature

### 14. LOW: `sdk.state.get` creates a placeholder entry that persists

**File:** `packages/feature-sdk/src/services/state-broker.ts:62-69`

Calling `sdk.state.get("some.nonexistent.key")` creates an unhydrated store entry in the map. This is by design (lazy resolution for cross-feature state), but it means:

- Typos in key names silently create garbage entries
- No way to know if a store was intentionally registered vs. accidentally created by a `get()` call

**Recommendation:** Add a `sdk.state.has(key): boolean` check, or log a warning in development mode when subscribing to an unhydrated store that never hydrates within N milliseconds.

---

## What Works Well (v2 additions)

1. **Factory-based `createFeatureSystem`** — Clean, testable, no globals. Multiple instances work perfectly in tests.

2. **Cached SDK instances via `getSdk()`** — `useSdk()` is now a one-liner. No refs, no effects, no double-creates. The shared instance per feature is the right model.

3. **Schema validation at the routing boundary** — `mainSdk.handle("add", addNoteInput, (input) => ...)` means handlers receive already-validated, typed args. This eliminates an entire class of bugs and reduces boilerplate (no more manual `parse()` in every handler).

4. **`createFakeSdk` with real services** — The `handlers` option + `.services` access is excellent DX. Tests can verify registrations through `sdk.services.commandRegistry.all()` without mocking.

5. **`FeatureRouter` fallback transport** — The `InvokeFallback` constructor option cleanly separates "local handler exists" from "route through IPC". No more patching `featureRouter.invoke`.

6. **`teardownFeature` vs. `sdk.destroy()`** — The distinction between instance-level cleanup (component unmount) and feature-level teardown (plugin unload) is well-modeled and prevents accidental handler removal.

7. **`FeatureError` with structured codes** — `VALIDATION`, `NOT_FOUND`, `BUSINESS` — clean error taxonomy that will survive IPC serialization.

8. **`CommandRegistry` warns on duplicate** — Instead of silently accumulating duplicates, it replaces and warns. Good for HMR/StrictMode.

---

## Updated Priority Table

| #   | Severity | Status   | Summary                                         |
| --- | -------- | -------- | ----------------------------------------------- |
| 1   | ~~Critical~~ | **FIXED** | Factory-based createFeatureSystem             |
| 2   | ~~High~~     | **FIXED** | Cached SDK instances, no StrictMode issue     |
| 11  | Medium   | NEW      | notifications.show throws — too aggressive    |
| 12  | Medium   | NEW      | WEB_FEATURES duplication problem              |
| 3   | Medium   | Open     | state.get requires full namespaced key        |
| 4   | Medium   | Open     | events.on/emit asymmetry                      |
| 5   | Medium   | Open     | plugins.get returns untyped Record            |
| 13  | Low      | NEW      | browserRegister fallback is a runtime trap    |
| 14  | Low      | NEW      | state.get creates phantom entries             |
| 6   | Low      | Downgraded | contribute has no return handle (less needed now) |
| 7   | Low      | Open     | sdk.fs not wired but on the type              |
| 8   | ~~Low~~  | **FIXED** | createFakeSdk uses real services now          |
| 9   | ~~Low~~  | **FIXED** | Command dedup with warn-and-replace           |
| 10  | Low      | Open     | No sdk.runtime.mode                           |

---

## Overall Assessment

**v1 → v2 is a major improvement.** The 2 critical/high issues are gone. The SDK is now production-viable for internal feature development. The remaining issues are DX polish (events asymmetry, state key ergonomics) and forward-looking concerns (WEB_FEATURES duplication, notifications throwing).

The `sdk-explorer` plugin successfully exercises all SDK APIs and serves as both a smoke test and a living reference implementation.
