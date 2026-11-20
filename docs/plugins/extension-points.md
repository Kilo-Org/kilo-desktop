# Extension points

An extension point is a typed slot one plugin owns and others fill: a
settings section, a pane kind, an agent tool. Points are named for what they
mean in the product (`kilo.chat/composer-mention`, not `slot-2`). Design
rationale: [plugin-architecture.md](../plugin-architecture.md#building-blocks).

The catalog of every extension point, domain object, object type and
context key is generated from the manifests in [schema.md](./schema.md)
(`pnpm docs:schema`, checked by `pnpm lint`). Each point's contract, in its
owner's `src/contracts`, documents its fields.

## Kinds

| Kind              | Meaning                                                                                    | Read with                             |
| ----------------- | ------------------------------------------------------------------------------------------ | ------------------------------------- |
| **Additive (A)**  | Many contributions, ordered by `priority` (higher first)                                   | `useExtensions(Point)`                |
| **Exclusive (X)** | One winner (user pin, then priority); the rest are the fallback                            | `useExclusive(Point)`                 |
| **Decision (D)**  | The owner asks a question; each contributor answers `"proceed"`, `{ ask }` or `{ reject }` | `sdk.extensions.decide(Point, input)` |

Decisions run in a fixed order with a time budget. A point "fails open"
(a slow or failing handler counts as proceed — `kernel/quit`) or "fails
closed" (counts as reject — `kilo.core/tool-approval`).

## Contributing

A contribution has two halves:

- **Metadata** — plain data in `plugin.json`, validated against the point's
  schema. The app can list it (a command in the palette, a pane kind in the
  launcher) without running your code.
- **Implementation** — code bound at activation with
  `sdk.extensions.implement(Point, localId, implementation)`, in the process
  the point says (`renderer`, `main` or `any`).

```jsonc
// plugin.json
"contributes": {
	"extensions": {
		"kilo.shell/settings-section": [
			{ "id": "hello", "title": "Hello", "description": "Say hello.", "priority": 10 }
		]
	}
}
```

```ts
// src/web/index.ts
import { definePlugin } from "@kilo-desktop/kernel";
import { SettingsSection } from "@kilo-desktop/plugin-shell/contracts";

export const helloWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(SettingsSection, "hello", { component: HelloSettings });
	},
});
```

Common fields on every entry:

| Field      | Meaning                                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`       | Local id, unique per plugin and point. The contribution's key is `<plugin>/<id>`.                                                                    |
| `priority` | Order among contributions, higher first. Default 0.                                                                                                  |
| `when`     | Shown only while the condition holds: `{ "all": [...], "none": [...] }` over context keys (see [commands-and-keys.md](./commands-and-keys.md#when)). |

Most points need an implementation; a contribution without one stays
inactive. Some take metadata only (`kilo.work-sessions/opener`,
`kernel/telemetry-event`, `kilo.shell/deep-link`).

**Runtime contributions.** For entries that only exist at runtime, use
`sdk.extensions.add(Point, entry, implementation)`. It is validated like a
manifest entry and returns `{ update, remove }`. Prefer the manifest when
you can.

**Self-sufficient contributions.** A contribution gets its data from its
own plugin (its domain objects), never from the component that hosts it, so
it works in any host and any window.

**The window frame.** kilo.shell names its layout regions by where they
are, `<region>-<slot>`, so you can find where to put something:

| Point                            | Where                                       | Kind |
| -------------------------------- | ------------------------------------------- | ---- |
| `kilo.shell/main`                | the main area                               | X    |
| `kilo.shell/left-sidebar`        | the left sidebar's body                     | X    |
| `kilo.shell/sidebar-notice`      | notices at the foot of the left sidebar     | A    |
| `kilo.shell/top-bar-title`       | the title in the top bar over the main area | X    |
| `kilo.shell/top-bar-action`      | actions at the right of the top bar         | A    |
| `kilo.shell/status-bar-item`     | the status bar under the main area          | A    |
| `kilo.shell/right-sidebar-panel` | panels in the right sidebar, from its rail  | A    |

An exclusive region shows a single winner, so gate a `top-bar-title` with
`when` on what it names. A notice is for something to act on ("Restart to
update"); the status bar is for ambient status. Settings, onboarding steps,
dialogs, menu items and deep links aren't places, so they are named by what
they are.

**Example: a status bar item.** A `view` (your component as it is), an
`action` (a button running `run` or the entry's `command`) or a `popover` (a
button opening your `Content` above the bar). kilo.shell renders your
`Trigger` component while the item shows; it reads your state with hooks and
returns `children({ label, icon, tone, hidden })` (`tone`: `warning`,
`error`), which the bar draws as the button. Items sit at the bar's `start` (about the app or
workspace: a server, sync) or `end` (about the open session) by `priority`.
The bar shows only while an item renders, so gate rarely-useful items with
`when` or `hidden` rather than rendering an empty label.

```jsonc
"kilo.shell/status-bar-item": [
	{ "id": "server", "title": "Agent server", "kind": "popover", "align": "start",
	  "when": { "all": ["acme.server/running"] } }
]
```

```ts
sdk.extensions.implement(StatusBarItem, "server", {
	kind: "popover",
	Trigger: ({ children }) => children({ icon: ServerIcon, label: "Server ready" }),
	Content: ({ close }) => <ServerDetails onDone={close} />,
});
```

## Defining a point

1. Declare it in `plugin.json`:

   ```jsonc
   "extensionPoints": [
   	{ "id": "support-row", "kind": "additive", "description": "A row in About → Support." }
   ]
   ```

2. Define it in `src/contracts` and list it in your definitions:

   ```ts
   import type { ComponentType } from "react";
   import { z } from "zod";
   import {
   	defineExtensionPoint,
   	implementation,
   	type PluginDefinitions,
   } from "@kilo-desktop/kernel";

   export const SupportRow = defineExtensionPoint({
   	id: "acme.about/support-row",
   	kind: "additive",
   	description: "A row in About → Support.",
   	metadata: z.object({ title: z.string() }), // optional; what manifests write
   	implementation: implementation<ComponentType>("renderer"), // optional; what code binds
   });

   export const ABOUT_DEFINITIONS: PluginDefinitions = { extensionPoints: [SupportRow] };
   ```

   For decisions use
   `defineDecisionExtensionPoint({ id, process, input, failMode, timeoutMs })`.

3. Render or call the contributions in your host:

   ```tsx
   const rows = useExtensions(SupportRow); // `when` already applied, ordered
   return rows.map((row) => <RenderContribution key={row.key} contribution={row} />);
   ```

   `RenderContribution` mounts each one inside its plugin's sdk and an error
   boundary, so one crashing contribution doesn't take the host down. Pass
   `select={(impl) => impl.component}` when the implementation is an object.

Guidelines:

- Add a point when a real contributor exists, and ship your own built-ins
  through it (kilo.chat's model picker is a `composer-action`). That proves
  the point works.
- Make metadata carry what the host needs to list or order things without
  running code; keep behaviour in the implementation.
- When contributions point at files they ship, declare the point with
  `resources: true`: contributors write `${resources}/…` in metadata and the
  kernel replaces it, in main, with the contributor's own `resources/`
  folder. Consumers get absolute paths and never look up another plugin's
  files.
- Record candidate points in the extensibility map
  ([plugin-architecture.md](../plugin-architecture.md#extensibility-map)).
- A point whose owner isn't installed reads as empty — hosts and contributors
  both keep working.
