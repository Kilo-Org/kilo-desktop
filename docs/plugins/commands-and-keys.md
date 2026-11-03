# Commands, keys and `when`

A **command** is a named action a person can run: "New terminal", "Push".
It has no placement. The command palette lists it, the keyboard runs it,
and surfaces such as a session header or the composer refer to it by id.
Commands are contributions to the kernel's `kernel/command` point. Why they
exist: [plugin-architecture.md §2.6](../plugin-architecture.md#26-commands).

## Adding a command

```jsonc
// plugin.json
"kernel/command": [
	{
		"id": "say-hello",
		"title": "Say hello",
		"category": "Hello",
		"keybinding": "Mod+Shift+H",
		"when": { "all": ["kilo.workbench/sessionActive"] }
	}
]
```

```ts
// src/web/index.ts (or main: commands bind in any process)
sdk.extensions.implement(KernelCommand, "say-hello", async () => {
	await sdk.domains.get(Greetings)?.methods.greet({ name: "world" });
});
```

The command's id is `example.hello/say-hello`. Metadata fields:

| Field              | Meaning                                                                       |
| ------------------ | ----------------------------------------------------------------------------- |
| `title`            | Shown in the palette and Settings → Shortcuts                                 |
| `category`         | Heading it is grouped under; `order` sorts within it (lower first)            |
| `icon`             | Optional icon name                                                            |
| `keybinding`       | Default shortcut(s) — see below                                               |
| `palette`          | `false` keeps it out of the palette (default `true`)                          |
| `repeatable`       | Runs again while the key is held (default `false`)                            |
| `handledLocally`   | The owner handles the key itself (Enter in the composer): listed, never bound |
| `when`, `priority` | As for every contribution                                                     |

Run a command from code with `useKernel().commands.execute(id, args)` in
React (the handler gets `args`). A window can run a command that only main
or another window implements; the kernel forwards it.

Implement a command in the window when it acts on that window (its open
session, its focus); in main when it doesn't depend on a window.

## Keybindings

- A chord is modifiers and a key joined with `+`: `Mod+K`, `Ctrl+Shift+G`,
  `Mod+,`, `Shift+Tab`. `Mod` is ⌘ on macOS and Ctrl elsewhere.
- Per platform: `{ "mac": "Mod+B", "default": "Ctrl+B" }` (`mac`,
  `windows`, `linux`, `default`). Several alternatives: an array.
- People can rebind or turn off any shortcut in Settings → Shortcuts.
- Two commands without `when` that want the same default chord: the first
  keeps it and the clash is reported there. A command **with** a `when`
  shares the chord and wins while its condition holds — that is how a
  focused pane gets ⌘K without fighting the app.
- Shortcuts work in every window, including pop-outs.

## `when`

`when` hides or disables a contribution without running plugin code:

```jsonc
"when": { "all": ["kilo.workbench/sessionActive", "kilo.workspaces/vcs"], "none": ["kernel/secondaryWindow"] }
```

Every key in `all` must be true and every key in `none` false. Keys are
qualified (`<owner>/<key>`); an unknown or unset key is false, so a
condition on a removed plugin's key simply doesn't hold.

### Context keys

| Key                                                              | Scope  | True while                                             |
| ---------------------------------------------------------------- | ------ | ------------------------------------------------------ |
| `kernel/desktop`, `kernel/mac`, `kernel/windows`, `kernel/linux` | global | Running as the desktop app / on that OS                |
| `kernel/safeMode`                                                | global | The app started in safe mode                           |
| `kernel/secondaryWindow`                                         | window | This window is a pop-out                               |
| `kilo.account/signedIn`, `kilo.account/termsAccepted`            | global | Signed in to Kilo / terms accepted                     |
| `kilo.flags/flag:<name>`                                         | global | The feature flag is on                                 |
| `kilo.workspaces/hasWorkspaces`, `kilo.workspaces/vcs`           | global | A workspace exists / git is available                  |
| `kilo.workbench/sessionActive`, `kilo.workbench/workspaceActive` | window | A session is open / the list is focused on a workspace |
| `kilo.chat/composerFocused`, `kilo.terminal/terminalFocused`     | window | That element has keyboard focus                        |

### Owning a key

A plugin declares the keys for concepts it owns and sets them:

```jsonc
"contextKeys": [{ "id": "hasTodos", "scope": "global", "description": "True while any todo is open." }]
```

```ts
sdk.context.set("hasTodos", todos.length > 0); // local name; only the owner can set it
```

- `global` keys are set in main and mirrored to every window; `window` keys
  are set in a window and only exist there (focus, the open session).
- Read keys with `useContextKey("acme.todos/hasTodos")` in React, or
  `sdk.context.get` / `sdk.context.evaluate(when)` in code.
- A key id ending in `*` declares a family (`flag:*`).
