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
- 🔒 Third-party relay code is pinned exact (`5.1.0`) and verified by `sha256` at build time; no CDN.
- 🔒 The relay widget runs as a **same-origin** `webmcp/widget.html?<params>` iframe (patched off the upstream `blob:` approach) under the app's hash-based CSP — no `'unsafe-inline'`. Relay code stays pinned and same-origin-served; only loopback WebSockets in the relay's port range are connectable. `blob:` frames remain allowed only for the non-custom-scheme MCP App fallback.
- ⚠️ `readOnlyHint` is metadata for clients, **not** enforcement — the tool handler is what actually runs. Author accordingly.

---

## 7. Interim: default `kilo serve` bridge

> **Interim.** This section documents an interim mechanism that lets the
> bundled `kilo serve` see the app's WebMCP tools out of the box. The
> longer-term plan — a native `type: "webmcp"` MCP transport in Kilo Code
> that removes the subprocess and the fuse regression — is tracked in
> #102.

External MCP clients (Claude Desktop, Cursor, `mcp-inspector`) spawn
`@mcp-b/webmcp-local-relay` themselves as an stdio MCP subprocess (their
config points at `npx @mcp-b/webmcp-local-relay@latest` or a locally
installed copy). The bundled `kilo serve` is the odd one out — we ship and
control it and want zero end-user configuration.

The interim ships a lockfile-pinned `@mcp-b/webmcp-local-relay` runtime inside
the packaged app's unpacked kilo-server plugin assets,
initializes an `mcp["desktop"]` entry into the app-owned
`kilo.jsonc`, runs the WebSocket rendezvous in Electron main, and lets Kilo
launch the package's CLI through Kilo Desktop's executable in Node mode
(`ELECTRON_RUN_AS_NODE=1`) for the stdio MCP transport.

### Target topology

```
┌───────────────────────────── Electron main process ────────────────────────────────┐
│                                                                                    │
│  kilo-server plugin                                                                │
│                                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │ 1. mainRegister() — awaited config reconciliation (idempotent, sidecar-tracked)         │   │
│  │                                                                             │   │
│  │    defaultRunAsNodeEnabled(process.execPath)  ──► reads @electron/fuses    │   │
│  │                                                    → true / false           │   │
│  │                                                                             │   │
│  │    resolveWebMcpRelayEntry()  ───►  ${app}/resources/webmcp-relay/          │   │
│  │                                       node_modules/@mcp-b/webmcp-local-      │   │
│  │                                       relay/dist/cli.mjs                     │   │
│  │                                                                             │   │
│  │    reconcileWebMcpRelayConfig(${runtime}/config/kilo/, {                             │   │
│  │      // written to kilo.jsonc (Kilo's canonical file, JSONC-tolerant)      │   │
│  │      mcp: {                                                                 │   │
│  │        "desktop": {                                          │   │
│  │          type: "local",                       ◄── Kilo's McpLocalConfig    │   │
│  │          command: [process.execPath, <relay entry>],                        │   │
│  │          environment: { ELECTRON_RUN_AS_NODE: "1" },                        │   │
│  │          enabled: true                                                      │   │
│  │        }                                                                    │   │
│  │      }                                                                      │   │
│  │      // Ownership marker written to a sidecar (see below); Kilo's           │   │
│  │      // top-level Config schema is additionalProperties:false, so nothing  │   │
│  │      // that is not part of Kilo's schema may live inside kilo.jsonc.      │   │
│  │    })                                                                       │   │
│  │                                                                             │   │
│  │    Sidecar: ${runtime}/config/kilo/.kilo-desktop-ownership.json               │   │
│  │      { "version": 3, "ownedEntryIds": ["desktop"] }                │   │
│  │                                                                             │   │
│  │    When RunAsNode is disabled (downgrade / rollback), initialization instead REMOVES │   │
│  │    the Desktop-owned entry and prunes the sidecar.                               │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
│                       │                                                            │
│                       ├─ WebMcpRelayService creates RelayBridgeServer in-process │
│                       └─ Electron main owns ws://127.0.0.1:9345               │
│                       │                                                            │
│                       ▼                                                            │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │ 2. KiloServerManager.ensureRunning()  ─►  spawn `kilo serve`                │   │
│  │                                              │                              │   │
│  │                                              ▼                              │   │
│  │                                    reads kilo.jsonc (JSONC-tolerant)        │   │
│  │                                    (Kilo never opens the sidecar)           │   │
│  │                                              │                              │   │
│  │                                              ▼                              │   │
│  │                                    for each mcp entry: spawn as MCP child   │   │
│  └──────────────────────────────────────────────┼──────────────────────────────┘   │
│                                                 │                                  │
│  ┌──────────────────────────────────────────────▼──────────────────────────────┐   │
│  │ 3. spawn(process.execPath, [<relay entry>],                                 │   │
│  │          env={ ELECTRON_RUN_AS_NODE: "1", ... })                            │   │
│  │                                                                             │   │
│  │      → Electron runs in headless Node mode, executes relay.js               │   │
│  │      → Fixed port is owned by Desktop main, so this relay joins it            │   │
│  │        in client mode and speaks MCP over stdio with kilo serve              │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
│                                        │                                           │
│                                        │ stdio MCP                                 │
│                                        ▼                                           │
│                            ┌────────────────────────┐                              │
│                            │  kilo serve (child)    │                              │
│                            │  sees `desktop-relay` as│                             │
│                            │  relay` as an MCP      │                              │
│                            │  server with N tools   │                              │
│                            └────────────┬───────────┘                              │
│                                         │                                          │
└─────────────────────────────────────────┼──────────────────────────────────────────┘
                                          │ REST + SSE
                                          ▼
┌─────────────────────────── Renderer (app://) ─────────────────────────────────────┐
│                                                                                   │
│    plugin.sdk.tools.register({ exposeToModelContext: true })                      │
│              │                                                                    │
│              ▼                                                                    │
│    ToolRegistry ──► installWebMcp ──► document.modelContext                       │
│                                             │                                     │
│                                             ▼                                     │
│    <iframe /webmcp/widget.html>   ── ws://127.0.0.1:9345 ──►  relay (above)       │
│                                                                                   │
└───────────────────────────────────────────────────────────────────────────────────┘
```

Four pieces beyond §1's diagram:

- **Relay config reconciliation** in `plugins/kilo-server/src/main/webmcp-relay-config.ts` writes
  an `mcp` block into the app-owned `kilo.jsonc` before `KiloServerManager#start`
  runs. Idempotent, JSONC-preserving (`jsonc-parser`), atomic (`atomically`).
  When the runtime fuse detection reports `RunAsNode` off, the same call
  **removes** any Desktop-owned entry it previously wrote and prunes the sidecar,
  so downgrade / rollback / fuse re-hardening self-heals.
- **Ownership sidecar** at `${runtime}/config/kilo/.kilo-desktop-ownership.json`
  tracks which MCP entry names Desktop owns and which feature source owns each
  entry. Kilo never opens this file — Kilo's
  top-level `Config` schema is `additionalProperties: false`, so any marker
  stored inside `kilo.jsonc` would fail validation and stop `kilo serve` from
  starting. Missing sidecar (deleted by user, corrupt, or absent) = "we own
  nothing" = escape hatch.
- **Bundled relay entry** — the same `@mcp-b/webmcp-local-relay@5.1.0` package
  that `apps/web/scripts/sync-webmcp-assets.mjs` reads for its browser assets
  is now also unpacked from asar (see `apps/desktop/forge.config.ts`) so its
  `bin/cli.mjs` has a real filesystem path, and it is launched via
  `process.execPath` + `ELECTRON_RUN_AS_NODE=1`. The sync script asserts at
  build time that `apps/web`, `plugins/kilo-server`, and the resolved
  installed package all pin the exact same version.
- **Main-owned rendezvous** in
  `plugins/kilo-server/src/main/webmcp-relay-service.ts` creates the package's
  public `RelayBridgeServer` directly in Electron main. Feature boot awaits
  its fixed `127.0.0.1:9345` bind before creating the renderer window, and
  plugin disposal stops it. Kilo stays lazy; its later MCP child joins the
  live server in client mode.

### Boot sequence (cold start)

```
Time ─►

 t0   Electron ready
       │
 t1    plugins/kilo-server mainRegister() runs
       │  ├─ defaultRunAsNodeEnabled()        (reads fuses off process.execPath)
       │  ├─ resolveWebMcpRelayEntry()        (fs check, logs+skips if missing)
       │  └─ await reconcileWebMcpRelayConfig()    (JSONC merge + ownership write)
       │       │
       │       ├─ RunAsNode enabled → write Desktop-owned entry + record in sidecar
       │       └─ RunAsNode disabled → remove any Desktop-owned entry + prune sidecar
       │
 t2    mainRegister awaits WebMcpRelayService.start()
       │  └─ RelayBridgeServer binds ws://127.0.0.1:9345 in-process
       │
 t3    Renderer widget connects to 9345 and publishes tools
       │
 t4    First chat connection lazily starts kilo serve
       │  └─ Kilo reads mcp["desktop"]
       │
 t5    Kilo spawns its relay subprocess
       │  └─ joins Desktop main's fixed-port server in client mode
       │     and proxies tools over stdio
       │
 t6    Kilo shows the tools under `desktop` in its MCP list
       READY
```

`configReady` is **awaited** before `ensureRunning`. `kilo serve` cannot read the
config file before the atomic rename lands.

Key ordering guarantee: Desktop main owns the WS rendezvous before the renderer
window is created and independently of Kilo's lazy MCP lifecycle. A Kilo
restart only replaces the stdio client; the renderer remains attached to the
in-process server.

### Runtime — a Kilo agent calls a plugin tool

```
Kilo agent LLM
   │  "call todos_list()"
   ▼
kilo serve  ── stdio JSON-RPC ─►  relay (client mode)
                                     │  WS relay-to-relay
                                     ▼
                       Electron main relay (server mode :9345)
                                     │  WS frame
                                     ▼
                          widget.html iframe (renderer)
                                     │
                                     ▼  postMessage (in-page)
                          document.modelContext.callTool("todos_list")
                                     │
                                     ▼
                          installWebMcp handler
                                     │  ToolRegistry.invoke("todos", "list", …)
                                     ▼
                          plugin todos web handler
                                     │  sdk.invoke("list")
                                     ▼
                          IPC feature:invoke → main handler → SQLite
                                     │
                                     ▼  result rides all the way back
                                (reverse path)
```

All hops except stdio↔WS already exist in this repo (§1). The stdio↔WS hop is
what the bundled relay adds.

### Config-file merge invariants

```
Before initialization (user's kilo.jsonc, if any):    After initialization:

  kilo.jsonc                                     kilo.jsonc
  ──────────                                     ──────────
{                                              {
  // Kilo global config.                         // Kilo global config.
  "$schema": "https://app.kilo.ai/config.json",  "$schema": "https://app.kilo.ai/config.json",
  "mcp": {                                       "mcp": {
    // user's own MCP servers                      // user's own MCP servers
    "my-custom": {                                 "my-custom": {                    ← untouched
      "type": "local",                               "type": "local",
      "command": ["python", "-m", "my_mcp"]          "command": ["python", "-m", "my_mcp"]
    }                                              },
  }                                                "desktop": {       ← added
}                                                    "type": "local",
                                                     "command": [
                                                       "/Applications/Kilo.app/Contents/MacOS/kilo-desktop",
                                                       "/…/resources/webmcp-relay/node_modules/@mcp-b/webmcp-local-relay/dist/cli.mjs"
                                                     ],
                                                     "environment": { "ELECTRON_RUN_AS_NODE": "1" },
                                                     "enabled": true
                                                   }
                                                 }
                                               }

                                                 .kilo-desktop-ownership.json       ← sidecar
                                                 ──────────────────────────────
                                               {
                                                 "version": 3,
                                                 "ownedEntryIds": ["desktop"],
                                                 "owners": { "desktop": "kilo-server" }
                                               }
```

Rules:

1. **Only** `mcp["desktop"]` is written inside `kilo.jsonc`.
   Every other top-level key, every sibling MCP entry, and every JSONC
   comment / formatting quirk is preserved by `jsonc-parser`'s `modify()`
   API. Ownership tracking never leaks into `kilo.jsonc` because Kilo's
   top-level `Config` schema rejects unknown keys.
2. Overwrite or remove only if the entry's name is listed in the sidecar's
   `ownedEntryIds` array and its recorded owner matches the calling source. This
   prevents one feature from replacing or deleting another feature's entry.
   Schema-v1 entries without an owner are adopted by their first successful
   post-upgrade write. If the user deleted the sidecar or removed the entry
   from the list, we **do not resurrect** the Desktop-owned entry — that is the
   escape hatch.
3. Writes are atomic (via `atomically`).
4. Absolute paths are recomputed on every boot so app upgrades /
   relocations self-heal.
5. If the existing `kilo.jsonc` is unparseable (invalid JSONC, or top-level
   not an object), we **refuse to write** and return `skipped-error` —
   never clobbering user data. The sidecar is never touched in that case.
6. When the sidecar's `ownedEntryIds` list becomes empty (last Desktop-owned entry
   removed), the sidecar file itself is deleted to keep the config
   directory tidy.

### Split-brain: why the relay identity is pinned

The 9333–9348 loopback range is a **shared, unauthenticated rendezvous** used
by every WebMCP relay on the machine — Claude Desktop MCP configs, ad-hoc
`npx @mcp-b/webmcp-local-relay` runs, other apps. Live inspection of a dev
machine found three orphaned npx relays (one weeks old) plus Claude Desktop's
WebMCP server, one of which owned port 9333.

Without identity pinning, two independent pairings race against that zoo:

- The **widget** scans `127.0.0.1`+`[::1]` × 9333–9348 and pairs with the
  FIRST relay that answers — often a foreign or orphaned relay on 9333.
- **Kilo's relay** (ours) binds the first free port, or silently joins a
  compatible foreign relay in client mode.

When the two land on different relays, the system splits: the widget
publishes tools into relay X while Kilo reads relay Y with **zero
producers**. Symptoms: "No WebMCP tools available" while the todo UI works
fine; tools that vanish after a renderer reload (the re-scan landed
elsewhere); machine-dependent, launch-order-dependent flakiness — and our
tools silently registering into a _foreign_ relay, where any MCP client
attached to it can call them.

Both halves are therefore pinned to each other:

- Desktop-provided relay args: `--port 9345 --relay-id kilo-desktop`
  (`WEBMCP_RELAY_PORT` / `WEBMCP_RELAY_ID` in
  `plugins/kilo-server/src/main/webmcp-relay-config.ts`). Fixed-port mode
  refuses to chain to a non-relay owner; 9345 is far from the 9333 default
  foreign relays use, still inside the CSP-allowed range.
- Embed attributes: `data-relay-port="9345" data-relay-id="kilo-desktop"`
  (`apps/web/src/platform/webmcp/installWebMcp.ts`). The widget rejects any
  relay whose `server-hello` carries a different relay id and keeps
  scanning until it finds ours.

The relay id is deliberately **stable** (not per-process): an orphaned relay
from a previous run (kilo does not reap MCP subprocesses on shutdown —
verified empirically) must still accept our widget's hello, so that its
first stdio notification to its dead parent EPIPE-terminates it; the live
relay then promotes itself to server mode on the freed port and the widget's
reconnect ladder finds it. A per-process id would leave the zombie holding
the port indefinitely.

**Boot-order race + reconnect nudge.** Desktop main starts the rendezvous
independently of Kilo's lazy MCP connection, preventing the multi-minute gap
where the widget scanned before any process owned 9345. `installWebMcp` also
posts a `webmcp.connect` nudge into the widget every 15 seconds as a secondary
guard for cold Electron startup, orphan takeover, and relay restarts. The
widget treats the nudge as a no-op while connected and immediate discovery
while dormant or disconnected.

Failure modes that remain (accepted for the interim):

- Two instances of the app (e.g. dev + packaged) used to share one relay on 9345. Each channel now pins its own port and relay id (`9345` /
  `kilo-desktop` for stable, `9346` / `kilo-desktop-preview`, `9347` /
  `kilo-desktop-dev`) so widgets and Kilo children cannot cross-publish.
- A non-relay process squatting exactly on 9345 puts the relay into a loud
  error state in Kilo's MCP UI (fixed-port mode throws) rather than a
  silent split-brain.

### Security cost of the interim

The interim requires `FuseV1Options.RunAsNode: true` in
`apps/desktop/forge.config.ts` so the packaged executable honors
`ELECTRON_RUN_AS_NODE=1`. This is a hardening regression against the specific
class of attacks where an adversary that has local shell execution but not
native-binary drop can turn our signed binary into a scripting engine.

Mitigating factors:

- Every other hardening fuse (`EnableNodeOptionsEnvironmentVariable: false`,
  `EnableEmbeddedAsarIntegrityValidation: true`, `OnlyLoadAppFromAsar: true`,
  `EnableCookieEncryption: true`) stays on.
- `kilo serve` already spawns arbitrary user-approved MCP subprocesses under
  our code-signing identity, which meaningfully weakens the fuse's guarantee
  for our threat model regardless.
- If a future build ships with `RunAsNode: false` (either intentionally as the
  #102 cleanup or accidentally), the initializer detects the fuse state at boot and
  **removes** its previously-written Desktop-owned entry, so users are not stranded
  with a bogus `command` pointing at a binary that no longer runs as Node.

The fuse flips back to `false` once #102 lands.

---

## 8. Follow-ups

- Split `exposeToModelContext` (or add a peer flag) so a plugin can expose a tool to an in-page assistant runtime without opting into the loopback relay.
- Manifest-driven declarative tool registration (Option B from issue #74) once a plugin has a reason to advertise tools without loading its web module.
- Optional per-tool consent / gating UI for destructive tools when a real in-app assistant lands.
