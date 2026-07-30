# @anaconda-agentic-desktop/feature-sdk

The shim SDK that features program against today, shaped like the future plugin SDK. Code written against this package migrates to a plugin (and later to an external repo) via filesystem moves — no rewrites.

- **Feature authors:** read [Quick start](#quick-start) and [SDK primitives](#sdk-primitives). You only ever touch `SDK`, `MainSdk`, and `FeatureError`.
- **Shell authors:** read [Shell wiring](#shell-wiring-internals). The service classes (`EventBus`, `StateBroker`, ...) are shell infrastructure — feature code never constructs them.

## Quick start

A feature ships two halves that communicate only through the SDK:

```
apps/desktop/src/main/features/<id>/    # backend: services, DB, handlers (mainRegister)
apps/web/src/features/<id>/             # frontend: React components, hooks (useSdk)
packages/contracts/src/features/<id>.ts # Zod schemas shared by both
```

**Backend** — register handlers in `mainRegister`, declare it in the FEATURES array:

```ts
// packages/contracts/src/features/todos.ts
// Shell IPC uses defineIpcMethod (prefixed). Feature-SDK channels reuse those
// method contracts unprefixed. On plugin migration, move the channel map into
// the plugin and build it with defineMethod from feature-sdk.
import { z } from "zod";
import { defineIpcMethod } from "../contract.js";

export const todoSchema = z.object({
	id: z.string(),
	title: z.string(),
	completed: z.boolean(),
});

export const todoMethods = {
	"todos:list": defineIpcMethod(z.undefined(), z.array(todoSchema)),
	"todos:add": defineIpcMethod(z.object({ title: z.string().trim().min(1).max(120) }), todoSchema),
	"todos:toggle": defineIpcMethod(z.object({ id: z.string().min(1) }), todoSchema),
} as const;

export const todosChannels = {
	list: todoMethods["todos:list"],
	add: todoMethods["todos:add"],
	toggle: todoMethods["todos:toggle"],
} as const;
```

```ts
// apps/desktop/src/main/features/todos/index.ts
import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";
import { todosChannels } from "@anaconda-agentic-desktop/contracts";
import { TodoService } from "./TodoService.js";

export function mainRegister(mainSdk: MainSdk) {
	const service = new TodoService();
	const api = mainSdk.channels(todosChannels);

	// Input + output validated at the routing boundary from the channel map.
	api.handle("list", () => service.list());
	api.handle("add", (input) => service.add(input.title));
	api.handle("toggle", (input) => service.toggle(input.id));

	mainSdk.onDispose(() => service.close()); // runs on shutdown / feature unload
}
```

**Frontend** — wrap `useSdk` with `withChannels` so invoke is typed:

```tsx
// apps/web/src/features/todos/TodoList.tsx
import { useQuery } from "@tanstack/react-query";
import { withChannels } from "@anaconda-agentic-desktop/feature-sdk";
import { todosChannels } from "@anaconda-agentic-desktop/contracts";
import { useSdk } from "@/platform/sdk";

export function TodoList() {
	const sdk = withChannels(useSdk("todos"), todosChannels);
	const todos = useQuery({
		queryKey: ["todos", "list"],
		queryFn: () => sdk.invoke("list"), // Promise<Todo[]>
	});
	// ...render
}
```

`useSdk` returns a **shared, cached instance per feature** — it is never destroyed on component unmount. Teardown is shell-owned and only happens on feature/plugin unload.

## SDK primitives

### `sdk.invoke(channel, args?)` — call your own backend

Transport-agnostic request/response to a handler this feature registered in `mainRegister`. In Electron it crosses IPC through the generic `feature:invoke` channel; in standalone browser mode it calls the handler in-process. Same code either way.

The base `SDK.invoke` is untyped (shell transport). Features should define a **channel map** with `defineMethod` and brand the instance with `withChannels` (compile-time types only — the router parses at the handler boundary):

```ts
const sdk = withChannels(useSdk("todos"), todosChannels);
const todo = await sdk.invoke("add", { title: "Buy milk" }); // typed; parsed by the router
```

Schemas may transform values. The typed SDK accepts the input schema's raw
input, handlers receive its parsed output, handlers return the output schema's
raw input, and callers receive its parsed output. Parsing happens once in the
feature router, in both Electron and browser mode.

**Use when:** the renderer needs data or side effects from this feature's own backend (DB reads/writes, Node-only work).
**Don't use for:** calling _another_ feature's backend — that's what capabilities (`sdk.plugins`) are for. `sdk.invoke` is scoped to your own `featureId` by construction.

Register handlers with the same map (`mainSdk.channels(todosChannels).handle("add", ...)`) so input and output are validated on the main side too.

### `sdk.events` — fire-and-forget pub/sub

Cross-feature notifications. `emit` is auto-prefixed with your feature ID; `on` subscribes to fully-qualified names, so you can listen to any feature's events.

```ts
// In the todos feature — emits "todos.created"
sdk.events.emit("created", { id: todo.id });

// In another feature — reacts to it
const unsub = sdk.events.on("todos.created", (payload) => {
	refreshDashboard();
});
```

**Use when:** something happened and zero-or-more other features may care. Emitter must not depend on who is listening.
**Don't use for:** request/response (use `invoke` or capabilities), or state another feature needs to _read at any time_ (use `sdk.state`). Events are not replayed — a subscriber that attaches late missed earlier emissions.

Subscriptions made through an SDK instance are cleaned up automatically when that instance is destroyed. Handlers that throw are isolated (logged, siblings still run).

### `sdk.state` — observable shared state

Registered stores are readable by every feature. `subscribe` fires synchronously with the current value; `get` on a not-yet-registered key returns a lazy placeholder that emits `null` until the owner registers it (hydrates).

```ts
// Owner side
const unread = sdk.state.register("unreadCount", 0);
unread.set(5); // notifies all subscribers

// Consumer side (any feature)
const store = sdk.state.get<number>("todos.unreadCount");
store.peek(); // number | null — null until hydrated
const unsub = store.subscribe((v) => setBadge(v ?? 0));

sdk.state.has("todos.unreadCount"); // true only once the owner registered it —
// distinguishes "not loaded / typo" from a null value
```

React components consume stores with `useSyncExternalStore`:

```ts
import { useSyncExternalStore } from "react";
import type { ReadableStore } from "@anaconda-agentic-desktop/feature-sdk";

function useStore<T>(store: ReadableStore<T>): T {
	return useSyncExternalStore(store.subscribe, store.peek, store.peek);
}
```

**Use when:** other features (or many of your own components) need to observe a value over time — counts, selection, status.
**Don't use for:** persistence (state is in-memory, renderer-side) or high-frequency data (every `set` notifies synchronously).

### `sdk.plugins` — capabilities (cross-feature APIs)

The request/response counterpart to events: one feature exposes a named API object, others look it up by feature ID. This is the **only** sanctioned way to call another feature.

```ts
// The todos feature exposes a service
sdk.plugins.expose("todoService", {
	addTodo: (title: string) => sdk.invoke("create", { title }),
});

// Another feature consumes it — always defensively, the feature may not be loaded
interface TodoCapabilities {
	todoService: { addTodo(title: string): Promise<unknown> };
}
const caps = sdk.plugins.get<TodoCapabilities>("todos"); // type is ASSERTED, not validated
await caps?.todoService.addTodo("From calendar");
```

**Use when:** feature B needs to actively call feature A (not just hear about its events).
**Don't use for:** your own feature's backend (use `invoke`). Never import another feature's source — `plugins.get` returning `null` is the contract that keeps features independently loadable.

### `sdk.contribute(zone, options)` — UI in shell zones

Register a React component into a named shell zone (status bar, dashboard, ...). The shell decides where and how zones render. Returns an unregister handle for conditional UI; contributions are also cleaned up when the SDK instance is destroyed.

```ts
const remove = sdk.contribute("statusbar", {
	component: TodoStatusBadge,
	label: "Todos",
	priority: 10, // higher renders first
});
// later, e.g. when the feature's "compact mode" turns on:
remove();
```

**Use when:** the feature wants presence in shell-owned chrome without owning a route.
**Don't use for:** your feature's main view — that's a route file in `apps/web/src/routes/`.

### `sdk.commands` — command palette entries

```ts
sdk.commands.register({
	id: "add", // becomes "todos.add"
	label: "Add todo",
	handler: () => openAddDialog(),
});
```

### Shell delegates: `sdk.theme`, `sdk.shell`, `sdk.notifications`, `sdk.fs`

Shell-provided services, identical API in every migration stage:

```ts
sdk.theme.peek(); // "dark" | "light"
const unsub = sdk.theme.subscribe((t) => applyTheme(t)); // fires immediately
await sdk.shell.openExternal("https://anaconda.com");
await sdk.shell.copyText("hello");
```

`sdk.notifications` is **not wired yet**: calls are safe but report absence in a result envelope — check it when delivery matters. This is the SDK's capability-detection pattern: detect the capability, never branch on the platform.

```ts
const result = sdk.notifications.show({ type: "info", title: "Done", message: "Todo added" });
if (!result.delivered) showInlineBanner(); // graceful fallback
```

`sdk.fs` is **not wired yet** and rejects — don't ship code paths that rely on it.

### Deferred: `sdk.tools`, `sdk.intents`, `sdk.navigate`, `sdk.dispatch`

Placeholders for the full plugin system. They throw. They exist so the interface shape doesn't change when they arrive.

## Errors: `FeatureError`

Throw `FeatureError` from handlers for **expected** failures. The shell translates it across the IPC boundary, so the message and code reach the renderer intact. Plain `Error`s are scrubbed to a generic string by the IPC layer (they may carry secrets).

```ts
import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk/main";

throw new FeatureError("Todo not found.", "NOT_FOUND");
// codes: "VALIDATION" | "NOT_FOUND" | "BUSINESS" (default)
```

Invalid input produces `FeatureError("VALIDATION")` automatically — you never validate input manually inside a handler. Invalid handler output is an internal error: its schema details are retained as the server-side cause and scrubbed from the IPC response.

## Lifecycle

| Action                          | Scope                                                                   | Who calls it                           |
| ------------------------------- | ----------------------------------------------------------------------- | -------------------------------------- |
| `sdk.onDispose(fn)`             | Runs when _this SDK instance_ is destroyed                              | Feature code                           |
| `sdk.destroy()`                 | Cleans up registrations made _through this instance_ only               | Shell (never feature/component code)   |
| `mainSdk.onDispose(fn)`         | Runs when the feature's backend is torn down (shutdown, unload)         | Feature code registers; shell triggers |
| `teardownFeature(id, services)` | Removes _everything_ for a feature: events, state, UI, backend handlers | Shell only (plugin unload)             |

Rule of thumb for feature authors: register cleanup with `onDispose`, never call `destroy()` or `teardownFeature` yourself, and never tie SDK lifetime to a component's lifetime — `useSdk` hands you a shared instance.

## Testing

Use `@anaconda-agentic-desktop/testing` — never hand-roll SDK fakes:

```ts
import { createFakeSdk, createFakeMainSdk } from "@anaconda-agentic-desktop/testing";

// Renderer tests: real in-memory event bus / state / router, fake shell delegates
const sdk = createFakeSdk({
	featureId: "todos",
	channels: todosChannels,
	handlers: { list: () => [{ id: "1", title: "test", completed: false }] },
});
await sdk.invoke("list"); // served by the fake's real router
sdk.services.eventBus.emit("other.thing", {}); // drive cross-feature scenarios

// Backend registration tests — mainRegister supplies the channel map.
const mainSdk = createFakeMainSdk({ featureId: "todos" });
mainRegister(mainSdk);
await mainSdk.invoke("create", { title: "x" }); // validates input and output like the real router
```

## Shell wiring (internals)

Everything below is shell infrastructure. Feature code has no reason to import these.

| Export                 | Role                                                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `EventBus`             | Namespaced pub/sub backing `sdk.events`. Snapshot iteration; throwing handlers are isolated.                                                                                                                       |
| `StateBroker`          | Observable stores backing `sdk.state`. Lazy placeholder resolution; subscribers survive re-registration.                                                                                                           |
| `CapabilityRegistry`   | Named API objects backing `sdk.plugins`.                                                                                                                                                                           |
| `ContributionRegistry` | Zone → contribution mapping backing `sdk.contribute`; `onChange` feeds shell re-renders.                                                                                                                           |
| `CommandRegistry`      | Palette entries backing `sdk.commands`; ids auto-namespaced `featureId.commandId`.                                                                                                                                 |
| `FeatureRouter`        | `channel → handler` routing behind `sdk.invoke` and `mainSdk.channels`. Constructor takes an optional `fallback` transport — the renderer injects the IPC bridge here in Electron mode; local handlers always win. |
| `createSdk`            | Builds a feature-scoped `SDK` facade over the services; tracks instance registrations for `destroy()`.                                                                                                             |
| `teardownFeature`      | Full feature teardown across all services (plugin unload).                                                                                                                                                         |

Where the wiring lives:

- **Electron main:** `apps/desktop/src/main/features/registry/feature-registry.ts` — one `FeatureRouter`, booted from the FEATURES array; `feature:invoke` IPC handler; `FeatureError → BusinessError` translation.
- **Renderer:** `apps/web/src/platform/sdk/SdkProvider.tsx` — `createFeatureSystem()` builds all services once, caches one SDK per feature, and boots features in-process in browser mode. Only `browserRegister` boots there (no `mainRegister` fallback — it may use Node APIs); Node-free features opt in with `browserRegister: register`, others are skipped with a warning.
