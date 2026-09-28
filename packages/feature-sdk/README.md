# @kilo-desktop/feature-sdk

The shim SDK that features program against today, shaped like the future plugin SDK. Code written against this package migrates to a plugin (and later to an external repo) via filesystem moves — no rewrites.

- **Feature authors:** read [Quick start](#quick-start) and [SDK primitives](#sdk-primitives). You only ever touch `SDK`, `MainSdk`, and `FeatureError`.
- **Shell authors:** read [Shell wiring](#shell-wiring-internals). The service classes (`EventBus`, `StateBroker`, ...) are shell infrastructure — feature code never constructs them.

## Quick start

A feature ships two halves that communicate only through the SDK. In `apps/` (features awaiting migration) they live in three locations; a plugin folds the same split into one package:

```
# Feature in apps/                              # Plugin in plugins/<id>/
apps/desktop/src/main/features/<id>/            src/main/       # backend (mainRegister)
apps/web/src/features/<id>/                     src/web/        # frontend (useSdk)
packages/contracts/src/features/<id>.ts         src/contracts/  # Zod schemas shared by both
```

**Backend** — register handlers in `mainRegister`, declare it in the FEATURES array (or `plugin.json` + `BUNDLED_PLUGINS` for a plugin). The example paths below are the todos plugin:

```ts
// plugins/todos/src/contracts/schemas.ts
import { z } from "zod";
import { defineContract, defineMethod, type InferContract } from "@kilo-desktop/feature-sdk";

export const todoSchema = z.object({
	id: z.string(),
	title: z.string(),
	completed: z.boolean(),
});

export const todosContract = defineContract({
	list: { input: z.undefined(), output: z.array(todoSchema) },
	add: { input: z.object({ title: z.string().trim().min(1).max(120) }), output: todoSchema },
	toggle: { input: z.object({ id: z.string().min(1) }), output: todoSchema },
});

export type TodoService = InferContract<typeof todosContract>;
```

```ts
// plugins/todos/src/main/index.ts
import type { MainSdk } from "@kilo-desktop/feature-sdk/main";
import { todosContract } from "../contracts/schemas.js";
import { TodoService } from "./TodoService.js";

export function mainRegister(mainSdk: MainSdk) {
	const service = new TodoService();

	// Input + output validated at the routing boundary from the contract.
	// handleAll is exhaustive: forgetting a channel is a compile error.
	mainSdk.channels(todosContract).handleAll({
		list: () => service.list(),
		add: (input) => service.add(input.title),
		toggle: (input) => service.toggle(input.id),
	});

	mainSdk.onDispose(() => service.close()); // runs on shutdown / feature unload
}
```

**Frontend** — use `useSdk<ServiceType>` for a typed proxy client:

```tsx
// plugins/todos/src/web/TodoList.tsx
import { useQuery } from "@tanstack/react-query";
import { useSdk } from "@kilo-desktop/sdk-react";
import type { TodoService } from "../contracts/schemas.js";

export function TodoList() {
	const { client } = useSdk<TodoService>("todos");
	const todos = useQuery({
		queryKey: ["todos", "list"],
		queryFn: () => client.list(), // Promise<Todo[]>
	});
	// ...render
}
```

`useSdk` returns a **shared, cached instance per feature** — it is never destroyed on component unmount. Teardown is shell-owned and only happens on feature/plugin unload.

## SDK primitives

### `sdk.invoke(channel, args?)` — call your own backend

Transport-agnostic request/response to a handler this feature registered in `mainRegister`. In Electron it crosses IPC through the generic `feature:invoke` channel; in standalone browser mode it calls the handler in-process. Same code either way.

The base `SDK.invoke` is untyped (shell transport). Features define a **contract** with `defineContract` in the contracts package and use `useSdk<ServiceType>` for type-safe method-style access via `sdk.client`:

```ts
const { client } = useSdk<TodoService>("todos");
const todo = await client.add({ title: "Buy milk" }); // typed; parsed by the router
```

Schemas may transform values. The typed SDK accepts the input schema's raw
input, handlers receive its parsed output, handlers return the output schema's
raw input, and callers receive its parsed output. Parsing happens once in the
feature router, in both Electron and browser mode.

**Use when:** the renderer needs data or side effects from this feature's own backend (DB reads/writes, Node-only work).
**Don't use for:** calling _another_ feature's backend — that's what capabilities (`sdk.plugins`) are for. `sdk.invoke` is scoped to your own `featureId` by construction.

Register handlers with the same contract so input and output are validated on the main side too. Prefer `mainSdk.channels(todosContract).handleAll({ ... })` — it requires a handler for every channel in the map, so a newly added channel cannot be forgotten. `handle(channel, handler)` remains for registering channels one at a time.

### `sdk.ports` / `mainSdk.ports` — transferable streams

Use a feature-scoped port for sustained, bidirectional traffic that does not fit
request/response `invoke`, such as a native runtime byte stream. The renderer
gets a DOM `MessagePort`; the main feature receives an Electron-free structural
port. The shell transfers the channel through its isolated preload without
exposing `ipcRenderer`, a listening socket, or an underlying native endpoint.

```ts
// mainRegister
mainSdk.ports.handle("runtime", z.object({ notebookId: z.string() }), (port, args) => {
	attachAuthorizedRuntime(port, args);
});

// renderer
const port = sdk.ports.open<MessagePort>("runtime", { notebookId });
iframe.contentWindow?.postMessage({ type: "connect" }, iframeOrigin, [port]);
```

The routing envelope and feature-declared argument schema are validated and
accepted only from the trusted top-level renderer. The channel is feature-scoped
by the SDK. A rejected, unknown, or failed main handler causes the shell to close
the transferred port. An accepted port is also closed automatically when the
feature unloads.
This primitive is Electron-only for now; browser mode throws an explicit
unsupported-host error.

**Use when:** a feature needs transferable, long-lived transport with flow
control. **Don't use for:** ordinary commands, dialogs, or CRUD calls—keep those
on typed `sdk.client`/`sdk.invoke` methods.

### `mainSdk.logger` / `mainSdk.net.fetch` — host process services

Main-process features use these delegates instead of importing Electron or shell implementation modules. The Electron host supplies a feature-scoped `electron-log` logger and a fetch implementation backed by `net.fetch`; browser mode uses runtime defaults, and tests can inject structural fakes through `createFakeMainSdk`.

```ts
mainSdk.logger.info("server ready", { version });
const response = await mainSdk.net.fetch("https://example.test/health");
```

### `sdk.events` / `mainSdk.events` — fire-and-forget pub/sub

Cross-feature and cross-process notifications. `emit` is auto-prefixed with your feature ID; `on` subscribes to fully-qualified names, so you can listen to any feature's events from the renderer or main process.

```ts
// In the todos feature — emits "todos.created"
sdk.events.emit("created", { id: todo.id });

// In another feature — reacts to it
const unsub = sdk.events.on("todos.created", (payload) => {
	refreshDashboard();
});

// The same API is available in mainRegister.
mainSdk.events.emit("indexed", { count: 3 }); // emits "todos.indexed"
mainSdk.events.on("workspaces.workspace-updated", (payload) => refresh(payload));
```

**Use when:** something happened and zero-or-more other features may care. Emitter must not depend on who is listening.
**Don't use for:** request/response (use `invoke` or capabilities), or state another feature needs to _read at any time_ (use `sdk.state`). Events are not replayed — a subscriber that attaches late missed earlier emissions.

Delivery is fire-and-forget, at-most-once, and has no replay. Payloads must be structured-cloneable; invalid payloads throw at the SDK boundary in both browser and Electron mode. Electron relays through the shell-owned `feature:event` bridge, while browser-mode `SDK` and `MainSdk` share one in-process bus. Origin events are delivered locally before relay, and inbound bridge delivery bypasses the outbound path to prevent echo loops.

Subscriptions made through an SDK instance or `MainSdk` are cleaned up automatically when the feature is destroyed. Handlers that throw are isolated (logged, siblings still run).

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
import type { ReadableStore } from "@kilo-desktop/feature-sdk";

function useStore<T>(store: ReadableStore<T>): T {
	return useSyncExternalStore(store.subscribe, store.peek, store.peek);
}
```

**Use when:** other features (or many of your own components) need to observe a value over time — counts, selection, status.
**Don't use for:** persistence (state is in-memory, renderer-side) or high-frequency data (every `set` notifies synchronously).

### `sdk.plugins` / `mainSdk.plugins` — capabilities (cross-feature APIs)

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

// Main features use the same lazy, graceful-null capability contract.
mainSdk.plugins.expose("workspaceService", { get: (id: string) => findWorkspace(id) });
const workspaces = mainSdk.plugins.get<WorkspaceCapabilities>("workspaces");
const workspace = workspaces?.workspaceService.get(id);
```

**Use when:** feature B needs to actively call feature A (not just hear about its events).
**Don't use for:** your own feature's backend (use `invoke`). Never import another feature's source — `plugins.get` returning `null` is the contract that keeps features independently loadable.

### `sdk.contribute(zone, options)` — UI zones

Register a React component into a named zone. Shell zones have exported constants; plugin-owned hosts declare zones in their manifests and consumers target the qualified `<plugin-id>/<zone-id>` name through `contributes.zones`. Contributions have stable IDs, are priority-ordered (higher first), and return an unregister handle; they are also cleaned up when the SDK instance is destroyed.

`sdk.contribute` is the **imperative, page-scoped** path — the contribution exists only while the calling component is mounted, so it is right for _conditional_ UI that appears in certain app states:

```ts
import { STATUS_BAR_ZONE } from "@kilo-desktop/feature-sdk";

// Only while this component is mounted:
const remove = sdk.contribute(STATUS_BAR_ZONE, {
	id: "sync-status",
	component: SyncingBadge,
	label: "Syncing",
	priority: 10,
});
remove(); // e.g. when syncing finishes
```

For a contribution whose registration should last for the plugin lifetime, declare it in `plugin.json` `contributes.zones`. Shell zones render their components directly; plugin-owned zones may interpret the same entries as richer definitions:

```jsonc
"contributes": {
  "zones": [{ "zone": "status-bar", "component": "TodosStatusBarItem" }]
}
```

A plugin declares an owned zone at the manifest root as `{ "zones": [{ "id": "detail-panel" }] }`; contributors then target `"<plugin-id>/detail-panel"` through the same `contributes.zones` array.

For lifecycle behavior that must remain mounted across every route—capability
exposure, shared observable state, global dialogs, or event listeners—declare a
provider exported by the plugin's web entry:

```jsonc
"contributes": {
  "providers": [{ "component": "WorkspacesFeatureProvider", "priority": 10 }]
}
```

The shell composes providers inside its SDK and query providers. Higher-priority
providers wrap lower-priority providers; equal priorities keep plugin registry order.

**Use routes, not contributions, for the feature's main view** — declare them in `plugin.json` `contributes.routes` (the host mounts them; plugins never touch the router).

**Settings sections** are a separate contribution point, not a zone. Declare them in `plugin.json` `contributes.settings`; the shell lists them on `/settings` and mounts one section at a time:

```jsonc
"contributes": {
  "settings": [{ "id": "todos", "title": "Todos", "component": "TodosSettings", "category": "General" }]
}
```

Optional `category` groups the section in the settings sidebar and defaults to `General`. Optional `featureFlag` hides the nav entry (same semantics as `contributes.nav`). There is no `sdk.contributeSettings` — settings are declarative only.

**Deep links** are OS URLs on the app scheme. Declare them in `plugin.json` `contributes.deepLinks`; the shell maps `kilo-desktop://{host}/{id}` to in-app navigation:

```jsonc
"contributes": {
  "deepLinks": [
    { "host": "model-catalog", "to": "/settings/local-model-server", "searchParam": "catalogModel" }
  ]
}
```

`host` is kebab-case and unique across plugins (`app` is reserved). `{id}` is the single path segment and is written to `searchParam` on `to`. There is no imperative `sdk.contributeDeepLink`.

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

### `sdk.navigate` + `sdk.location` — shell navigation delegate

The router is internal to the shell (Decision #19) — plugins never import it. Plugin routes are mounted under the `/plugins/*` namespace so shell and plugin routes cannot collide; the loader prefixes manifest paths for you. Navigate by the full resolved path (or by `PluginPageProps.path` the shell passes into your page), and observe the current location like any other SDK observable:

```ts
sdk.navigate("/plugins/todos", { search: { filter: "open" } });

sdk.location.peek(); // { path: "/plugins/todos", search: { filter: "open" } }
const unsub = sdk.location.subscribe((loc) => setBreadcrumb(loc.path)); // fires immediately
```

Route pages mounted from `plugin.json` also receive `PluginPageProps` (`path`, `search`) as props.

### Deferred: `sdk.tools`, `sdk.intents`, `sdk.dispatch`

Placeholders for the full plugin system. They throw. They exist so the interface shape doesn't change when they arrive.

## Errors: `FeatureError`

Throw `FeatureError` from handlers for **expected** failures. The shell translates it across the IPC boundary, so the message and code reach the renderer intact. Plain `Error`s are scrubbed to a generic string by the IPC layer (they may carry secrets).

```ts
import { FeatureError } from "@kilo-desktop/feature-sdk/main";

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

Use `@kilo-desktop/testing` — never hand-roll SDK fakes:

```ts
import { vi } from "vitest";
import { createFakeSdk, createFakeMainSdk, createLinkedFakeSdkPair } from "@kilo-desktop/testing";

// Renderer tests: real in-memory event bus / state / router, fake shell delegates
const sdk = createFakeSdk({
	featureId: "todos",
	channels: todosContract,
	handlers: { list: () => [{ id: "1", title: "test", completed: false }] },
});
await sdk.invoke("list"); // served by the fake's real router
sdk.services.featureRouter.eventBus.emit("other.thing", {}); // drive cross-feature scenarios

// Backend registration tests — mainRegister supplies the channel map.
const mainSdk = createFakeMainSdk({
	featureId: "todos",
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
	fetch: vi.fn(),
});
mainRegister(mainSdk);
await mainSdk.invoke("create", { title: "x" }); // validates input and output like the real router
mainSdk.dispose(); // runs onDispose callbacks + clears handlers, like shell teardown

// Cross-boundary unit tests — one real bus and capability registry.
const { rendererSdk, mainSdk: linkedMainSdk } = createLinkedFakeSdkPair({ featureId: "todos" });
linkedMainSdk.events.emit("changed", {}); // rendererSdk.events.on("todos.changed") receives it
```

## Shell wiring (internals)

Everything below is shell infrastructure. Feature code has no reason to import these.

| Export                 | Role                                                                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EventBus`             | Namespaced pub/sub shared by renderer SDKs or main SDKs; the shell bridges process-local buses without echoing.                                                                                                |
| `StateBroker`          | Observable stores backing `sdk.state`. Lazy placeholder resolution; subscribers survive re-registration.                                                                                                       |
| `CapabilityRegistry`   | Named API objects backing `sdk.plugins`.                                                                                                                                                                       |
| `ContributionRegistry` | Zone → contribution mapping backing `sdk.contribute`; `onChange` feeds shell re-renders.                                                                                                                       |
| `CommandRegistry`      | Palette entries backing `sdk.commands`; ids auto-namespaced `featureId.commandId`.                                                                                                                             |
| `FeatureRouter`        | Canonical process-local owner of request handlers, port handlers, the event bus, and capabilities. Its optional invoke fallback routes renderer calls through IPC in Electron mode; local handlers always win. |
| `createSdk`            | Builds a feature-scoped `SDK` facade over the services; tracks instance registrations for `destroy()`.                                                                                                         |
| `teardownFeature`      | Full feature teardown across all services (plugin unload).                                                                                                                                                     |

Where the wiring lives:

- **Electron main:** `apps/desktop/src/main/features/registry/feature-registry.ts` — one `FeatureRouter` owns the main-process `EventBus` and `CapabilityRegistry`, boots the FEATURES array, and backs `feature:invoke`, `feature:event`, and the transferred `feature:port` bridge; `FeatureError → BusinessError` translation stays at the IPC boundary.
- **Renderer:** `packages/sdk-react/src/SdkProvider.tsx` — `createFeatureSystem()` builds all services once, caches one SDK per feature, and accepts one cohesive Electron transport for invoke + events + ports. In browser mode the transport is omitted, so `browserRegister` MainSdk instances necessarily share the router-owned event bus and capability registry. `FeatureSystem.dispose()` detaches the host transport and tears down the runtime.
