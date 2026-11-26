# Agent tools

> `kilo.core/tool` contributions → the bundled Kilo agent and paired external AI apps, served by
> kilo.core's tool gateway in the main process.

Every tool a plugin contributes to `kilo.core/tool` and implements in its **main** entry is served
over MCP to the bundled `kilo2 serve` and, when the user allows it, to external AI apps such as
Cursor, Claude Code, VS Code or `mcp-inspector`. Nothing outside the app's plugins can add, rename
or shadow a tool: the list comes only from the kernel's extension registry.

How to write one: [Chat and agent tools](./plugins/chat-and-tools.md#desktop-tools-kilocoretool).

Related code:

- `plugins/core/src/contracts/tools.ts` — the `tool` and `tool-approval` points, `toolWireName`,
  `defineTool`, `toolPermissionRules`.
- `plugins/core/src/contracts/external-apps.ts` — the `kilo.core/external-apps` domain object.
- `plugins/core/src/main/agent/tool-gateway/` — catalog, views, MCP endpoints, the `tool-gateway`
  daemon.
- `plugins/core/src/main/agent/conversations/chat-creation.ts` — the permission rules a chat is
  created with.
- `plugins/shell/src/web/external-apps/ExternalAiAppsSettings.tsx` — Settings → External AI apps.
- `plugins/terminal/src/main/agent-tools.ts` — an example contributor.

---

## 1. Architecture

```
┌──────────── Electron main — kilo.core tool-gateway daemon ──────────────────────┐
│ sdk.extensions.list(kilo.core/tool) ─► ToolCatalog                              │
│   (implemented in main; re-listed on point changes, announced only when what    │
│    clients see changed)                                                         │
│      ├──────────────────────────────┐                                           │
│      ▼                              ▼                                           │
│ KiloToolEndpoint                    ExternalClientsServer (flag; off by default)│
│ 127.0.0.1:<random>/mcp              127.0.0.1:<9350|9351|9352 or custom>/mcp    │
│ per-start bearer token (env)        per-app bearer tokens, stored as hashes     │
│ Kilo view: caller envelope →        external view: no caller context,           │
│   chat + its stamp                  only `external` tools                       │
└──────┼──────────────────────────────┼───────────────────────────────────────────┘
       ▼ MCP Streamable HTTP          ▼ MCP Streamable HTTP
   kilo2 serve (mcp.desktop)       Cursor · Claude Code · VS Code · mcp-inspector · …
```

Both endpoints reject any request with an `Origin` header (browsers always send one, MCP clients
never do) and only bind loopback.

---

## 2. Contributing a tool

Declare the tool in the manifest (presentation and policy) and implement it in main:

```jsonc
// plugin.json
"requires": { "kilo.core/tool": "optional" },
"contributes": { "extensions": { "kilo.core/tool": [
  { "id": "list", "title": "List terminals", "readOnly": true, "external": true }
] } }
```

```ts
// main entry
import { defineTool, Tool } from "@kilo-desktop/plugin-core/contracts";

sdk.extensions.implement(
	Tool,
	"list",
	defineTool({
		description: "List the Terminal tabs in the calling chat's pane layout …",
		input: z.object({}),
		run: async (input, context) => listFor(context.workSessionId),
	}),
);
```

Metadata: `title`, `approval` (`auto` | `ask`, default `auto`), `requiresSignIn` (with an optional
`signInPrompt` for the chat's sign-in card), `readOnly`, `destructive`, `external` (offered to
external apps, default false). The input is a zod object; the gateway serves
`z.toJSONSchema(input, { io: "input" })` and validates every call against it before `run`.

Names: `kilo.terminal/list` is `terminal_list` on the MCP server, which Kilo shows as
`desktop_terminal_list` (`toolWireName`); permission rules use that wire name. Two tools whose names
sanitize alike keep the first.

**Cross-plugin RPC uses domain objects and extension points — never tools.**

### Caller context

`run` receives `ToolCallContext`: `chatId`, `workSessionId` and `workspaceId` (the calling chat's
stamp), `callId`, `external` and an abort `signal`. Desktop's caller-context Kilo plugin (a Kilo
v2 server plugin whose `execute.before` tool hook edits the call's input) stamps every `desktop_*`
call with `__anacondaDesktopKiloCaller` (chat and call id); the gateway lists the key in its tool
schemas so Kilo's input validation keeps it, then strips it and reads the
chat's stamp from `kilo.core/chats` at call time (a subagent's chat has its root's). A chat without
a stamp gets `workSessionId: null`, as does every external app. Session-bound tools (opening
panes, reading terminals) refuse such calls; they never fall back to the visually focused work
session.

---

## 3. Exposure and trust

| Metadata          | Bundled Kilo agent               | Paired external AI apps                     |
| ----------------- | -------------------------------- | ------------------------------------------- |
| `external: false` | served                           | not listed, refused                         |
| `external: true`  | served                           | served while "Allow external AI apps" is on |
| `requiresSignIn`  | refused while signed out to Kilo | refused while signed out to Kilo            |

A signed-out person who answers kilo.chat's sign-in card with "Not now" declines the refused tool's
plugin (`Chats.declineSignInTools` on `kilo.core/chats`): that plugin's `requiresSignIn` tools
leave both lists, with a `tools/list_changed`, until they sign in or the app restarts.

- **Kilo** reaches tools with a per-start token only `kilo2 serve` receives. Consent for mutating
  tools is Kilo's permission rules, set when kilo.core creates a chat: an `ask` rule per
  `approval: "ask"` tool (`toolPermissionRules`), and per tool whatever `kilo.core/tool-approval`
  answers (`ask`, or `reject` for a deny rule). Tool wire names that `kilo.core/chat-config` turns
  off are denied too. Because the tool list cannot be extended or renamed from outside, exact-name
  rules always match.
- **External apps** get the `external` tools without caller context. Desktop does **not** prompt
  for their calls: approving actions is the external app's responsibility. Desktop's controls are
  the flag, the off-by-default switch, one revocable token per app, and loopback + `Origin` +
  `Host` checks.

---

## 4. Kilo endpoint

`KiloToolEndpoint` (over the generic `McpHttpServer`) adapts Node `http` to the MCP SDK's
Web-standard Streamable HTTP transport. Every `kilo2 serve` restart opens new sessions, so each
session gets its own server; beyond 32 sessions the least recently used one is closed and its
client re-initializes.

The `tool-gateway` daemon starts the endpoint at activation; `config-sync` waits for its first
start, then writes (or removes, if it failed) a static entry in the app-owned `kilo2.jsonc` and the
caller-context Kilo plugin (a directory in Desktop's managed plugin folder, listed in Kilo's inline
config):

```jsonc
"desktop": {
  "type": "remote",
  "url": "{env:KILO_DESKTOP_WEBMCP_URL}",
  "oauth": false,
  "headers": { "Authorization": "Bearer {env:KILO_DESKTOP_WEBMCP_TOKEN}" },
  "codemode": false
}
```

`codemode: false` keeps Desktop's tools out of Kilo v2's Code Mode, which otherwise offers an MCP
server's tools only as calls inside one `execute` tool: the chat's tool renderers, permission rules
and the caller-context plugin all key on the `desktop_<tool>` names.

The per-start URL and token never touch disk: `KiloServerManager` sets both variables at every
spawn, strips inherited values, and the `KILO_` prefix is reserved so contributed env
(such as `kilo.core/server-env`'s) cannot set them. A server spawned with another
endpoint (the daemon restarted) is restarted. The ownership sidecar
`<kilo.core storage>/agent/runtime/config/kilo2/.kilo-desktop-ownership.json` tracks which MCP
entries Desktop owns.

---

## 5. External AI apps

Settings → **External AI apps** (a kilo.shell settings section, AI group), behind the
`external-api-apps-settings` flag (`kernel/flag:external-api-apps-settings`). With the flag off the
section is hidden and the endpoint never starts (it stops when the flag goes off), cannot be
enabled, and accepts no new pairings. The state is the `kilo.core/external-apps` domain object;
only kilo.core and kilo.shell (which draws the settings page) may call its methods (pairing hands
out a token).

- **Allow external AI apps** — off by default. The default port is fixed per channel so pasted
  configs keep working: stable `9350`, preview `9351`, development `9352`; users can choose another.
  A busy port leaves the endpoint off with an error shown in Settings; nothing retries silently.
- **Paired apps** — apps can be paired only while the switch is on. Each app gets its own 256-bit
  token, shown once, with setup for a generic client, Cursor, Claude Code, Codex, VS Code or Claude
  Desktop (via `mcp-remote`). Desktop stores only the token's SHA-256. Removing an app closes its
  sessions immediately. Switching the endpoint off closes every session but keeps the paired apps.
- Requests must carry a paired token, no `Origin`, and a `Host` of the endpoint itself
  (`127.0.0.1:<port>` or `localhost:<port>`, a DNS-rebinding guard).
- `lastUsedAt` is persisted at most once a minute per app.
- Paired apps saved by earlier builds (kilo.agent's `external-clients.json`, origin's
  `kilo-server/external-clients.json`) are adopted once, when the service first starts.

---

## 6. Security checklist

- 🔒 Only plugins can contribute tools, through the kernel's extension registry in main. No socket
  accepts tool producers.
- 🔒 Both endpoints are loopback-only, bearer-protected and reject browser requests.
- 🔒 The Kilo token is per start and passed only through `kilo2 serve`'s environment.
- 🔒 External access is flag-gated and off by default; tokens are per app, revocable, stored as
  hashes; only kilo.core and kilo.shell's settings can pair or change it.
- 🔒 External apps never receive Kilo caller context, so session-bound tools refuse them.
- ⚠️ External apps can call every `external` tool without a Desktop prompt. Their own approval
  settings apply. A token pasted into a client config file is readable by same-user processes;
  revoke it in Settings if in doubt.
- 🔒 Output from tools is untrusted input for the model, as with any MCP server.
