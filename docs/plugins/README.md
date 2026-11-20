# Writing a plugin

Every feature of Kilo Desktop is a plugin, the shell included. Bundled
plugins use exactly the API described here — nothing is private to them.
For the design and its reasons, read
[plugin-architecture.md](../plugin-architecture.md); these pages are the
how-to.

| Page                                                             | What it covers                                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| This page                                                        | What a plugin is, the package layout, the manifest, lifecycle                                |
| [extension-points.md](./extension-points.md)                     | Defining and contributing to points                                                          |
| [domain-objects.md](./domain-objects.md)                         | Domain objects, object types, identity, flags and telemetry                                  |
| [commands-and-keys.md](./commands-and-keys.md)                   | Commands, keybindings, `when` and context keys                                               |
| [panes-and-openers.md](./panes-and-openers.md)                   | Pane kinds, openers, close guards, pop-outs                                                  |
| [chat-and-tools.md](./chat-and-tools.md)                         | Agent tools, tool renderers, composer actions and mentions                                   |
| [testing.md](./testing.md)                                       | Test hosts, robustness rules, removability and isolation checks                              |
| [schema.md](./schema.md)                                         | Generated catalog: every plugin, extension point, domain object, object type and context key |
| [examples/hello-plugin](../../examples/hello-plugin)             | A small plugin to copy                                                                       |
| [examples/right-panel-plugin](../../examples/right-panel-plugin) | Panels in the shell's right sidebar, opened from its rail                                    |

## Before you write a plugin

Design the feature first, in terms of the building blocks:

- Is it a new plugin, or part of an existing product area?
- Which domain objects own its state?
- Which existing extension points does it contribute to?
- Does it need an extension point of its own?
- Which commands, context keys, object types and services does it add?

[plugin-architecture.md](../plugin-architecture.md#designing-a-feature)
walks through these questions, and the
[`design-feature`](../../.agents/skills/design-feature/SKILL.md) skill
applies them. Check [schema.md](./schema.md) for what already exists.

## What a plugin is

A plugin is a workspace package with a `plugin.json` manifest. It delivers
three kinds of things:

- **Contributions** to extension points: a settings section, a command, a
  pane kind, an agent tool.
- **Extension points** of its own, for other plugins to contribute to.
- **Domain objects**: named objects with state, methods and events
  (`kilo.work-sessions/work-sessions`), provided in one process and usable
  from any.

Plugins never import each other's code. They meet only through the kernel:
the points and domain objects declared in manifests and defined in each
plugin's `./contracts` export, which is the one thing another plugin may
import (`pnpm lint` checks this).

To see this domain model in the running app, turn on the `developer` flag
and open Settings → Developer → Diagnostics: its Extension points, Domain
objects, Object types, Context keys and Flags tabs list every one, and any id
there drills into its definition (kind, metadata, state, methods and events as
TypeScript types), what contributes to it and whether each contribution is
live, who requires it, and — for keys and flags — their current value and the
conditions that read them.

## Package layout

```
plugins/my-plugin/                (examples/hello-plugin for the example)
├── package.json      exports ./plugin.json, ./contracts, ./main, ./web (and ./testing if it hosts points)
├── plugin.json       the manifest
├── tsconfig.json
├── vitest.config.ts
├── resources/        files the plugin ships (binaries, frames); found with mainHost(sdk).assets
└── src/
    ├── contracts/    points, domain objects and types other plugins may import; *_DEFINITIONS
    ├── main/         main-process entry (Node is fine here)
    ├── web/          renderer entry, run in every window (DOM, React)
    └── test/         test setup
```

- Ids are qualified by the plugin: `my.plugin/thing` for points, domain
  objects, commands and context keys. The manifest uses local names
  (`thing`); the kernel adds the prefix. The `kilo.` publisher is reserved
  for bundled plugins.
- `package.json` declares every import (`pnpm check:plugin-isolation` builds
  each plugin outside the monorepo to prove it). `react`, `react-dom`,
  `@kilo-desktop/ui` and `zod` are shared by the app: declare `react`,
  `react-dom` and `@kilo-desktop/ui` as `peerDependencies`.
- UI uses `@kilo-desktop/ui` components; interactive elements get a stable
  `data-qa-id`.
- Plugins never import Electron or `apps/*`. Host features come through
  `kernel/*` domain objects and `mainHost(sdk)`.

## The manifest (`plugin.json`, v1)

The kernel reads manifests before running any plugin code, so it can
validate, order and list everything up front. Every field:

```jsonc
{
	"manifestVersion": 1, // required, always 1
	"id": "acme.todos", // required: dotted publisher.name
	"displayName": "Todos", // required
	"version": "1.0.0", // required: semver
	"description": "Todo lists for sessions.",
	"engines": { "kilo-desktop": "^1.0" }, // app versions it supports
	"main": "./src/main/index.ts", // informational; bundled entries are wired by the plugin list
	"web": "./src/web/index.ts",

	// Runs the whole plugin only while this holds, typically a feature flag
	// (see Lifecycle). Omit to always run.
	"when": { "all": ["kernel/flag:acme-todos"] },

	// Points and domain objects it uses, by qualified id. "optional" orders
	// activation after the owner; "required" leaves this plugin unresolved
	// (not activated) when the owner isn't active.
	"requires": {
		"kilo.shell/settings-section": "optional",
		"kilo.work-sessions/work-sessions": "optional",
	},

	// What it may use from the host (see Permissions below).
	"permissions": {
		"host": ["clipboard", "notifications"],
		"protocols": ["acme-todos"],
		"embeddedHosts": ["todo-frame"],
	},

	// Conditions it owns, for `when` (see commands-and-keys.md).
	"contextKeys": [
		{ "id": "hasTodos", "scope": "global", "description": "True while any todo is open." },
	],

	// Points it offers (see extension-points.md); defined in its contracts.
	"extensionPoints": [
		{ "id": "todo-source", "kind": "additive", "description": "Where todos come from." },
	],

	// Domain objects it provides (see domain-objects.md); defined in its contracts.
	// A collection names the object type it resolves.
	"domainObjects": [
		{
			"id": "todos",
			"home": "main",
			"description": "The todo lists.",
			"objectType": "acme.todos/todo",
		},
	],

	// Object types other plugins point at with an ObjectRef; defined in its contracts.
	"objectTypes": [{ "id": "todo", "description": "One todo." }],

	// Static contributions, by qualified point id. Each entry has a local `id`,
	// optional `priority` (higher first) and `when`, plus the point's own fields.
	"contributes": {
		"extensions": {
			// Under a Settings category: kilo.shell's general or ai, or any other
			// `kilo.shell/settings-category` contribution (yours, or kilo.developer's
			// developer). Defaults to General.
			"kilo.shell/settings-section": [
				{ "id": "todos", "title": "Todos", "category": "kilo.shell/general", "priority": 50 },
			],
			"kernel/command": [{ "id": "new", "title": "New todo", "keybinding": "Mod+Shift+T" }],
			"kernel/flag": [{ "id": "acme-todos", "description": "Todo lists.", "default": false }],
			"kernel/telemetry-event": [{ "id": "todo-created", "name": "Todo Created" }],
		},
	},
}
```

Entries are checked against the point's metadata schema at discovery. An
entry for a point whose owner isn't installed is ignored with a warning, so
optional integrations never break a plugin. An entry whose point is
unknown on an installed owner is an error.

## Lifecycle

Each plugin has up to two entries: `main` (Electron main, one instance) and
`web` (every window, including pop-outs). Each is a `definePlugin`:

```ts
import { definePlugin, mainHost } from "@kilo-desktop/kernel";
import { Todos } from "../contracts";

export const todosMainEntry = definePlugin({
	activate(sdk) {
		const store = mainHost(sdk).storage.kv({ namespace: "todos", defaults: { items: [] } });
		sdk.domainObjects.provide(Todos, {
			initialState: store.snapshot(),
			methods: {/* … */},
		});
	},
	// deactivate() is optional: everything registered through `sdk` is removed for you.
});
```

1. **Discover.** The kernel reads every manifest and orders plugins from
   `requires`. No plugin code runs.
2. **Activate (main).** `activate(sdk)` runs in dependency order. Keep it
   fast: it is budgeted (a warning above 200 ms, failure and rollback at
   10 s). Provide domain objects, bind contributions, subscribe to events.
3. **Window shown.** Each window activates the web entries.
4. **Services start.** Slow work — child processes, network, migrations —
   is a `kernel/service` (daemon or task) the kernel starts after the
   window shows, restarts on failure and stops at quit. Use
   `startOn: "first-use"` for anything rarely needed.
5. **Stop.** Services stop in reverse order, then plugins deactivate. All
   registrations made through `sdk` are disposed automatically; add your own
   cleanup with `sdk.onDispose(fn)`.

Rules:

- Never assume another plugin has started. Read a domain object's state, or
  `sdk.domainObjects.track(Domain, { added, removed })` to follow a provider that
  appears late or goes away.
- `sdk.domainObjects.get(Domain)` returns `null` when nobody provides it. Handle
  that: every plugin must be removable without crashing the app.
- Expected failures throw `KernelError(code, message)`. Its code and message
  cross processes; any other error arrives as a generic "The operation
  failed."
- A plugin with a manifest `when` is `inactive` (not activated, no
  contributions) while it doesn't hold, and starts or stops live as it
  changes, as when its flag flips. Plugins that use its items should
  `require` them `optional`ly.
- Run code at app milestones by reading `kernel/app`'s `phase` (`started`,
  `ready`, `stopping`…) and listening to its `phase-changed` event. Delay or
  veto quitting with a `kernel/quit` decision.

### Process-specific APIs

| Need                                      | Where | API                                                                                                                                                                  |
| ----------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Own storage folder, kv stores             | main  | `mainHost(sdk).storage` (`dir`, `kv({ namespace, defaults })`)                                                                                                       |
| Sandboxed files, fetch                    | main  | `mainHost(sdk).fs`, `mainHost(sdk).net.fetch`                                                                                                                        |
| Shipped files                             | main  | `mainHost(sdk).assets?.resolve("resources/…")`                                                                                                                       |
| URL schemes, embedded frames              | main  | `mainHost(sdk).protocol`, `.embeddedHosts` (need permissions)                                                                                                        |
| A stream between your web and main halves | both  | `sdk.ports.handle(name, handler)` in main, `sdk.ports.open(name)` in a window                                                                                        |
| React access to the kernel                | web   | `@kilo-desktop/kernel/web`: `useSdk`, `useKernel`, `useExtensions`, `useExclusive`, `useDomainObject`, `useDomainObjectState`, `useContextKey`, `RenderContribution` |

Each plugin's data lives in its own storage. Never read or write another
plugin's files or kv; ask it through its domain object.

## Permissions

Host primitives are kernel domain objects. Calling their methods needs the
matching `permissions.host` entry; reading their state does not.

| Permission        | Gives                                                                |
| ----------------- | -------------------------------------------------------------------- |
| `windows`         | `kernel/windows`: open, focus and close windows                      |
| `dialogs`         | `kernel/dialogs`: open / save / message dialogs                      |
| `clipboard`       | `kernel/clipboard`                                                   |
| `os`              | `kernel/os`: open URLs, reveal files                                 |
| `notifications`   | `kernel/notifications`: OS notifications                             |
| `keychain`        | `kernel/keychain`: secrets                                           |
| `appearance`      | `kernel/native-theme`                                                |
| `app-menu`        | `kernel/app-menu`: the calling window's menu                         |
| `updater`         | `kernel/updater`                                                     |
| `data-collection` | `kernel/data-collection`: consent                                    |
| `browser-host`    | `mainHost(sdk).browser`: the embedded browser                        |
| `plugins`         | `kernel/plugins`: turn plugins on or off                             |
| `embedded-hosts`  | Reserved; embedded frames are granted by `permissions.embeddedHosts` |

`permissions.protocols` lists URL schemes the plugin serves (registered
before the app is ready; `mainHost(sdk).protocol`), and
`permissions.embeddedHosts` the embedded frames it serves
(`mainHost(sdk).embeddedHosts`). Each works only for what the manifest
declares. A plugin's own domain objects can check who is calling — see
[domain-objects.md](./domain-objects.md#callers-and-permissions).

## Shipping a bundled plugin

1. Add it to `packages/bundled-plugins` (`package.json` and
   `src/plugins.ts`).
2. Map its entries in `apps/desktop/src/main/kernel/plugins.ts` (main) and
   `apps/web/src/kernel/plugins.ts` (web), keyed by the manifest id.
3. Add an `@smoke` e2e spec (see [testing.md](./testing.md)) and a line in
   `CONTEXT.md`.

The removability tests then boot the app without it, and the isolation
check builds it outside the monorepo. Loading third-party plugins from
outside the app is not built yet; the example plugin shows the shape they
will have.

## Worked example

[`examples/hello-plugin`](../../examples/hello-plugin) (`example.hello`) is a
workspace package that is never bundled. It has a domain object in main with
kv storage (`example.hello/greetings`), a command, a telemetry event, and
tests with `createPluginHost`. `pnpm check`, `pnpm test` and
`pnpm check:plugin-isolation` cover it like a bundled plugin. Copy it to
start a new plugin.

[`examples/right-panel-plugin`](../../examples/right-panel-plugin)
(`example.right-panel`) shows a renderer-only plugin contributing to another
plugin's extension point: two `kilo.shell/right-sidebar-panel` panels, with a
browser test that boots the real shell with `renderShell`.
