# Chat and agent tools

Two plugins own the agent: **kilo.agent** (model, main process: the Kilo
server, chats, the tool gateway) and **kilo.chat** (UI: the agent pane,
transcript and composer). Their points let a plugin give the agent tools,
shape how calls look, and add controls to the composer. Contracts:
`@kilo-desktop/plugin-agent/contracts` and
`@kilo-desktop/plugin-chat/contracts`.

## Agent tools (`kilo.agent/tool`)

A tool is a contribution whose implementation runs in **main**. The gateway
offers it to Kilo chats and, unless `external: false`, to paired external AI
apps.

```jsonc
// plugin.json
"requires": { "kilo.agent/tool": "optional" },
"contributes": {
	"extensions": {
		"kilo.agent/tool": [
			{ "id": "greet", "title": "Say hello", "readOnly": false }
		]
	}
}
```

```ts
// src/main/index.ts
import { AgentTool, defineTool } from "@kilo-desktop/plugin-agent/contracts";

sdk.extensions.implement(
	AgentTool,
	"greet",
	defineTool({
		description: "Greet someone by name and return the greeting.", // what the model reads
		input: z.object({ name: z.string().min(1).describe("Who to greet.") }),
		run: async ({ name }, context) => {
			if (!context.sessionId) throw new Error("Call this from a Kilo chat.");
			return { greeting: await greetings.greet(name) };
		},
	}),
);
```

- Kilo sees the tool as `desktop_<plugin>_<id>` with `kilo.` dropped
  (`kilo.terminal/open` → `desktop_terminal_open`; `example.hello/greet` →
  `desktop_example_hello_greet`).
- Input is validated against `input` before `run`. Return any JSON value;
  throw to fail the call (the message goes back to the agent).
- `context`: `sessionId` (the calling chat's Work Session, or null),
  `chatId`, `callId`, `external`, and an abort `signal`. Act on the calling
  session, never on whatever the person has focused.

| Metadata                  | Meaning                                                               |
| ------------------------- | --------------------------------------------------------------------- |
| `title`                   | Shown on the tool call ("Open terminal")                              |
| `approval`                | `ask` makes chats ask before each call (default `auto`)               |
| `requiresSignIn`          | Refused while signed out of Kilo; `signInPrompt` sets the card's copy |
| `readOnly`, `destructive` | Hints for approval and presentation                                   |
| `external`                | Offered to paired external AI apps (default `true`)                   |

Expose the same action as a domain method and, if a person would use it, a
command — all three calling one function.

### Shaping chats (main)

| Point                       | Kind | Use it to                                                                                                                    |
| --------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| `kilo.agent/session-config` | A    | `configure({ sessionId, workspaceId, directory })` → `{ disableTools, instructions, permissions }` for a session's new chats |
| `kilo.agent/tool-approval`  | D    | Answer `"proceed"`, `{ ask }` or `{ reject }` per tool call; fails closed                                                    |
| `kilo.agent/runtime-config` | A    | Add environment variables, Kilo plugins or MCP servers to the Kilo server                                                    |
| `kilo.agent/model-provider` | A    | Add a model provider to Kilo's config                                                                                        |

## How tool calls look (`kilo.chat/tool-renderer`)

By default a call shows as one line with its title. To draw a card instead:

```jsonc
"kilo.chat/tool-renderer": [{ "id": "greet", "tools": ["desktop_example_hello_greet"], "standalone": false }]
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

- `tools` are the names Kilo calls them by (built-in tools such as `bash`
  too). The highest-priority renderer for a tool draws it and gets the next
  one as `Original` — render it to wrap or decorate the default.
- `standalone: true` keeps calls out of activity groups (cards that stay
  actionable); `category` puts them in a built-in group (`editing`,
  `terminal`, `web`…).
- kilo.chat ships its own renderers through this point.

Related renderer points: `kilo.chat/interaction-renderer` (details and
policy on permission and question cards), `kilo.chat/mcp-app` (interactive
MCP App widgets for a tool's calls) and `kilo.chat/markdown-extension`
(remark plugins and link decorators for replies, e.g. file links).

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
| `view`    | `{ kind, Component }` drawn as-is (git's branch label)   |

`use…` functions run as hooks while the composer shows, so they can read
your domain objects. `context` has `sessionId`, `chatId` (null for a
draft), `directory`, `workspaceId` and `workspaceFolders`. Slots:
`toolbar`, `toolbar-end`, `footer` (under an Agent pane's composer, from
before its first message) and `draft-footer` (under the New Session page's
composer, before there is a session).

### Mentions (`kilo.chat/composer-mention`)

Typing a trigger lists what your source finds; a chosen item becomes a chip
and is resolved into the message when it is sent:

```jsonc
"kilo.chat/composer-mention": [{ "id": "todos", "trigger": "#", "title": "Todos" }]
```

```ts
sdk.extensions.implement(ComposerMention, "todos", {
	search: async (query, { sessionId, signal }) =>
		(await todos.find(query, signal)).map((todo) => ({ id: todo.id, label: todo.title })),
	resolve: async (item) => ({ text: `Todo ${item.label}: ${await todos.body(item.id)}` }),
});
```

`resolve` returns `text` to put in the item's place and/or `files` to send
with the message. The trigger is one character other than `/` (slash
commands).

### Driving the composer

The per-window `kilo.chat/composer` domain object has `focus`, `insert`
(append text to a session's composer, e.g. "Fix in chat") and
`startNewChat({ text, workspaceId })`. kilo.chat may be absent — hide such
actions when `sdk.domains.get(Composer)` is null.

Local model servers reach the model picker through
`kilo.chat/model-source`; see kilo.local-inference for a full example.
