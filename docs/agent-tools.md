# Agent tools

> Plugin tools → the bundled Kilo agent and paired external AI apps, served by Desktop's main process.

Every tool a plugin registers through `sdk.tools` with `exposeToModelContext: true` is served
over MCP to the bundled `kilo serve`, and, when the user allows it, to external AI apps such as
Cursor, Claude Code, VS Code or `mcp-inspector`. Nothing outside Desktop can add, rename or
shadow a tool: the tool list comes only from the app's own renderer, over Electron IPC.

For the _consumer_ path (the app talks to the Anaconda Remote MCP), see
[Kilo Code integration](./kilo-code-integration.md).

Related code:

- `packages/feature-sdk/src/services/tool-registry.ts` — the registry `sdk.tools` writes to.
- `packages/feature-sdk/src/services/tool-catalog-protocol.ts` — renderer ↔ main wire protocol.
- `apps/web/src/platform/agent-tools/tool-catalog-publisher.ts` — renderer publisher.
- `plugins/kilo-server/src/main/tool-gateway/` — main-side catalog and MCP endpoints.
- `plugins/kilo-server/src/web/settings/ExternalAiAppsSettings.tsx` — Settings → External AI apps.

---

## 1. Architecture

```
┌──────────── Renderer (main window only) ────────────┐
│ plugin webRegister(sdk) → sdk.tools.register(def)    │
│        ▼                                             │
│ ToolRegistry ─► tool-catalog-publisher               │
│                   │ MessagePort kilo-server/tool-catalog (protocol v1);
│                   │ accepted only from kilo-desktop(-dev)://app frames
└───────────────────┼──────────────────────────────────┘
                    ▼
┌──────────────────── Electron main — kilo-server tool-gateway/ ─────────────────────┐
│ ToolCatalog   validated snapshot; duplicate names keep the first, never renamed;   │
│      │        calls routed back to the renderer over the port                      │
│      ├──────────────────────────────┐                                              │
│      ▼                              ▼                                              │
│ KiloToolEndpoint                    ExternalClients (off by default)               │
│ 127.0.0.1:<random>/mcp              127.0.0.1:<9350|9351|9352 or custom>/mcp       │
│ per-launch bearer token (env)       per-app bearer tokens, stored as hashes        │
│ Kilo view: caller envelope          external view: no caller context               │
└──────┼──────────────────────────────┼──────────────────────────────────────────────┘
       ▼ MCP Streamable HTTP          ▼ MCP Streamable HTTP
   kilo serve (mcp.desktop)        Cursor · Claude Code · VS Code · mcp-inspector · …
```

Both endpoints reject any request with an `Origin` header (browsers always send one, MCP clients
never do) and only bind loopback.

---

## 2. Registration

A plugin declares its tools from its **renderer** entry via the `webRegister` hook:

```ts
// plugins/todos/src/web/index.ts
export function webRegister(sdk: SDK): void {
	sdk.tools.register({
		name: "list",
		description: "List all todos.",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		annotations: { readOnlyHint: true },
		exposeToModelContext: true, // opt-in — see §3
		handler: () => sdk.invoke("list"),
	});
}
```

Namespacing is automatic: `list` becomes `todos.list` internally and `todos_list` on the wire
(Kilo shows it as `desktop_todos_list`). Names use only `[A-Za-z0-9_]`; two tools that sanitize to
the same name keep the first and the second is skipped with a warning. The plugin-facing
`SdkTools` surface is deliberately just `register` + read-only `all()` (see the docstring on
`SdkTools` in `packages/feature-sdk/src/types/sdk.ts`).

**Cross-plugin RPC uses `sdk.plugins.expose` / `sdk.plugins.get<T>` — never tools.**

### Chat pane tools

Tools that open content in a chat's pane layout (`notebook_open`, `files_open`,
`git_changes_open`, `browser_open`, `terminal_open`) are owned by the plugin that contributes the
tab. They share these rules:

- The calling chat is `context.kiloSessionId` (the Kilo caller envelope). It is never an argument
  and never the visually focused chat. A call without it fails — which is also what every
  external app gets, since external apps never carry caller context.
- Panes belong to the chat's work session, not the chat. Tools map the caller to its session with
  kilo-ui's `sessions.sessionIdOfChat(kiloSessionId)` and pass that session id to the other
  capabilities. A chat no session owns (such as a subagent's) gets no session, and the call fails;
  never use the Kilo session id as a session id.
- Tabs are opened through kilo-ui's `chatRightPanel` capability.
- Paths go through kilo-ui's `chatSessionWorkspace` capability, so a tool can only show what the
  session's own panes could show.
- The opener tools display content to the user. They never return file or page content, and
  `terminal_open` takes no command.

`terminal_list` and `terminal_read` are the one read path: the calling chat's Terminal tabs and a
plain-text tail of a tab's output. Nothing can write to a terminal. Output is untrusted and may
contain secrets.

---

## 3. Exposure and trust

| `exposeToModelContext` | Bundled Kilo agent | Paired external AI apps                     |
| ---------------------- | ------------------ | ------------------------------------------- |
| `false` (default)      | not served         | not served                                  |
| `true`                 | served             | served while "Allow external AI apps" is on |

- **Kilo** reaches tools with a per-launch token that only `kilo serve` receives. Consent for
  mutating tools is Kilo's permission rules plus the chat's approval cards (for example the
  per-action conda cards in `plugins/kilo-ui/src/web/chat/runtime/conda-tool-permissions.ts`).
  Because the tool list cannot be extended or renamed from outside, exact-name rules always match.
- **External apps** get the same tools, without Kilo caller context. Desktop does **not** prompt
  for their calls: approving actions is the external app's responsibility. Desktop's controls are
  the off-by-default switch, one revocable token per app, and loopback + `Origin` + `Host` checks.

Treat `exposeToModelContext: true` as _"usable by the built-in agent and by any app the user
pairs."_ If that is wrong for a tool, leave it off.

---

## 4. Renderer ↔ main catalog

`tool-catalog-publisher.ts` opens the `kilo-server/tool-catalog` port with `{ version: 1 }` and:

- sends one full snapshot (`{ type: "catalog", revision, tools }`) per registry change; changes in
  the same tick coalesce (a plugin registering many tools at boot produces one snapshot);
- runs `{ type: "call" }` messages through `ToolRegistry.invoke` with the context main supplies,
  and answers `{ type: "result" }` (results cross as plain JSON);
- discards the result of a call main cancelled. Handlers take no abort signal, so a cancelled
  tool keeps running.

`ToolCatalog` (main) keeps the latest valid snapshot and notifies endpoints only when the tool list
actually changed. A newly attached port (a reloaded window) replaces the old one; the old port's
pending calls fail with "outcome is unknown", so agents check state before retrying. After a
disconnect the last tools stay listed for a few seconds, so consumers do not see every tool vanish
and come back across a reload. Only the main window publishes; pane windows never do.

---

## 5. Kilo endpoint

`KiloToolEndpoint` (over the generic `McpHttpServer`) adapts Node `http` to the MCP SDK's
Web-standard Streamable HTTP transport. Every `kilo serve` restart opens new sessions, so each
session gets its own server; beyond 32 sessions the least recently used one is closed and its
client re-initializes. The Kilo view adds the `__anacondaDesktopKiloCaller` property to every
schema and lifts it out of the arguments into the handler's trusted context.

Config reconciliation (`plugins/kilo-server/src/main/webmcp-relay-config.ts`) writes a static
entry into the app-owned `kilo.jsonc` while the endpoint is serving, and removes it otherwise:

```jsonc
"desktop": {
  "type": "remote",
  "url": "{env:KILO_DESKTOP_WEBMCP_URL}",
  "oauth": false,
  "headers": { "Authorization": "Bearer {env:KILO_DESKTOP_WEBMCP_TOKEN}" }
}
```

The per-launch URL and token never touch disk: `KiloServerManager` sets both variables at every
spawn, strips inherited values, and the `KILO_` prefix is reserved so contributed env cannot set
them. Entries written by earlier builds (stdio relay children) are recognized and migrated. The
ownership sidecar `${runtime}/config/kilo/.kilo-desktop-ownership.json` tracks which MCP entries
Desktop owns; a missing sidecar means "Desktop owns nothing", which is the user's escape hatch.

Boot: kilo-server registration creates the gateway (registering the port handler), starts the
Kilo endpoint, reconciles the entry, then lets Kilo start lazily; `configReady` is awaited before
`ensureRunning`, so `kilo serve` never reads the config before the entry is written.

---

## 6. External AI apps

Settings → **External AI apps** (`kilo-server` settings contribution), behind the
`external-api-apps-settings` LaunchDarkly flag. With the flag off the section is hidden and, in
main, the endpoint never starts (even if it was enabled before), cannot be enabled, and accepts no
new pairings.

- **Allow external AI apps** — off by default. While on, `ExternalClients` listens on
  `127.0.0.1:<port>/mcp`. The default port is fixed per channel so pasted configs keep working:
  stable `9350`, preview `9351`, development `9352`; users can choose another. A busy port leaves
  the endpoint off with an error shown in Settings; nothing retries silently.
- **Paired apps** — apps can be paired only while the switch is on. Each app gets its own 256-bit
  token, shown once. The dialog starts with generic connection settings (Streamable HTTP, URL,
  `Authorization: Bearer` header); picking a client shows only that client's configuration:
  Cursor, Claude Code, Codex (`~/.codex/config.toml`), VS Code, or Claude Desktop (stdio-only, via
  the third-party `mcp-remote`). Desktop stores only the token's SHA-256. Removing an app closes its
  sessions immediately. Switching the endpoint off closes every session but keeps the paired apps.
- Requests must carry a paired token, no `Origin`, and a `Host` of the endpoint itself
  (`127.0.0.1:<port>` or `localhost:<port>`, a DNS-rebinding guard).
- `lastUsedAt` is persisted at most once a minute per app.

State changes are pushed to the Settings page as `kilo-server.external-clients-changed`.

---

## 7. Security checklist

- 🔒 Only the app renderer can contribute tools, over an IPC port the shell accepts solely from
  trusted app frames. No loopback socket accepts tool producers.
- 🔒 Both endpoints are loopback-only, bearer-protected and reject browser requests.
- 🔒 The Kilo token is per launch and passed only through `kilo serve`'s environment.
- 🔒 External access is off by default; tokens are per app, revocable, stored as hashes.
- 🔒 External apps never receive Kilo caller context, so session-bound tools refuse them.
- ⚠️ External apps can call every exposed tool, including environment changes, without a
  Desktop prompt. Their own approval settings apply. A token pasted into a client config file is
  readable by same-user processes; revoke it in Settings if in doubt.
- 🔒 Output from tools is untrusted input for the model, as with any MCP server.
