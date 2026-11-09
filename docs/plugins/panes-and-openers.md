# Panes and openers

A Work Session holds **panes**: agent, terminal, browser, files, changes,
notebook. kilo.sessions owns which panes exist (shared by every window, in
main); kilo.workbench draws them. A plugin adds a **pane kind** and,
optionally, **openers** that send objects (a file, a URL) to it. The
contracts are in `@kilo-desktop/plugin-sessions/contracts`.

## A pane kind

```jsonc
// plugin.json
"requires": { "kilo.sessions/pane-kind": "optional" },
"contributes": {
	"extensions": {
		"kilo.sessions/pane-kind": [
			{
				"id": "terminal",
				"title": "Terminal",
				"description": "Run commands in an interactive shell.",
				"launch": { "newSession": true, "inSession": true },
				"keepAlive": true
			}
		]
	}
}
```

```tsx
// src/web/index.ts
import { PaneKind, type PaneProps } from "@kilo-desktop/plugin-sessions/contracts";

sdk.extensions.implement(PaneKind, "terminal", { component: TerminalView, icon: TerminalIcon });

function TerminalView({ sessionId, pane, directory, visible }: PaneProps) {
	/* … */
}
```

The kind's id is its contribution key (`kilo.terminal/terminal`).

| Metadata                           | Meaning                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `title`, `description`             | Shown in the launcher and the "+" menu                                                                                                                                                                                                                                                                                                           |
| `launch`                           | `{ newSession, inSession }`: offered in a new session's launcher / the session's "+" (default `false` / `true`); `sessionHeader: true` gives an in-session kind its own button after the header's "+" instead of a place in that menu (default `false`); `tabGroup: false` keeps it out of tab groups' "+" (default `true`). The agent uses both |
| `singleton`                        | At most one per session; opening again shows it                                                                                                                                                                                                                                                                                                  |
| `keepAlive`                        | Stays mounted while hidden (terminals, web pages); otherwise unmounts                                                                                                                                                                                                                                                                            |
| `layoutKind`                       | Starting width: `agent`, `document`, `notebook` or `tool` (default)                                                                                                                                                                                                                                                                              |
| `order`                            | Position in lists, lower first (default 100)                                                                                                                                                                                                                                                                                                     |
| `availableWhen`, `unavailableHint` | Listed but not startable unless the `when` holds, with the reason (`kilo.account/signedIn`, "Sign in to …")                                                                                                                                                                                                                                      |

`PaneProps`:

| Prop          | Meaning                                                           |
| ------------- | ----------------------------------------------------------------- |
| `sessionId`   | The Work Session                                                  |
| `pane`        | `{ id, kind, title, iconKey?, metadata, ordinal }`                |
| `workspaceId` | The session's workspace, or null                                  |
| `directory`   | Where the session works (its worktree, else the workspace folder) |
| `visible`     | True while the pane is the one shown in its group                 |

The implementation is `{ component, icon?, canClose? }`. A pane of a kind
whose plugin is missing stays listed and renders as "unavailable", so
sessions survive a plugin being removed.

## Opening and changing panes

Use the `kilo.sessions/pane` domain object (`Panes`); the kinds themselves
are contributions to the `kilo.sessions/pane-kind` point:

```ts
const panes = sdk.domains.get(Panes);
await panes?.methods.open({ sessionId, kind: "kilo.terminal/terminal" });
await panes?.methods.update({ sessionId, paneId, title: "build", metadata: { cwd } });
await panes?.methods.close({ sessionId, paneId });
```

- `metadata` is a string map for the kind's own small facts (a path, a
  URL). It is saved with the session and handed back in `pane.metadata`.
  Keep large or live state in your own domain object, keyed by pane id.
- Listen to `Panes` `opened` / `closed` (in main) to create or clean up
  per-pane resources.
- The window's open session is `Workbench.getState().activeSessionId`
  (`@kilo-desktop/plugin-workbench/contracts`). To open your kind there as a
  person does from "+" (showing its existing pane, bringing a popped-out
  window forward), call `Workbench.openPane({ kind })` — an "Open …" command
  should, rather than `Panes.open`.

## Close guards

To keep a pane open while it has unsaved work, add `canClose`:

```ts
sdk.extensions.implement(PaneKind, "files", {
	component: FilesView,
	canClose: async ({ pane }) => !documents.isDirty(pane.id) || (await confirmDiscard()),
});
```

Return `false` to keep the pane. Guards fail open: one that throws lets the
pane close, so a bug can never trap the person. `@kilo-desktop/ui` has the
standard Save / Discard / Cancel dialog (`@kilo-desktop/ui/components/pane-close-dialog`).

## Pop-outs

kilo.workbench can pop any pane into its own window and dock it back; a
pane kind needs nothing extra. In the pop-out:

- The pane gets the same props, inside a separate window kernel. Your web
  entry is activated there too, and `kernel/secondaryWindow` is true.
- Anything the pane shows must come from domain objects with `home: "main"`
  (or from props), not module state in one window — that is what makes it
  look the same in both windows.
- Per-window domain objects (`home: "renderer"`) are separate in each
  window.

For other views in their own window, contribute a `kernel/window-view` and
open it with `kernel/windows.open({ view, params, key })` (`windows`
permission).

## Openers

An opener says "objects of this type open in this pane kind":

```jsonc
"kilo.sessions/opener": [
	{ "id": "ipynb-file", "match": { "type": "kilo.workspaces/file", "pattern": "*.ipynb" }, "pane": "kilo.notebook/notebook" }
]
```

Openers are metadata only. Anyone opens an object with
`Panes.openObject({ sessionId, ref })`: the highest-priority opener whose
type and glob match wins, and the object's pane is reused if it is already
open. The pane finds what it was opened for in
`pane.metadata.objectType` / `pane.metadata.objectId`. A general opener
takes a low `priority` so specific ones win: kilo.files opens any file at
-100, so the notebook's `*.ipynb` and kilo.browser's `*.html` openers (at
the default 0) come first.

Object types in use: `kilo.workspaces/file` (id: absolute path) and
`kilo.browser/url` (id: URL).
