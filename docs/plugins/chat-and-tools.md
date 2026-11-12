# Chat and agent tools

**kilo.core** (data, main process) owns the Kilo server, its chats, models
and desktop tools; contracts: `@kilo-desktop/plugin-core/contracts`.
**kilo.chat** draws them: the chat pane (transcript, composer, tool calls,
permission and question cards); contracts:
`@kilo-desktop/plugin-chat/contracts`. Both may be absent — declare their
points `optional` in `requires`.

## Desktop tools (`kilo.core/tool`)

A tool is a contribution whose implementation runs in **main**. Kilo chats
can call it; with `external: true`, paired external AI apps can too.

```jsonc
// plugin.json
"requires": { "kilo.core/tool": "optional" },
"contributes": {
	"extensions": {
		"kilo.core/tool": [{ "id": "greet", "title": "Say hello" }]
	}
}
```

```ts
// src/main/index.ts
import { defineTool, Tool } from "@kilo-desktop/plugin-core/contracts";

sdk.extensions.implement(
	Tool,
	"greet",
	defineTool({
		description: "Greet someone by name and return the greeting.", // what the model reads
		input: z.object({ name: z.string().min(1).describe("Who to greet.") }),
		run: async ({ name }, context) => {
			if (!context.chatId) throw new Error("Call this from a Kilo chat.");
			return { greeting: await greetings.greet(name) };
		},
	}),
);
```

- Tool ids are snake_case `<verb>[_<object>]` (`open_file`). Kilo sees a
  tool as `desktop_<plugin>_<id>` with `kilo.` dropped (`toolWireName`).
- Input is validated against `input` before `run`. Return any JSON value;
  throw to fail the call (the message goes back to the agent).
- `context`: `chatId`, `workSessionId` and `workspaceId` (from the calling
  chat's stamp, null for external apps), `callId`, `external`, and an abort
  `signal`. Act on the calling work session, never on whatever the person
  has focused.

| Metadata                  | Meaning                                                               |
| ------------------------- | --------------------------------------------------------------------- |
| `title`                   | Shown on the tool call ("Open terminal")                              |
| `approval`                | `ask` makes chats ask before each call (default `auto`)               |
| `requiresSignIn`          | Refused while signed out of Kilo; `signInPrompt` sets the card's copy |
| `readOnly`, `destructive` | Hints for approval and presentation                                   |
| `external`                | Offered to paired external AI apps (default `false`)                  |

Expose the same action as a domain method and, if a person would use it, a
command — all three calling one function.

### Shaping chats and Kilo (main)

| Extension point             | Kind | Use it to                                                                                                                                                              |
| --------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kilo.core/chat-config`     | A    | `configure({ chatId, directory, workSessionId, workspaceId })` → `{ disableTools, instructions, permissions }` for a chat                                              |
| `kilo.core/tool-approval`   | D    | Answer `"proceed"`, `{ ask }` or `{ reject }` per tool call; fails closed                                                                                              |
| `kilo.core/ai-provider`     | A    | Add an AI provider entry (and the env it refers to) to Kilo's config                                                                                                   |
| `kilo.core/mcp-server`      | A    | Add an MCP server to Kilo: static `{ command, args, env }` in metadata (`${resources}` is resolved by the kernel to the contributor's own folder) or an implementation |
| `kilo.core/agent-extension` | A    | Add an agent, command, skill folder or Kilo plugin to Kilo, all data in metadata (`${resources}` is resolved by the kernel to the contributor's own folder)            |

## How tool calls look (`kilo.chat/tool-renderer`)

By default a call shows as one line with its title. To draw a card instead:

```jsonc
"kilo.chat/tool-renderer": [{ "id": "greet", "tools": ["example.hello/greet"], "standalone": false }]
```

```tsx
import { ToolRenderer, type ToolRendererProps } from "@kilo-desktop/plugin-chat/contracts";

sdk.extensions.implement(ToolRenderer, "greet", { component: GreetCard });

function GreetCard(props: ToolRendererProps) {
	const { result, status, Original } = props;
	if (status.type !== "complete") return <Original {...props} />; // the default while running
	return <Card>{(result as { greeting: string }).greeting}</Card>;
}
```

- `tools` name desktop tools by their `kilo.core/tool` contribution key
  (`example.hello/greet`, never the wire name) and Kilo's built-in tools by
  name (`bash`, `read`). The highest-priority renderer for a tool draws it
  and gets the next one as `Original` — render it to wrap or decorate the
  default.
- `ToolRendererProps` is kilo.chat's own shape (`toolCallId`, `toolName`,
  `args`, `argsText`, `result`, `isError`, `status` running / complete /
  incomplete / requires-action), not the chat library's or Kilo's types.
- `standalone: true` keeps calls out of activity groups and the settled
  turn's fold (cards that stay actionable); `category` puts them in a
  built-in group (`editing`, `terminal`, `web`…).
- kilo.chat ships its own renderers for Kilo's built-in tools through this
  point.

### Other transcript points

| Extension point                 | Use it to                                                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kilo.chat/mcp-app`             | Show an interactive MCP App widget (`resourceUri: "ui://…"`) for a tool's calls, matched like `tool-renderer`; `loadHtml` serves it from your plugin, else it is read from the tool's MCP server (`serverId`) |
| `kilo.chat/markdown-extension`  | Add remark plugins and component decorators to the agent's replies (file paths as links); made once per transcript from `{ workSessionId, workspaceFolders }`                                                 |
| `kilo.chat/permission-renderer` | Add details and policies to permission and question cards: `permissionTitle`, a `PermissionDetail` view, `allowAlways: false`, a question `optionWarning`                                                     |

A `permission-renderer` with `tools` (contribution keys) applies its
permission parts only to requests from those desktop tools — matched on
kilo.core's `PermissionRequest.toolKey`, never on wire names; without
`tools` it applies to every request.

## The composer

### Actions (`kilo.chat/composer-action`)

Buttons, menus, popovers or your own view in the composer:

```jsonc
"kilo.chat/composer-action": [
	{ "id": "say-hello", "slot": "toolbar", "kind": "action", "title": "Say hello", "command": "example.hello/say-hello" }
]
```

A `kind: "action"` with a `command` needs no code: clicking runs the
command. Otherwise implement it:

| `kind`    | Implementation                                           |
| --------- | -------------------------------------------------------- |
| `action`  | `{ kind, useButton?(context), run?(context) }`           |
| `menu`    | `{ kind, useMenu(context) → { items, value?, select } }` |
| `popover` | `{ kind, useTrigger?(context), Content }`                |
| `view`    | `{ kind, Component }` drawn as-is (a branch label)       |

`use…` functions run as hooks while the composer shows, so they can read
your domain objects. `context` has `workSessionId` (null on the New Session
page, where the first send creates the work session), `chatId` (null for a
draft), `directory`, `workspaceId` and `workspaceFolders`. Slots: `toolbar`,
`toolbar-end` (before send), `footer` (under a chat's composer in a work
session, from before its first message) and `draft-footer` (under the New
Session page's composer, before there is a work session). Actions are
ordered by priority, highest first; kilo.chat's attach, agent, model and
approval controls come through the point too.

### Mentions (`kilo.chat/composer-mention`)

Typing a trigger lists what your source finds; a chosen item becomes a chip
and is resolved into the message when it is sent:

```jsonc
"kilo.chat/composer-mention": [{ "id": "todos", "trigger": "#", "title": "Todos" }]
```

```ts
sdk.extensions.implement(ComposerMention, "todos", {
	search: async (query, { workSessionId, signal }) =>
		(await todos.find(query, signal)).map((todo) => ({ id: todo.id, label: todo.title })),
	resolve: async (item) => ({ text: `Todo ${item.label}: ${await todos.body(item.id)}` }),
});
```

`resolve` returns `text` to put in the item's place and/or `files` to send
with the message. The trigger is one character other than `/` (slash
commands).

### Slash commands (`kilo.chat/client-slash-command`)

The `/` menu lists the Kilo server's commands for the chat's folder (its
commands, skills and MCP prompts) and **client** commands: `kernel/command`s
that run in the window instead of being sent to the agent (`/compact`). The
plugin contributes the command; a `client-slash-command` entry places it in
the menu, and kilo.chat decides what it is given:

```jsonc
"kernel/command": [
	{ "id": "wave", "title": "Wave at the agent", "palette": false }
],
"kilo.chat/client-slash-command": [
	{ "id": "wave", "command": "acme.tools/wave", "name": "wave", "aliases": ["hi"] }
]
```

```ts
sdk.extensions.implement(
	KernelCommand,
	"wave",
	slashCommandHandler(({ chatId, directory, selection, running }) =>
		greet(chatId, selection.model),
	),
);
```

Picking the command in the menu, or sending a draft that starts with
`/wave` (or an alias), clears the composer and executes the command with a
`ClientSlashCommandContext` as its argument; arguments typed after the name
are ignored and nothing is sent. The context is the composer's (as for
actions) plus the pane's `selection` (agent, model, variant) and whether
the chat is `running`. `slashCommandHandler` checks it and hands it to the
function, which shows its own toasts for anything it refuses; a command
that throws is reported as `/wave failed`. The menu shows the placement's
`description`, or the command's title, and lists the placement only while
its command is available (implemented, its `when` holding).

The palette, keybindings and the app menu run commands without that
context, and `slashCommandHandler` ignores such runs, so declare a command
meant for `/` with `palette: false` and no keybinding.

As in Kilo's VS Code extension, client commands are listed first (Actions)
and hide a server command of the same name; aliases match when searching or
sending but never hide a server command, and a server command's exact name
wins over a client alias. Of two placements with one name, the higher
priority is kept.

A prompt template (text the agent runs, with `$ARGUMENTS`) is not a client
command: contribute it to `kilo.core/agent-extension` (`type: "command"`) so
the server lists and runs it.

### Driving the composer

The per-window `kilo.chat/composer` domain object has `focus` and `insert`
(append text to a work session's composer, e.g. "Fix in chat"; both open
the work session's Agent pane if it isn't shown, and default to the
window's open work session) and `startChat({ text, workspaceId })` (a new
work session with an Agent pane and the text in its composer, as the New
Session page does). kilo.chat may be absent — hide such actions when
`sdk.domainObjects.get(Composer)` is null. Unsent text lives in
`kilo.chat/drafts`.

The model picker reads kilo.core's `kilo.core/models`. A local model server
also contributes to `kilo.chat/model-source`: its rail in the picker, starting
it, and loading a model before a prompt.
