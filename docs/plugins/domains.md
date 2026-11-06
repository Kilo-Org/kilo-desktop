# Domain objects

A domain object is a named object with **state**, **methods** and
**events** — `kilo.sessions/session`, `kilo.agent/server`,
`example.hello/greetings`. Exactly one plugin provides it, in its **home**
process. Every other process and window gets a proxy: state arrives as live
snapshots, method calls are forwarded, events are broadcast. A pop-out
window therefore sees the same objects as the main window.

Domain objects are how plugins share data and actions. One action is often
exposed three ways that call the same function: a domain method for other
plugins' code, a [command](./commands-and-keys.md) for people and a
[tool](./chat-and-tools.md) for the agent.

## Defining one

Declare it in `plugin.json` and define it in `src/contracts`:

```jsonc
"domains": [{ "id": "greetings", "home": "main", "description": "The greetings said so far." }]
```

```ts
import { defineDomain, method } from "@kilo-desktop/kernel";

export const Greetings = defineDomain({
	id: "example.hello/greetings",
	home: "main", // where the real state lives; "renderer" for per-window state
	state: z.object({ count: z.number().int(), last: z.string().nullable() }),
	methods: {
		greet: method(z.object({ name: z.string().trim().min(1) }), z.string()),
		reset: method(z.undefined(), z.undefined()),
	},
	events: {
		greeted: z.object({ name: z.string() }),
	},
});

export const HELLO_DEFINITIONS: PluginDefinitions = { domains: [Greetings] };
```

- **State** is one zod schema. Keep it serializable and small enough to send
  on every change; large or streaming data belongs behind a method or a
  port.
- **Methods** take one input and return one output, both validated. Use
  `z.undefined()` for "nothing".
- **Events** belong to the object: only the provider emits them, anyone can
  listen. They are fire-and-forget, at most once, with no replay — anything
  a late subscriber must know belongs in state too.
- **Home.** `main` for anything shared (almost everything). `renderer` for
  per-window state such as a composer draft or the window's open session;
  each window then has its own.
- Optional: `lookup(state, id)` resolves an `ObjectRef` id against the state
  (for collections), `permission` makes non-owners need a host
  permission (used by the kernel's own objects), and `homeCallersOnly`
  refuses every call from another process (secrets that must never reach a
  window).

## Providing it

In the home process, at activation:

```ts
const greetings = sdk.domains.provide(Greetings, {
	initialState: { count: 0, last: null },
	methods: {
		greet: ({ name }, caller) => {
			greetings.setState({ count: greetings.state.count + 1, last: name });
			greetings.emit("greeted", { name });
			return `Hello, ${name}!`;
		},
		reset: () => greetings.setState({ count: 0, last: null }),
	},
});
```

The provider handle has `state`, `setState(next)`, `update(fn)` and
`emit(event, payload)`. The object is withdrawn when your plugin
deactivates. Persist what must survive a restart in your own storage
(`mainHost(sdk).storage.kv`), as the [example](../../examples/hello-plugin)
does.

### Callers and permissions

Each method gets a second argument, `caller`, with the calling plugin's id
(`kernel` for the kernel). Use it for methods only your own plugin may call:

```ts
setSecret: (input, caller) => {
	if (caller.pluginId !== HELLO_PLUGIN_ID) {
		throw new KernelError("PERMISSION_DENIED", "Only example.hello sets its secret.");
	}
	// …
},
```

The check runs in the home process, where the caller's identity is known.
`caller.process` says where the call came from (`main` or `renderer`).

How far to trust `caller.pluginId` depends on that process. From `main` it
is exact. From a window it is advisory: a window's plugins share one
JavaScript context, so code in a window can claim to be any plugin that runs
there. Main still rejects a window claiming main's kernel (a window's own
`kernel` only gets the `windows` and `plugins` host permissions), a plugin
with no web entry, or a plugin that is turned off. So gate on the plugin id
to keep honest plugins apart, and on `caller.process === "main"` (or
`homeCallersOnly`) for anything a window must never get, such as secrets.
Throw `KernelError` for expected failures (`VALIDATION`, `NOT_FOUND`,
`PERMISSION_DENIED`, `UNAVAILABLE`, `CONFLICT`, `TIMEOUT`, `BUSINESS`): the
code and message reach the caller in any process.

## Using it

From any plugin, any process:

```ts
const greetings = sdk.domains.get(Greetings); // null when nobody provides it
if (greetings) {
	await greetings.methods.greet({ name: "Ada" });
	greetings.getState().count;
	greetings.subscribe((state) => render(state));
	greetings.on("greeted", ({ name }) => console.log(name));
}
```

Subscriptions made through `sdk` are removed when your plugin deactivates.
To bind to a provider that may appear late or go away, use
`sdk.domains.track(Greetings, { added(handle) {…}, removed() {…} })`;
`added` runs at once if the provider already exists. Subscribe inside
`added`: a provider that is withdrawn and provided again starts with no
listeners.

Listeners run in the order they subscribed, and each one is isolated: one
that throws is logged against your plugin and skipped, without affecting
other listeners, the broadcast to windows or the provider's `emit`. Events
from a `main`-home object reach every window, so filter in the listener
rather than expecting only the events you care about.

Add the domain to `requires` in your manifest (`"optional"` in nearly all
cases) so activation is ordered after its owner, and import its definition
from the owner's `./contracts`.

## From React

`@kilo-desktop/kernel/web` has hooks that follow providers and state:

```tsx
import { useDomain, useDomainState } from "@kilo-desktop/kernel/web";

const selectCount = (state: GreetingsState) => state.count; // stable selector

export function GreetingCount() {
	const greetings = useDomain(Greetings); // null while unavailable
	const count = useDomainState(Greetings, selectCount); // undefined while unavailable
	if (!greetings || count === undefined) return <p>Greetings aren't available.</p>;
	return (
		<Button onClick={() => void greetings.methods.greet({ name: "world" }).catch(() => {})}>
			Greeted {count} times
		</Button>
	);
}
```

- Keep selectors stable (module level or `useCallback`) and return
  primitives or existing objects, so components re-render only on change.
- Always render something sensible when the domain is unavailable: the
  providing plugin may be removed.
- Don't use React context to share data with other plugins; share it
  through a domain object.

## Object references

To point at one object across plugins — a drag, an opener, a mention — pass
a typed reference instead of an internal id:

```ts
import { ref, isRef } from "@kilo-desktop/kernel";

const sessionRef = ref(Sessions, sessionId); // { type: "kilo.sessions/session", id }
if (isRef(Sessions, value)) open(value.id);
```

Drag and drop uses them directly: `useDragSource([sessionRef])` on the
source, `useDropTarget({ accepts: [Sessions], onDrop: (refs) => … })` on the
target (both from `@kilo-desktop/kernel/web`).

## Kernel domain objects

The kernel provides `kernel/app` (phase, version, quit), `kernel/plugins`
(states, issues, and turning plugins on or off from the next launch —
`plugins` permission),
`kernel/services` (status, `ensureStarted`, `restart`), `kernel/windows`,
`kernel/system` (suspend / resume, online), `kernel/keybindings` and the
permissioned host primitives listed in the
[README](./README.md#permissions). Import them from `@kilo-desktop/kernel`
(`KernelApp`, `KernelWindows`, …).
