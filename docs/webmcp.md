# WebMCP

> Feature tools → external MCP clients, over a local, unauthenticated relay.

The app is a WebMCP **producer**: every tool a plugin registers through `sdk.tools` can be surfaced to any AI agent running on the same machine — Kilo CLI, Claude Desktop, Cursor, `mcp-inspector`, etc. — with no CDN, no network, no cloud.

For the _consumer_ path (the app talks to the Anaconda Remote MCP), see [Kilo Code integration](./kilo-code-integration.md).

Related code:

- `packages/feature-sdk/src/services/tool-registry.ts` — the registry `sdk.tools` writes to.
- `apps/web/src/platform/webmcp/installWebMcp.ts` — the bridge.
- `apps/web/scripts/sync-webmcp-assets.mjs` — self-hosts the relay assets.
- `apps/desktop/src/main/platform/ElectronProtocol.ts` — CSP + security headers.

---

## 1. Architecture

```
┌────────────────────────── Renderer (app://) ──────────────────────────┐
│                                                                       │
│   Plugin `webRegister(sdk)`                                           │
│        │                                                              │
│        ▼                                                              │
│   sdk.tools.register(def)   ───▶   ToolRegistry (feature-sdk)         │
│                                          │                            │
│                                          │ subscribe                  │
│                                          ▼                            │
│                                     installWebMcp                     │
│                                          │  (filters exposeToModelContext)
│                                          ▼                            │
│                                 document.modelContext ◀── in-page AI ─┤ INTERNAL
│                                          │                            │
│                                          │ WebMCP polyfill            │
│                                          ▼                            │
│                                  <iframe /webmcp/widget.html>         │
│                                          │  (self-hosted, same-origin)│
└──────────────────────────────────────────┼────────────────────────────┘
                                           │ WebSocket
                                           ▼   ws://127.0.0.1:9333–9348
                            ┌──────────────────────────────┐
                            │ @mcp-b/webmcp-local-relay    │ (loopback, no auth)
                            └──────────────┬───────────────┘
                                           │ MCP over WebSocket
                                           ▼
                      ┌────────────────────────────────────────┐
                      │  Kilo CLI · Claude · Cursor · curl …   │ EXTERNAL
                      └────────────────────────────────────────┘
```

Tools flow left → right. The dashed loopback WebSocket is the trust boundary (see §3).

---

## 2. Registration

A plugin declares its tools from its **renderer** entry via the `webRegister` hook (runs at boot in both Electron and browser modes):

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

Namespacing is automatic: `list` becomes `todos.list` internally, and `todos_list` on the wire for MCP clients. The plugin-facing `SdkTools` surface is deliberately just `register` + read-only `all()` — see [ADR: `sdk.tools` is the AI adapter, not a cross-plugin RPC channel](../packages/feature-sdk/src/types/sdk.ts) (docstring on `SdkTools`).

**Cross-plugin RPC uses `sdk.plugins.expose` / `sdk.plugins.get<T>` — never tools.**

### Chat pane tools

Tools that open content in a chat's pane layout (`notebook_open`, `files_open`, `git_changes_open`, `browser_open`, `terminal_open`) are owned by the plugin that contributes the tab, so each one owns its tab metadata. They share these rules:

- The target chat is `context.kiloSessionId` (the Kilo caller envelope). It is never an argument and never the visually focused chat. A call without it fails.
- Tabs are opened through kilo-ui's `chatRightPanel` capability.
- Paths go through kilo-ui's `chatSessionWorkspace` capability. `resolvePath` maps an absolute or primary-relative path onto one of the chat's workspace folders (the worktree stands in for the primary folder), or returns null, so a tool can only show what the chat's own panes could show.
- The opener tools display content to the user. They never return file or page content, and `terminal_open` takes no command.

`terminal_list` and `terminal_read` are the one read path. They return the calling chat's Terminal tabs and a plain-text tail of a tab's output: the main process's capped transcript with escape sequences removed and carriage-return redraws collapsed (`plugins/terminal/src/main/sessions/plain-text.ts`). Nothing can write to a terminal. Output is untrusted and may contain secrets, and like every tool here it is reachable over the unauthenticated relay.

---

## 3. Trust model: internal vs external agents

```
┌──────────────────────── Renderer JS context ───────────────────────┐  ┌─────────────────────────┐
│                                                                    │  │ Any other local process │
│  In-page AI runtime        document.modelContext                   │  │  (127.0.0.1, unauthed)  │
│   (INTERNAL)  ──────read──▶   ▲     ▲                              │  │                         │
│                               │     │                              │  │  Kilo CLI · Claude ·    │
│                               │     └─── relay iframe ─── WS ──────┼──│  Cursor · curl …        │
│                               │                                    │  │  (EXTERNAL)             │
│                       Tool handler (plugin code)                   │  │                         │
└────────────────────────────────────────────────────────────────────┘  └─────────────────────────┘
                    ▲                          ▲
                    │                          │
              same memory,               different process,
              same trust                 no shared trust
```

|                   | **Internal** (in-page)              | **External** (via relay)                  |
| ----------------- | ----------------------------------- | ----------------------------------------- |
| Runs where        | The app's renderer JS context       | Any process bound to `127.0.0.1`          |
| Reaches tools via | `document.modelContext` directly    | Relay WebSocket → widget iframe → context |
| Auth              | App CSP + code signing + sandbox    | **None** (loopback-only by design)        |
| Examples          | Future in-page assistant-ui copilot | Kilo CLI, Claude Desktop, Cursor, `curl`  |

### `exposeToModelContext` — the opt-in switch

| Flag value        | Registered in `ToolRegistry`? | Reachable by any agent?                 |
| ----------------- | ----------------------------- | --------------------------------------- |
| `false` (default) | ✅                            | ❌ Not published anywhere               |
| `true`            | ✅                            | ✅ Published to `document.modelContext` |

The bridge in `installWebMcp.ts` publishes only opted-in tools:

```ts
const tools = registry.all().filter((tool) => tool.exposeToModelContext);
```

**Current caveat:** `document.modelContext` is the _sole_ consumer path, so `true` exposes to both an in-page runtime and the external relay. Splitting internal-only vs. external exposure is a documented follow-up.

**Rule of thumb:**

- `readOnlyHint` / non-destructive → set `exposeToModelContext: true`.
- Mutating / destructive / privileged → leave it off. Wire it through `sdk.plugins.expose` for cross-plugin use, or through an in-page runtime once one exists, but do **not** treat the loopback relay as a trust boundary.

Treat `exposeToModelContext: true` as _"publish to a loopback API with no auth."_ If that sentence makes you uneasy for a given tool, leave it off.

---

## 4. Self-hosted relay

The relay is `@mcp-b/webmcp-local-relay`, but **not** loaded from a CDN.

- `apps/web/scripts/sync-webmcp-assets.mjs` copies `embed.js` + `widget.html` from the pinned `@mcp-b/webmcp-local-relay@5.1.0` package into `apps/web/public/webmcp/`, verifying each file's upstream `sha256` and then applying two reviewed, marker-guarded patches (a widget discovery-timeout bump, and the same-origin embed patch below).
- The renderer injects `<script src="/webmcp/embed.js" data-relay-host="127.0.0.1">`.
- **Patch — same-origin widget iframe (EoP 7).** Upstream v5 `embed.js` fetches `widget.html`, injects a per-tab dynamic `window.__WEBMCP_RELAY_CONFIG` inline `<script>`, and loads the result as a `blob:` iframe. A blob inherits the app-origin CSP, and that config script is per-tab (so it cannot be hash-allowlisted) — which forced `script-src 'unsafe-inline'` onto the trusted app origin that holds the preload bridge. The sync script patches `embed.js` to instead load a same-origin `webmcp/widget.html?<params>` document: the widget already reads its config from URL params (which `embed.js` already assembles), so there is no blob and no injected inline script. `widget.html` is served by `ElectronProtocol` with a per-response `'sha256-…'` for its bundled inline runtime, so it runs under the strict hash-based CSP with **no** `'unsafe-inline'`. (Dropping `'unsafe-inline'` without this patch was verified to break the relay in a packaged build.)
- `installWebMcp` overrides the read-only `originAgentCluster` global before initializing the polyfill: the custom-scheme page reports `false`, which makes the polyfill reject every `registerTool()` with a `SecurityError`. (Sending `Origin-Agent-Cluster: ?1` from the protocol handler instead wedges the Chromium browser process on the custom scheme — do not use the header.)
- CSP additions (both dev and packaged):

  ```
  frame-src 'self' blob:;
  frame-ancestors 'self';
  connect-src … ws://127.0.0.1:9333 ws://127.0.0.1:9334 … ws://127.0.0.1:9348;
  ```

  IPv6 loopback (`ws://[::1]:*`) is deliberately absent — Chromium rejects bracketed IPv6 in CSP `connect-src` and the relay + embed both use `127.0.0.1`.

Result: **no third-party code fetched at runtime, works offline, verified at build time.**

---

## 5. Lifecycle

- `sdk.tools.register` returns an `unregister()`; the SDK also cleans up automatically on feature teardown (`teardownFeature`).
- `installWebMcp` subscribes to the registry; every register / unregister re-syncs `document.modelContext`. Descriptor changes (name, description, schema, annotations) re-publish the tool so external clients see the update.
- Only the shell — via `services.toolRegistry.invoke(featureId, name, args)` — ever executes a tool on behalf of an agent. Plugin code never calls tools programmatically.

---

## 6. Security posture (checklist)

- 🔒 Relay binds loopback (`127.0.0.1`) only. Never exposed to a network interface.
- 🔒 No auth on the relay by design — any local process running as the user can see exposed tools. Opt-in via `exposeToModelContext` is the enforcement point.
- 🔒 Only the app renderer (`kilo-desktop://app`, `kilo-desktop-dev://app`) may register **tool sources**. The in-process rendezvous passes this allowlist (`WEBMCP_TOOL_SOURCE_ORIGINS`), overriding the relay library's `["*"]` default, so a web page in the user's browser cannot inject tools the agent sees. The check keys on the browser-set `Origin` header; it does not authenticate local processes (see the bullet above).
- 🔒 The bundled `kilo serve` does not use the unauthenticated rendezvous. It reaches the tools through the main process's MCP endpoint (§7), which requires a per-launch bearer token and rejects browser requests.
- 🔒 The `RunAsNode` fuse is off: nothing runs the app binary as Node.
- 🔒 Third-party relay code is pinned exact (`5.1.0`) and verified by `sha256` at build time; no CDN.
- 🔒 The relay widget runs as a **same-origin** `webmcp/widget.html?<params>` iframe (patched off the upstream `blob:` approach) under the app's hash-based CSP — no `'unsafe-inline'`. Relay code stays pinned and same-origin-served; only loopback WebSockets in the relay's port range are connectable. `blob:` frames remain allowed only for the non-custom-scheme MCP App fallback.
- ⚠️ `readOnlyHint` is metadata for clients, **not** enforcement — the tool handler is what actually runs. Author accordingly.

---

## 7. Bundled `kilo serve` bridge

External MCP clients (Claude Desktop, Cursor, `mcp-inspector`) start
`@mcp-b/webmcp-local-relay` themselves as a stdio MCP subprocess, which joins
the rendezvous below. The bundled `kilo serve` is different: Desktop ships and
controls it, and it should see the app's tools with zero configuration.

Desktop's main process therefore serves the tools to Kilo directly over
standard MCP **Streamable HTTP**. Nothing runs the app binary as Node, so the
`RunAsNode` fuse is off (#102).

### Topology

```
┌──────────────────────────────── Electron main process ─────────────────────────────────┐
│ kilo-server plugin — WebMcpRelayService                                                │
│                                                                                        │
│   RelayBridgeServer  ws://127.0.0.1:9345  ◄── renderer widget (tool source)            │
│        │             (rendezvous; tool sources restricted to the app renderer origin;  │
│        │              external relay children join here too)                           │
│        │ shared registry                                                               │
│        ▼                                                                               │
│   WebMcpHttpEndpoint  http://127.0.0.1:<random>/mcp                                    │
│        • Authorization: Bearer <per-launch token>, constant-time check                 │
│        • requests carrying an Origin header (browsers) → 403                           │
│        • one LocalRelayMcpServer per MCP session, over a view of the shared bridge     │
└────────┼───────────────────────────────────────────────────────────────────────────────┘
         │ MCP Streamable HTTP (POST + GET event stream)
         ▼
   kilo serve   mcp.desktop = { type: "remote", url: "{env:KILO_DESKTOP_WEBMCP_URL}",
                                oauth: false,
                                headers: { Authorization: "Bearer {env:KILO_DESKTOP_WEBMCP_TOKEN}" } }
                KiloServerManager sets both env vars at every spawn.
```

Pieces:

- **`WebMcpRelayService`** (`plugins/kilo-server/src/main/webmcp-relay-service.ts`)
  binds the fixed rendezvous port in server mode, then starts the endpoint. If
  another relay owns the port, neither starts. If only the endpoint fails, the
  rendezvous keeps serving external clients.
- **`WebMcpHttpEndpoint`** (`plugins/kilo-server/src/main/webmcp-http-endpoint.ts`)
  adapts Node `http` to the MCP SDK's Web-standard Streamable HTTP transport.
  `LocalRelayMcpServer` can connect to exactly one transport, and every
  `kilo serve` restart opens a new session, so each session gets its own server.
  Sessions see the bridge through a view whose `start`/`stop` are no-ops and
  whose subscriptions are released on close. Kilo opens one session per
  workspace directory; beyond a cap of 32, the least recently used session is
  closed, and a client whose session was evicted re-initializes. The tool names, descriptions and built-in relay tools are those
  of the relay library, unchanged from the earlier stdio child.
- **Config reconciliation** (`plugins/kilo-server/src/main/webmcp-relay-config.ts`)
  writes the static `mcp.desktop` entry above into the app-owned `kilo.jsonc`
  while the endpoint is serving, and removes it otherwise. The per-launch URL
  and token never touch disk: Kilo expands `{env:…}` in trusted config, and
  `KILO_CONFIG_DIR` is trusted. `KiloServerManager` strips inherited values of
  those variables, and the `KILO_` prefix is reserved, so contributed env cannot
  set them. Stdio relay entries written by earlier builds are recognized and
  migrated.
- **Ownership sidecar** at `${runtime}/config/kilo/.kilo-desktop-ownership.json`
  tracks which MCP entries Desktop owns and which feature source owns each one.
  Kilo never opens this file; its top-level `Config` schema is
  `additionalProperties: false`, so no marker may live inside `kilo.jsonc`. A
  missing sidecar means "Desktop owns nothing", which is the user's escape hatch.

### Boot sequence

```
t1  kilo-server mainRegister()
     ├─ WebMcpRelayService.start()
     │    ├─ RelayBridgeServer binds ws://127.0.0.1:9345 (server mode)
     │    └─ WebMcpHttpEndpoint binds http://127.0.0.1:<random>/mcp, new token
     └─ reconcileWebMcpRelayConfig(enabled = endpoint is serving)
t2  renderer widget connects to 9345 and publishes tools
t3  first chat connection lazily spawns kilo serve with
     KILO_DESKTOP_WEBMCP_URL / KILO_DESKTOP_WEBMCP_TOKEN
t4  Kilo initializes an MCP session, opens the event stream, lists tools
     (later tool changes arrive as tools/list_changed)
```

`configReady` is awaited before `ensureRunning`, so `kilo serve` never reads
the config before the entry is written. A Kilo restart opens a new MCP session;
the renderer stays attached to the in-process rendezvous.

### Runtime — a Kilo agent calls a plugin tool

```
kilo serve ── HTTP POST tools/call (Bearer) ─► WebMcpHttpEndpoint
                                                  │ bridge.invokeTool
                                                  ▼
                                 RelayBridgeServer ── WS invoke ─► widget iframe
                                                                       │ postMessage
                                                                       ▼
                                                         document.modelContext
                                                                       │
                                                                       ▼
                                          installWebMcp → ToolRegistry.invoke → plugin handler
```

### Config-file merge invariants

1. **Only** `mcp["desktop"]` is written inside `kilo.jsonc`. Every other key,
   sibling MCP entry and JSONC comment is preserved by `jsonc-parser`'s
   `modify()`.
2. Overwrite or remove only if the sidecar lists the entry as owned by the
   calling source. A user-owned `desktop` entry is never replaced.
3. Writes are atomic (via `atomically`).
4. An unparseable `kilo.jsonc` is never written (`skipped-error`); the sidecar
   is untouched in that case.
5. When the sidecar's owned list becomes empty, the sidecar file is deleted.

### Split-brain: why the rendezvous identity is pinned

The 9333–9348 loopback range is a **shared, unauthenticated rendezvous** used
by every WebMCP relay on the machine: Claude Desktop MCP configs, ad-hoc
`npx @mcp-b/webmcp-local-relay` runs, other apps. The widget scans that range
and pairs with the first relay that answers, so it is pinned to Desktop's own
rendezvous:

- Rendezvous: fixed `--port 9345`, relay id `kilo-desktop`
  (`WEBMCP_RELAY_PORT` / `WEBMCP_RELAY_ID` in `webmcp-relay-config.ts`).
  Fixed-port mode refuses to chain to a non-relay owner; 9345 is far from the
  9333 default foreign relays use, and still inside the CSP-allowed range.
- Embed attributes: `data-relay-port="9345" data-relay-id="kilo-desktop"`
  (`apps/web/src/platform/webmcp/installWebMcp.ts`). The widget rejects any
  relay whose `server-hello` carries a different relay id.
- Each channel has its own port and id (`9345` / `kilo-desktop` stable,
  `9346` / `kilo-desktop-preview`, `9347` / `kilo-desktop-dev`), so a dev and a
  packaged instance cannot cross-publish.

`installWebMcp` posts a `webmcp.connect` nudge into the widget every 15 seconds
as a guard for cold Electron startup and rendezvous restarts. A non-relay
process squatting exactly on 9345 leaves the rendezvous unstarted; Kilo then
runs without the app's tools rather than reading a foreign relay.

---

## 8. Follow-ups

- Split `exposeToModelContext` (or add a peer flag) so a plugin can expose a tool to an in-page assistant runtime without opting into the loopback relay.
- Manifest-driven declarative tool registration (Option B from issue #74) once a plugin has a reason to advertise tools without loading its web module.
- Optional per-tool consent / gating UI for destructive tools when a real in-app assistant lands.
