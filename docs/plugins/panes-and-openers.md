# Panes and openers

A work session holds **panes**: agent, terminal, browser, files, changes,
notebook. kilo.work-sessions owns which panes exist (shared by every window,
in main) and draws them. A plugin adds a **pane kind** and, optionally,
**openers** that send objects (a file, a URL) to it. The contracts are in
`@kilo-desktop/plugin-work-sessions/contracts`.

## A pane kind

```jsonc
// plugin.json
"requires": { "kilo.work-sessions/pane-kind": "optional" },
"contributes": {
	"extensions": {
		"kilo.work-sessions/pane-kind": [
			{
				"id": "terminal",
				"title": "Terminal",
				"description": "Run commands in an interactive shell.",
				"launch": { "newSession": true, "inSession": true },
				"keepAlive": true,
				"openCommand": "kilo.terminal/open-terminal"
			}
		]
	}
}
```

```tsx
// src/web/index.ts
import { PaneKind, type PaneProps } from "@kilo-desktop/plugin-work-sessions/contracts";

sdk.extensions.implement(PaneKind, "terminal", { component: TerminalView, icon: TerminalIcon });

function TerminalView({ workSessionId, pane, directory, visible }: PaneProps) {
	/* … */
}
```

The kind's id is its contribution key (`kilo.terminal/terminal`).

| Metadata                           | Meaning                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`, `description`             | Shown on the New Session page and in the "+" menu                                                                                                                                                                                                                                                                            |
| `launch`                           | `{ newSession, inSession }`: offered on the New Session page / the work session's "+" (default `false` / `true`); `sessionHeader: true` gives an in-session kind its own button after the header's "+" instead of a place in that menu (default `false`); `tabGroup: false` keeps it out of tab groups' "+" (default `true`) |
| `singleton`                        | At most one per work session; opening again shows it                                                                                                                                                                                                                                                                         |
| `keepAlive`                        | Stays mounted while hidden (terminals, web pages); otherwise unmounts                                                                                                                                                                                                                                                        |
| `layoutKind`                       | Starting width: `agent`, `document`, `notebook` or `tool` (default)                                                                                                                                                                                                                                                          |
| `order`                            | Position in lists, lower first (default 100)                                                                                                                                                                                                                                                                                 |
| `availableWhen`, `unavailableHint` | Listed but not startable unless the `when` holds, with the reason (`kilo.core/signedIn`, "Sign in to …")                                                                                                                                                                                                                     |
| `openCommand`                      | The command that opens it; its shortcut is shown where the kind is offered                                                                                                                                                                                                                                                   |

`PaneProps`:

| Prop            | Meaning                                                                      |
| --------------- | ---------------------------------------------------------------------------- |
| `workSessionId` | The work session                                                             |
| `pane`          | `{ id, kind, title, iconKey?, object?, metadata, ordinal, status? }`         |
| `workspaceId`   | The work session's workspace, or null                                        |
| `directory`     | Where the work session works (its copy, else the workspace's primary folder) |
| `visible`       | True while the pane is the one shown in its group                            |

The implementation is `{ component, icon?, canClose? }`. A pane of a kind
whose plugin is missing stays listed and renders as "unavailable", so
work sessions survive a plugin being removed.

## Opening and changing panes

Use the `kilo.work-sessions/panes` domain object (`Panes`); the kinds
themselves are contributions to the `kilo.work-sessions/pane-kind` point:

```ts
const panes = sdk.domainObjects.get(Panes);
await panes?.methods.open({ workSessionId, kind: "kilo.terminal/terminal" });
await panes?.methods.update({ workSessionId, paneId, title: "build", metadata: { cwd } });
await panes?.methods.update({ workSessionId, paneId, status: "attention" });
await panes?.methods.close({ workSessionId, paneId });
```

- `object` is what the pane shows (a file, a URL, a chat) as an object
  reference (`{ type, id }`), resolvable through its type
  (`sdk.domainObjects.resolve`). Openers set it (below).
- `metadata` is a string map for the kind's own small facts (a cwd, a
  zoom level). It is saved with the work session and handed back in
  `pane.metadata`. Keep large or live state in your own domain object, keyed
  by pane id.
- `status` (`busy` or `attention`) badges the pane's tab; `null` clears it.
- Each pane is also an object, `kilo.work-sessions/pane`, keyed
  `<workSessionId>/<paneId>` (`paneKey`).
- Listen to `Panes` `opened` / `closed` (in main) to create or clean up
  per-pane resources.
- The window's open work session is
  `WorkSessionsWindow.getState().activeWorkSessionId` (the
  `kilo.work-sessions/window` domain object). To open your kind there as a
  person does from "+" (showing its existing pane, bringing a popped-out
  window forward; with no work session open, starting one from the New
  Session page), call `WorkSessionsWindow.openPane({ kind })` — an "Open …"
  command should, rather than `Panes.open`.

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

kilo.work-sessions can pop any pane into its own window and dock it back; a
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
"kilo.work-sessions/opener": [
	{ "id": "ipynb-file", "match": { "type": "kilo.work-sessions/file", "pattern": "*.ipynb" }, "pane": "kilo.notebook/notebook" },
	{ "id": "any-file", "priority": -100, "match": { "type": "kilo.work-sessions/file" }, "pane": "kilo.files/files" }
]
```

Openers are metadata only. Anyone opens an object with
`Panes.openObject({ workSessionId, ref })`: the highest-`priority` opener
whose type and glob (on the ref's id) match wins, and the pane already
showing the object is reused. The pane finds what it was opened for in
`pane.object`. A general opener takes a low `priority` (a contribution
field) so specific ones win: kilo.files opens any file at -100, so the
notebook's `*.ipynb` and kilo.browser's `*.html` openers (at the default 0)
come first. `openObject` returns null when no opener matches.

Object types kilo.work-sessions owns for this: `kilo.work-sessions/file` (id:
absolute path) and `kilo.work-sessions/url` (id: URL).
