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

| Point                             | Where                                       | Kind |
| --------------------------------- | ------------------------------------------- | ---- |
| `kilo.shell/main`                 | the main area                               | X    |
| `kilo.shell/left-sidebar`         | the left sidebar's body                     | X    |
| `kilo.shell/left-sidebar-account` | the account entry at the sidebar's foot     | X    |
| `kilo.shell/left-sidebar-notice`  | notices above the account entry             | A    |
| `kilo.shell/top-bar-title`        | the title in the top bar over the main area | X    |
| `kilo.shell/top-bar-action`       | actions in the top bar                      | A    |
| `kilo.shell/status-bar-item`      | the status bar under the main area          | A    |

An exclusive region shows a single winner, so gate a `top-bar-title` with
`when` on what it names. A notice is for something to act on ("Restart to
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
   	id: "acme.about/support-row",
   	kind: "additive",
   	description: "A row in About → Support.",
   	metadata: z.object({ title: z.string() }), // optional; what manifests write
   	implementation: implementation<ComponentType>("renderer"), // optional; what code binds
   });

   export const ABOUT_DEFINITIONS: PluginDefinitions = { extensionPoints: [SupportRow] };
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
- When contributions point at files they ship, declare the point with
  `resources: true`: contributors write `${resources}/…` in metadata and the
  kernel replaces it, in main, with the contributor's own `resources/`
  folder. Consumers get absolute paths and never look up another plugin's
  files.
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

| Extension point                               | Owner                | Kind | Process  | Purpose                                                                                               | Contributors (manifests)                                                                                                     |
| --------------------------------------------- | -------------------- | ---- | -------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `kernel/root`                                 | kernel               | X    | renderer | The interface rendered in the main window.                                                            | shell                                                                                                                        |
| `kernel/window-view`                          | kernel               | A    | renderer | A view that can be shown in a secondary window.                                                       | work-sessions                                                                                                                |
| `kernel/command`                              | kernel               | A    | any      | A named user action.                                                                                  | browser, chat, files, git, notebook, pages, shell, terminal, work-sessions, workspace-board                                  |
| `kernel/service`                              | kernel               | A    | main     | A supervised daemon or background task.                                                               | core, environments, local-inference, notebook, pages, work-sessions                                                          |
| `kernel/quit`                                 | kernel               | D    | main     | Proceed, ask or reject before the app quits.                                                          | —                                                                                                                            |
| `kernel/window-close`                         | kernel               | D    | main     | Proceed, ask or reject before a window closes.                                                        | —                                                                                                                            |
| `kernel/identity-provider`                    | kernel               | X    | main     | The primary identity: the account the user signs in with.                                             | core                                                                                                                         |
| `kernel/linked-account`                       | kernel               | A    | main     | Another signed-in account, added to the identity flags and telemetry see.                             | anaconda                                                                                                                     |
| `kernel/flag`                                 | kernel               | A    | data     | A declared feature flag: its id, description and default.                                             | core, developer, environments, local-inference, notebook, shell, work-sessions, workspace-board                              |
| `kernel/flag-source`                          | kernel               | X    | main     | Evaluates feature flags for the identity.                                                             | core                                                                                                                         |
| `kernel/telemetry-event`                      | kernel               | A    | data     | An analytics event the contributing plugin may send.                                                  | anaconda, browser, chat, core, environments, files, git, local-inference, marketplace, shell, work-sessions, workspace-board |
| `kernel/telemetry-sink`                       | kernel               | A    | main     | Delivers telemetry events.                                                                            | core                                                                                                                         |
| `kilo.chat/composer-action`                   | kilo.chat            | A    | renderer | A button, menu or popover in the composer.                                                            | chat, git                                                                                                                    |
| `kilo.chat/composer-mention`                  | kilo.chat            | A    | renderer | Mentions typed after a trigger character, resolved into agent context.                                | files                                                                                                                        |
| `kilo.chat/client-slash-command`              | kilo.chat            | A    | data     | Places a kernel command in the composer's / menu.                                                     | chat                                                                                                                         |
| `kilo.chat/tool-renderer`                     | kilo.chat            | A    | renderer | How calls to a tool look in the chat transcript.                                                      | chat                                                                                                                         |
| `kilo.chat/mcp-app`                           | kilo.chat            | A    | renderer | An interactive MCP App widget shown for a tool's calls.                                               | —                                                                                                                            |
| `kilo.chat/markdown-extension`                | kilo.chat            | A    | renderer | Remark plugins and component decorators for the transcript's markdown.                                | browser, files                                                                                                               |
| `kilo.chat/permission-renderer`               | kilo.chat            | A    | renderer | Details and policies for the agent's permission requests and questions.                               | environments, notebook                                                                                                       |
| `kilo.chat/model-source`                      | kilo.chat            | A    | renderer | A local model provider: its model picker rail and model loading before prompts.                       | local-inference                                                                                                              |
| `kilo.core/ai-provider`                       | kilo.core            | A    | main     | An AI provider entry in Kilo's config.                                                                | local-inference                                                                                                              |
| `kilo.core/mcp-server`                        | kilo.core            | A    | main     | An MCP server added to Kilo's config.                                                                 | pages                                                                                                                        |
| `kilo.core/agent-extension`                   | kilo.core            | A    | data     | An agent, command, skill or Kilo plugin added to Kilo.                                                | notebook                                                                                                                     |
| `kilo.core/server-env`                        | kilo.core            | A    | main     | Environment variables for the Kilo server process.                                                    | notebook, pages                                                                                                              |
| `kilo.core/chat-config`                       | kilo.core            | A    | main     | Instructions and permissions for a chat, given its id, directory and stamp.                           | environments                                                                                                                 |
| `kilo.core/tool`                              | kilo.core            | A    | main     | A desktop tool the agent can call.                                                                    | browser, chat, environments, files, git, local-inference, notebook, terminal                                                 |
| `kilo.core/tool-approval`                     | kilo.core            | D    | main     | Proceed, ask or reject a tool call.                                                                   | chat                                                                                                                         |
| `kilo.local-inference/model-catalog`          | kilo.local-inference | A    | main     | A browsable list of GGUF models to download into the Local Model Server.                              | anaconda                                                                                                                     |
| `kilo.local-inference/llama-runtime`          | kilo.local-inference | A    | main     | A way to get the llama.cpp server binary, tried by priority.                                          | environments                                                                                                                 |
| `kilo.shell/main`                             | kilo.shell           | X    | renderer | The main area of the window, shown when the app opens.                                                | work-sessions                                                                                                                |
| `kilo.shell/left-sidebar`                     | kilo.shell           | X    | renderer | The left sidebar's body.                                                                              | work-sessions                                                                                                                |
| `kilo.shell/sidebar-notice`                   | kilo.shell           | A    | renderer | Something to act on, at the foot of the left sidebar.                                                 | shell                                                                                                                        |
| `kilo.shell/status-bar-item`                  | kilo.shell           | A    | renderer | Ambient status in the window's status bar: a view, an action or a popover.                            | local-inference                                                                                                              |
| `kilo.shell/top-bar-title`                    | kilo.shell           | X    | renderer | What names the main area in the window's top bar, in place of its title.                              | work-sessions                                                                                                                |
| `kilo.shell/top-bar-action`                   | kilo.shell           | A    | renderer | Actions at the right of the window's top bar.                                                         | work-sessions                                                                                                                |
| `kilo.shell/right-sidebar-panel`              | kilo.shell           | A    | renderer | A panel in the right sidebar, opened from its icon in the rail.                                       | —                                                                                                                            |
| `kilo.shell/dialog`                           | kilo.shell           | A    | renderer | An app-wide dialog opened by command.                                                                 | work-sessions, workspace-board                                                                                               |
| `kilo.shell/settings-category`                | kilo.shell           | A    | data     | A heading in the Settings sidebar.                                                                    | developer, shell                                                                                                             |
| `kilo.shell/settings-section`                 | kilo.shell           | A    | renderer | A Settings page.                                                                                      | developer, environments, local-inference, marketplace, notebook, shell, work-sessions                                        |
| `kilo.shell/ai-provider-panel`                | kilo.shell           | A    | renderer | An AI provider's panel in Settings → AI Providers.                                                    | shell                                                                                                                        |
| `kilo.shell/account-panel`                    | kilo.shell           | A    | renderer | An account in Settings → Account.                                                                     | anaconda, shell                                                                                                              |
| `kilo.shell/about-section`                    | kilo.shell           | A    | renderer | A block of Settings → About.                                                                          | shell                                                                                                                        |
| `kilo.shell/support-row`                      | kilo.shell           | A    | renderer | A row in About → Support.                                                                             | shell                                                                                                                        |
| `kilo.shell/onboarding-step`                  | kilo.shell           | A    | renderer | A first-run onboarding step.                                                                          | shell, work-sessions                                                                                                         |
| `kilo.shell/menu-item`                        | kilo.shell           | A    | data     | A command in the native app menu.                                                                     | shell, work-sessions                                                                                                         |
| `kilo.shell/deep-link`                        | kilo.shell           | A    | data     | An app URL host routed to a page.                                                                     | environments, local-inference                                                                                                |
| `kilo.work-sessions/vcs`                      | kilo.work-sessions   | X    | main     | Version control for workspace folders: status, branches and the isolated copies work sessions run in. | git                                                                                                                          |
| `kilo.work-sessions/opener`                   | kilo.work-sessions   | A    | data     | Opens an object (a file, a URL) in a pane kind.                                                       | browser, chat, files, notebook                                                                                               |
| `kilo.work-sessions/pane-kind`                | kilo.work-sessions   | A    | renderer | A kind of pane a work session can hold.                                                               | browser, chat, files, git, notebook, pages, terminal                                                                         |
| `kilo.work-sessions/work-session-menu`        | kilo.work-sessions   | A    | renderer | An item in a work session's menu.                                                                     | workspace-board                                                                                                              |
| `kilo.work-sessions/work-session-decoration`  | kilo.work-sessions   | A    | renderer | A badge or hover detail shown with a work session.                                                    | git                                                                                                                          |
| `kilo.work-sessions/work-session-facet`       | kilo.work-sessions   | A    | renderer | Read-only facts about work sessions the session list filters by.                                      | git                                                                                                                          |
| `kilo.work-sessions/work-session-grouping`    | kilo.work-sessions   | A    | renderer | A way to group the session list into a plugin's categories.                                           | workspace-board                                                                                                              |
| `kilo.work-sessions/work-sessions-view`       | kilo.work-sessions   | A    | renderer | Another view of the work sessions, shown in place of the open work session.                           | workspace-board                                                                                                              |
| `kilo.work-sessions/work-session-action`      | kilo.work-sessions   | A    | renderer | A button in an open work session's header.                                                            | chat, git, work-sessions                                                                                                     |
| `kilo.work-sessions/work-session-list-action` | kilo.work-sessions   | A    | renderer | A button in the session list's header.                                                                | workspace-board                                                                                                              |
| `kilo.work-sessions/new-work-session-option`  | kilo.work-sessions   | A    | renderer | A choice on the New Session page, beside where the session runs.                                      | git                                                                                                                          |
| `kilo.work-sessions/work-session-starter`     | kilo.work-sessions   | X    | renderer | The New Session page's body: how a person starts a session.                                           | chat                                                                                                                         |
| `kilo.work-sessions/permission-auto-answer`   | kilo.work-sessions   | A    | renderer | Whether a plugin answers an agent permission request for the person.                                  | chat                                                                                                                         |

<!-- catalog:end -->
