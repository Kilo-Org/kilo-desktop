# Extension points

An extension point is a typed slot one plugin owns and others fill: a
settings section, a pane kind, an agent tool. Points are named for what they
mean in the product (`kilo.chat/composer-mention`, not `slot-2`). Design
rationale: [plugin-architecture.md §2.2](../plugin-architecture.md#22-the-two-registries).

## Kinds

| Kind              | Meaning                                                                                    | Read with                             |
| ----------------- | ------------------------------------------------------------------------------------------ | ------------------------------------- |
| **Additive (A)**  | Many contributions, ordered by `priority` (higher first)                                   | `useExtensions(Point)`                |
| **Exclusive (X)** | One winner (user pin, then priority); the rest are the fallback                            | `useExclusive(Point)`                 |
| **Decision (D)**  | The owner asks a question; each contributor answers `"proceed"`, `{ ask }` or `{ reject }` | `sdk.extensions.decide(Point, input)` |

Decisions run in a fixed order with a time budget. A point "fails open"
(a slow or failing handler counts as proceed — `kernel/quit`) or "fails
closed" (counts as reject — `kilo.agent/tool-approval`).

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
inactive. Some take metadata only (`kilo.sessions/opener`,
`kilo.telemetry/telemetry-event`, `kilo.shell/deep-link`).

**Runtime contributions.** For entries that only exist at runtime, use
`sdk.extensions.add(Point, entry, implementation)`. It is validated like a
manifest entry and returns `{ update, remove }`. Prefer the manifest when
you can.

**Self-sufficient contributions.** A contribution gets its data from its
own plugin (its domain objects), never from the component that hosts it, so
it works in any host and any window.

**The window frame.** kilo.shell names its layout regions by where they
are, `<region>-<slot>`, so you can find where to put something:

| Point                             | Where                                   | Kind |
| --------------------------------- | --------------------------------------- | ---- |
| `kilo.shell/main`                 | the main area                           | X    |
| `kilo.shell/left-sidebar`         | the left sidebar's body                 | X    |
| `kilo.shell/left-sidebar-account` | the account entry at the sidebar's foot | X    |
| `kilo.shell/left-sidebar-notice`  | notices above the account entry         | A    |
| `kilo.shell/status-bar-item`      | the status bar under the main area      | A    |

The exclusive ones belong to kilo.workbench and kilo.account; contribute to
the additive ones. A notice is for something to act on ("Restart to
update"); the status bar is for ambient status. Settings, onboarding steps,
deep links and overlays aren't places, so they are named by what they are.

**Example: a status bar item.** A `view` (your component as it is), an
`action` (a button running `run` or the entry's `command`) or a `popover` (a
button opening your `Content` above the bar). `useTrigger` runs as a hook
while the item shows and returns its label, icon, `tone` (`warning`,
`error`) or `hidden`. Items sit at the bar's `start` (about the app or
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
	useTrigger: () => ({ icon: ServerIcon, label: "Server ready" }),
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
   import { defineExtensionPoint, implementation } from "@kilo-desktop/kernel";

   export const SupportRow = defineExtensionPoint({
   	id: "kilo.updates/support-row",
   	kind: "additive",
   	description: "A row in About → Support.",
   	metadata: z.object({ title: z.string() }), // optional; what manifests write
   	implementation: implementation<ComponentType>("renderer"), // optional; what code binds
   });

   export const UPDATES_DEFINITIONS: PluginDefinitions = { extensionPoints: [SupportRow] };
   ```

   For decisions use `defineDecisionPoint({ id, process, input, failMode, timeoutMs })`.

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
- Record candidate points in the extensibility map
  ([plugin-architecture.md §7](../plugin-architecture.md#7-extensibility-map)).
- A point whose owner isn't installed reads as empty — hosts and contributors
  both keep working.

## Catalog

Every point the kernel and the bundled plugins define. **Process** is where
implementations bind (`data`: metadata only). Contributors are those
declared in manifests. Generated from the manifests and contracts — run
`pnpm docs:extension-points` after adding or changing a point; `pnpm lint`
fails when the table is stale. Each point's contract (in the owner's
`src/contracts`) documents its fields.

<!-- catalog:start (pnpm docs:extension-points) -->

| Extension point                     | Owner           | Kind | Process  | Purpose                                                                         | Contributors (manifests)                                                                                                 |
| ----------------------------------- | --------------- | ---- | -------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `kernel/root`                       | kernel          | X    | renderer | The interface rendered in the main window.                                      | shell                                                                                                                    |
| `kernel/window-view`                | kernel          | A    | renderer | A view that can be shown in a secondary window.                                 | workbench                                                                                                                |
| `kernel/command`                    | kernel          | A    | any      | A named user action.                                                            | browser, chat, files, git, notebook, shell, terminal, workbench, workspace-board, workspaces                             |
| `kernel/service`                    | kernel          | A    | main     | A supervised daemon or background task.                                         | agent, environments, flags, local-inference, notebook, telemetry, workspaces                                             |
| `kernel/quit`                       | kernel          | D    | main     | Proceed, ask or reject before the app quits.                                    | —                                                                                                                        |
| `kernel/window-close`               | kernel          | D    | main     | Proceed, ask or reject before a window closes.                                  | —                                                                                                                        |
| `kilo.account/account-panel`        | kilo.account    | A    | renderer | A panel in Settings → Account for another account.                              | anaconda-account                                                                                                         |
| `kilo.agent/runtime-config`         | kilo.agent      | A    | main     | Environment, Kilo plugins and MCP servers for the Kilo server.                  | local-inference, notebook                                                                                                |
| `kilo.agent/model-provider`         | kilo.agent      | A    | main     | A model provider added to Kilo's config.                                        | local-inference                                                                                                          |
| `kilo.agent/provider-panel`         | kilo.agent      | A    | renderer | A featured provider row in AI Providers.                                        | account                                                                                                                  |
| `kilo.agent/tool`                   | kilo.agent      | A    | main     | A tool the agent (and paired external AI apps) can call.                        | browser, chat, environments, files, git, local-inference, notebook, terminal                                             |
| `kilo.agent/tool-approval`          | kilo.agent      | D    | main     | Proceed, ask or reject an agent tool call.                                      | —                                                                                                                        |
| `kilo.agent/session-config`         | kilo.agent      | A    | main     | Tools and instructions for a session's chats.                                   | environments                                                                                                             |
| `kilo.agent/chat-owner`             | kilo.agent      | A    | main     | Says which Work Session holds a Kilo chat.                                      | sessions                                                                                                                 |
| `kilo.chat/composer-action`         | kilo.chat       | A    | renderer | A button, menu or popover in the composer.                                      | chat, git                                                                                                                |
| `kilo.chat/composer-mention`        | kilo.chat       | A    | renderer | Mentions typed after a trigger character, resolved into agent context.          | files                                                                                                                    |
| `kilo.chat/tool-renderer`           | kilo.chat       | A    | renderer | How calls to a tool look in the chat transcript.                                | chat                                                                                                                     |
| `kilo.chat/mcp-app`                 | kilo.chat       | A    | renderer | An interactive MCP App widget shown for a tool's calls.                         | —                                                                                                                        |
| `kilo.chat/markdown-extension`      | kilo.chat       | A    | renderer | Remark plugins and component decorators for the transcript's markdown.          | browser, files                                                                                                           |
| `kilo.chat/interaction-renderer`    | kilo.chat       | A    | renderer | Details and policies for the agent's permission requests and questions.         | environments                                                                                                             |
| `kilo.chat/model-source`            | kilo.chat       | A    | renderer | A local model provider: its model picker rail and model loading before prompts. | local-inference                                                                                                          |
| `kilo.sessions/pane-kind`           | kilo.sessions   | A    | renderer | A kind of pane a session can hold.                                              | browser, chat, files, git, notebook, terminal                                                                            |
| `kilo.sessions/opener`              | kilo.sessions   | A    | data     | Opens an object (a file, a URL) in a pane kind.                                 | browser, files, notebook                                                                                                 |
| `kilo.shell/main`                   | kilo.shell      | X    | renderer | The main area of the window, shown when the app opens.                          | workbench                                                                                                                |
| `kilo.shell/left-sidebar`           | kilo.shell      | X    | renderer | The left sidebar's body.                                                        | workbench                                                                                                                |
| `kilo.shell/left-sidebar-account`   | kilo.shell      | X    | renderer | The account entry at the foot of the left sidebar.                              | account                                                                                                                  |
| `kilo.shell/left-sidebar-notice`    | kilo.shell      | A    | renderer | A notice above the account entry in the left sidebar.                           | updates                                                                                                                  |
| `kilo.shell/settings-category`      | kilo.shell      | A    | data     | A heading in the Settings sidebar that sections sit under.                      | developer, shell                                                                                                         |
| `kilo.shell/settings-section`       | kilo.shell      | A    | renderer | A section of the Settings page.                                                 | account, agent, developer, environments, local-inference, marketplace, notebook, shell, telemetry, updates, workbench    |
| `kilo.shell/status-bar-item`        | kilo.shell      | A    | renderer | An item in the window's status bar: a view, a button or a popover.              | —                                                                                                                        |
| `kilo.shell/deep-link`              | kilo.shell      | A    | data     | Routes an app URL host to a page.                                               | local-inference                                                                                                          |
| `kilo.shell/onboarding-step`        | kilo.shell      | A    | renderer | A step of first-run onboarding.                                                 | account, agent, shell, workspaces                                                                                        |
| `kilo.shell/overlay`                | kilo.shell      | A    | renderer | Always-mounted UI such as app-wide dialogs.                                     | local-inference, workspace-board, workspaces                                                                             |
| `kilo.telemetry/telemetry-event`    | kilo.telemetry  | A    | data     | An analytics event a plugin may send.                                           | anaconda-account, browser, environments, files, git, local-inference, marketplace, telemetry, workbench, workspace-board |
| `kilo.updates/support-row`          | kilo.updates    | A    | renderer | A row in About → Support with information to include when contacting support.   | agent                                                                                                                    |
| `kilo.workbench/session-menu`       | kilo.workbench  | A    | renderer | An item in a session's menu.                                                    | workspace-board                                                                                                          |
| `kilo.workbench/session-decoration` | kilo.workbench  | A    | renderer | A badge or hover detail shown with a session.                                   | git                                                                                                                      |
| `kilo.workbench/session-action`     | kilo.workbench  | A    | renderer | A button in an open session's header.                                           | git, workbench                                                                                                           |
| `kilo.workbench/pane-kind-menu`     | kilo.workbench  | A    | renderer | Entries in the header menu of a pinned pane kind.                               | chat                                                                                                                     |
| `kilo.workbench/navigator-action`   | kilo.workbench  | A    | renderer | A button in the session list's header.                                          | workspace-board                                                                                                          |
| `kilo.workbench/launcher-option`    | kilo.workbench  | A    | renderer | A session-creation option under the launcher's buttons.                         | git                                                                                                                      |
| `kilo.workbench/session-starter`    | kilo.workbench  | X    | renderer | The New Session page's body: how a person starts a session.                     | chat                                                                                                                     |
| `kilo.workbench/session-facet`      | kilo.workbench  | A    | renderer | Read-only facts about sessions the session list filters by.                     | git                                                                                                                      |
| `kilo.workbench/sessions-view`      | kilo.workbench  | A    | renderer | Another view of the sessions, shown in place of the open session.               | workspace-board                                                                                                          |
| `kilo.workspaces/vcs`               | kilo.workspaces | X    | main     | Version control for workspace folders: status, branches and worktrees.          | git                                                                                                                      |

<!-- catalog:end -->
