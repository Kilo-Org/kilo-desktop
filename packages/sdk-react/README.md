# @anaconda-agentic-desktop/sdk-react

React bindings for the feature SDK. Thin layer that turns the transport-agnostic `SDK` from `@anaconda-agentic-desktop/feature-sdk` into React context, hooks, and TanStack Query integration — so feature UI code stays a two-liner per channel.

- **Feature authors:** read [Quick start](#quick-start) and [Hooks](#hooks). You only ever touch `useSdk`, `useSdkQuery`, `useSdkMutation`.
- **Shell authors:** read [Architecture](#architecture) and [Wiring the shell](#wiring-the-shell). `createFeatureSystem` and `useFeatureSystem` are shell infrastructure — feature code never calls them.

## Why this package exists

`feature-sdk` is UI-agnostic. It gives you an `SDK` instance whose `invoke("channel", input)` returns a `Promise`, plus shell delegates (`sdk.notifications`, `sdk.fs`, `sdk.auth`, …) and event/state helpers. That's enough to build a feature, but not enough to build a _React_ feature without repeating three chores per channel:

1. Provider plumbing so components can reach the right SDK instance.
2. A cache keyed by feature+channel+args so reads don't refetch on every render.
3. A mutation helper that invalidates the right cache entries on write.

This package does all three, once, in a way that stays honest to the SDK's transport boundary (channel names + typed input/output — no in-process shortcuts).

## Quick start

```tsx
// Feature UI — plugins/todos/src/web/TodoList.tsx
import { useSdk, useSdkQuery, useSdkMutation } from "@anaconda-agentic-desktop/sdk-react";
import type { TodoService } from "../contracts/schemas.js";

export function TodoList() {
	const sdk = useSdk<TodoService>("todos");
	const todos = useSdkQuery(sdk, "list"); // UseQueryResult<Todo[]>
	const addTodo = useSdkMutation(sdk, "add", { invalidates: ["list"] }); // refresh list on success

	if (todos.isPending) return <p>Loading…</p>;
	return (
		<>
			<button onClick={() => addTodo.mutate({ title: "Buy milk" })}>Add</button>
			<ul>
				{todos.data?.map((t) => (
					<li key={t.id}>{t.title}</li>
				))}
			</ul>
		</>
	);
}
```

Three rules to remember:

- **`useSdk<TService>(featureId)`** — one shared SDK instance per feature, cached until the shell tears the feature down. Never store it in component state; call the hook wherever you need it.
- **`useSdkQuery(sdk, channel, ...args)`** — reads. Cache key is `[featureId, channel, ...args]` automatically.
- **`useSdkMutation(sdk, channel, { invalidates })`** — writes. `invalidates` is an array of channel names on the _same_ feature to refresh on success.

If your channel signature says `add(input: { title: string }): Promise<Todo>`, the hook types line up: `addTodo.mutate({ title })` is checked; `todos.data` is `Todo[] | undefined`.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Shell startup                                                      │
│                                                                     │
│    createFeatureSystem({ shellDelegates, invokeFallback?,           │
│                          features? })                               │
│                                                                     │
│      services = {                                                   │
│        eventBus, stateBroker,                                       │
│        capabilityRegistry, contributionRegistry, commandRegistry,   │
│        featureRouter,                                               │
│        shellDelegates,                                              │
│      }                                                              │
│                                                                     │
│      Browser mode only: run each feature.browserRegister(mainSdk)   │
│                                                                     │
│      returns FeatureSystem { services, getSdk, teardownFeature }    │
│                                                                     │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
              <SdkProvider system={system}>
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
       useFeatureSystem()             useSdk<T>("todos")
       (shell UI: registries,         (feature UI: one shared SDK
        teardown)                      instance, cached per feature)
                                             │
                          ┌──────────────────┼──────────────────┐
                          ▼                  ▼                  ▼
                    useSdkQuery       useSdkMutation      sdk.notifications,
                    (reads,           (writes, TS Query    sdk.fs, sdk.auth,
                     TS Query cache)   invalidation)       sdk.events, …
                          │                  │                  │
                          └────────┬─────────┘                  │
                                   ▼                            │
                            sdk.invoke("channel", input)         │
                                   │                            │
                                   ▼                            ▼
                        FeatureRouter dispatches      ShellDelegates on the
                        to in-process handler         shell (notifications,
                        OR calls invokeFallback       fs, auth, theme, …)
                        (IPC in Electron, throw       — provided by the host
                         in browser)
```

Three things to understand:

### 1. The `FeatureSystem` is a shell singleton

Created once at app startup, passed to `<SdkProvider>`, and lives for the whole process. It owns the registries (`eventBus`, `stateBroker`, `capabilityRegistry`, `contributionRegistry`, `commandRegistry`, `featureRouter`) and the shell delegates. Features never touch it directly.

### 2. `SDK` instances are cached per feature, not per component

`useSdk("todos")` returns the _same_ instance for every component in the same tree. `SdkProvider` caches instances in a `Map<featureId, SDK>` on the `FeatureSystem`. Lifetimes are shell-owned:

- **Never** destroy an SDK on component unmount — other components of the same feature may still be mounted.
- **Only** the shell tears a feature down (plugin unload → `system.teardownFeature("todos")`), which disposes its cached SDK, runs `teardownFeature` on the feature-sdk services (clearing the feature's event listeners, state entries, capabilities, contributions, commands, router handlers), and drops the map entry.

Trying to use `useSdk` outside `<SdkProvider>` throws — the same rule as any other React context.

### 3. Two transport modes, one API

The channel side of the SDK (`sdk.invoke`, `useSdkQuery`, `useSdkMutation`) is transport-agnostic. `createFeatureSystem` decides how a channel that isn't handled in-process gets dispatched:

| Host         | `invokeFallback` | `features` | What happens on `sdk.invoke("channel", input)`                                                                                                                          |
| ------------ | ---------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Electron** | required (IPC)   | ignored    | `FeatureRouter` sends the call over the host's generic `feature:invoke` IPC channel. Feature backends live in the main process (`mainRegister`), never in the renderer. |
| **Browser**  | omitted          | required   | `FeatureRouter` dispatches to an in-process handler registered by `feature.browserRegister(mainSdk)`. Features without `browserRegister` are skipped with a warning.    |

Feature _frontend_ code (`useSdk`, `useSdkQuery`, `useSdkMutation`) is identical in both modes — that's the whole point.

## Public API

### `createFeatureSystem(options): FeatureSystem`

Called once by the shell at startup.

```ts
interface CreateFeatureSystemOptions {
	shellDelegates: ShellDelegates; // notifications, fs, auth, theme, shell, navigation
	invokeFallback?: InvokeFallback; // usually the Electron IPC bridge
	features?: readonly FeatureRegistration[]; // browser-mode in-process features
}
```

### `SdkProvider`

React context provider. Wrap once, high in the tree.

```tsx
<SdkProvider system={system}>
	<QueryClientProvider client={queryClient}>…</QueryClientProvider>
</SdkProvider>
```

`SdkProvider` does **not** provide the TanStack `QueryClient` — the host does. Feature hooks assume both are present. Order does not matter as long as both are ancestors of the feature UI.

### Hooks

| Hook                                             | Returns                                            | Use for                                                                                    |
| ------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `useSdk<T = SdkClient>(featureId)`               | `SDK<T>`                                           | Feature UI. Pass your `TService` type from the contract so `sdk.client.<method>` is typed. |
| `useSdkQuery(sdk, channel, ...args)`             | `UseQueryResult<TResult>`                          | Reads. Cache key = `[featureId, channel, ...args]`.                                        |
| `useSdkMutation(sdk, channel, { invalidates? })` | `UseMutationResult<TResult, Error, TArgs \| void>` | Writes. `invalidates` refreshes reads on other channels of the same feature on success.    |
| `useFeatureSystem()`                             | `FeatureSystem`                                    | Shell UI only (registries, teardown). Feature code should not call this.                   |

### Query option factories

Escape hatches for prefetching, imperative reads/writes, or composing with other TanStack utilities. Same cache semantics as the hooks.

```ts
import {
	sdkQueryKey,
	sdkQueryOptions,
	sdkMutationOptions,
} from "@anaconda-agentic-desktop/sdk-react";

await queryClient.prefetchQuery(sdkQueryOptions(sdk, "list"));
queryClient.setQueryData(sdkQueryKey(sdk, "list"), []);
queryClient
	.getMutationCache()
	.build(queryClient, sdkMutationOptions(sdk, "add", queryClient, { invalidates: ["list"] }));
```

## Wiring the shell

The host owns the `FeatureSystem`, the `QueryClient`, and the delegates. This is how `apps/web` does it:

```tsx
// apps/web/src/platform/featureSystem.ts
import { createFeatureSystem } from "@anaconda-agentic-desktop/sdk-react";

export function createAppFeatureSystem(api: LocalApi, navigation: SdkNavigation) {
	return createFeatureSystem({
		shellDelegates: createShellDelegates(api, navigation),
		invokeFallback: hasElectron ? electronInvokeFallback : undefined,
		features: hasElectron ? undefined : BROWSER_FEATURES,
	});
}
```

```tsx
// apps/web/src/app/AppProviders.tsx
<LocalApiProvider api={localApi}>
	<SdkProvider system={system}>
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	</SdkProvider>
</LocalApiProvider>
```

The `shellDelegates` object is the host's contract with the SDK — each field is an object of async methods (notifications, fs per-feature, auth, theme, shell, navigation). See `feature-sdk` docs and `apps/web/src/platform/featureSystem.ts` for the reference implementation.

## Testing

`test-helpers.ts` exports `createTestShellDelegates()` — a minimal `ShellDelegates` where every method either returns a sensible default (`{ delivered: true }`, `"light"`, `{ status: "anonymous" }`) or throws with a clear "not implemented in this test" message on the ones you're unlikely to need. Compose it with `createFeatureSystem` + your own fake features when you need a full provider tree in a browser-mode test:

```tsx
import { createFeatureSystem, SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createTestShellDelegates } from "@anaconda-agentic-desktop/sdk-react/test-helpers";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const system = createFeatureSystem({
	shellDelegates: createTestShellDelegates(),
	features: [
		{
			id: "todos",
			browserRegister: (mainSdk) => {
				/* fake handlers */
			},
		},
	],
});
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

render(
	<SdkProvider system={system}>
		<QueryClientProvider client={queryClient}>
			<TodoList />
		</QueryClientProvider>
	</SdkProvider>,
);
```

For feature-level tests where a full provider tree is overkill, prefer `createFakeSdk` from `@anaconda-agentic-desktop/testing` and pass the fake SDK directly — see the `write-vitest` skill.

## Package boundaries

- **Peer deps only** — `react`, `react-dom`, `@tanstack/react-query`, `@anaconda-agentic-desktop/feature-sdk`, `zod`. The host provides all of them.
- **No side effects at import time.** `createFeatureSystem` is the single entry point that touches globals (registers services). Modules are safe to import lazily.
- **No dependency on `apps/*` or `plugins/*`.** This package is a leaf of the dependency graph — do not import shell code here.

## See also

- `packages/feature-sdk/README.md` — the underlying SDK: contracts, `SDK`, `MainSdk`, `ShellDelegates`.
- `docs/plugin-implementation-plan.md` — how features graduate into plugins and how this package is expected to evolve.
- `.agents/skills/write-vitest/SKILL.md` — when to reach for `createFakeSdk` instead of a full `SdkProvider` in tests.
