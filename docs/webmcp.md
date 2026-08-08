# WebMCP

> Feature tools → external MCP clients, over a local, unauthenticated relay.

The app is a WebMCP **producer**: every tool a plugin registers through `sdk.tools` can be surfaced to any AI agent running on the same machine — Kilo CLI, Claude Desktop, Cursor, `mcp-inspector`, etc. — with no CDN, no network, no cloud.

For the _consumer_ path (the app talks to the Anaconda Remote MCP), see [Kilo Code integration](./kilo-code-integration.md).

Related code:

- `packages/feature-sdk/src/services/tool-registry.ts` — the registry `sdk.tools` writes to.
- `apps/web/src/platform/webmcp/installWebMcp.ts` — the bridge.
- `apps/web/scripts/sync-webmcp-assets.mjs` — self-hosts the relay assets.
- `apps/desktop/src/main/platform/ElectronProtocol.ts` — CSP + widget-probe 404.

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

- `apps/web/scripts/sync-webmcp-assets.mjs` copies `embed.js` + `widget.html` from the pinned `@mcp-b/webmcp-local-relay@4.0.0` package into `apps/web/public/webmcp/`, verifying each file's `sha256`.
- The renderer injects `<script src="/webmcp/embed.js" data-relay-host="127.0.0.1">`.
- `embed.js` normally builds a `blob:` iframe with an inline config script — incompatible with our hash-based CSP. `ElectronProtocol.ts` returns **404** for the widget-probe `fetch("/webmcp/widget.html")`, forcing `embed.js` down the direct same-origin iframe path whose inline script _is_ covered by the per-response hash.
- CSP additions (both dev and packaged):

  ```
  frame-src 'self';
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
- 🔒 Third-party relay code is pinned exact (`4.0.0`) and verified by `sha256` at build time; no CDN.
- 🔒 CSP allows only same-origin frames and loopback WebSockets in the relay's port range.
- 🔒 Widget-probe 404 keeps every relay resource same-origin, so the hash-based CSP holds.
- ⚠️ `readOnlyHint` is metadata for clients, **not** enforcement — the tool handler is what actually runs. Author accordingly.

---

## 7. Interim: default `kilo serve` bridge

> **Interim.** This section documents an interim mechanism that lets the
> bundled `kilo serve` see the app's WebMCP tools out of the box. The
> longer-term plan — a native `type: "webmcp"` MCP transport in Kilo Code
> that removes the subprocess and the fuse regression — is tracked in
> [anaconda/agentic-desktop#102](https://github.com/anaconda/agentic-desktop/issues/102).

External MCP clients (Claude Desktop, Cursor, `mcp-inspector`) spawn
`@mcp-b/webmcp-local-relay` themselves as an stdio MCP subprocess (their
config points at `npx @mcp-b/webmcp-local-relay@latest` or a locally
installed copy). The bundled `kilo serve` is the odd one out — we ship and
control it and want zero end-user configuration.

The interim ships `@mcp-b/webmcp-local-relay` inside the packaged app,
seeds an `mcp["anaconda-desktop-relay"]` entry into the app-owned
`kilo.jsonc`, and spawns the relay by running Anaconda Desktop's own
executable in Node mode (`ELECTRON_RUN_AS_NODE=1`).

### Target topology

```
┌───────────────────────────── Electron main process ────────────────────────────────┐
│                                                                                    │
│  kilo-server plugin                                                                │
│                                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │ 1. mainRegister() — awaited seed step (idempotent, sidecar-tracked)         │   │
│  │                                                                             │   │
│  │    defaultRunAsNodeEnabled(process.execPath)  ──► reads @electron/fuses    │   │
│  │                                                    → true / false           │   │
│  │                                                                             │   │
│  │    resolveWebMcpRelayEntry()  ───►  ${app}/resources/app.asar.unpacked/     │   │
│  │                                       node_modules/@mcp-b/webmcp-local-     │   │
│  │                                       relay/dist/cli.mjs                    │   │
│  │                                                                             │   │
│  │    seedKiloMcpConfig(${runtime}/config/kilo/, {                             │   │
│  │      // written to kilo.jsonc (Kilo's canonical file, JSONC-tolerant)      │   │
│  │      mcp: {                                                                 │   │
│  │        "anaconda-desktop-relay": {                                          │   │
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
│  │    Sidecar: ${runtime}/config/kilo/.anaconda-desktop-managed.json           │   │
│  │      { "version": 1, "managed": ["anaconda-desktop-relay"] }                │   │
│  │                                                                             │   │
│  │    When RunAsNode is disabled (downgrade / rollback), seed instead REMOVES │   │
│  │    the managed entry and prunes the sidecar.                               │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
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
│  │      → Relay listens WS on 127.0.0.1:9333 AND speaks MCP over stdio         │   │
│  │        with its parent (kilo serve)                                         │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
│                                        │                                           │
│                                        │ stdio MCP                                 │
│                                        ▼                                           │
│                            ┌────────────────────────┐                              │
│                            │  kilo serve (child)    │                              │
│                            │  sees `anaconda-desktop-│                             │
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
│    <iframe /webmcp/widget.html>   ── ws://127.0.0.1:9333 ──►  relay (above)       │
│                                                                                   │
└───────────────────────────────────────────────────────────────────────────────────┘
```

Three new pieces beyond §1's diagram:

- **Seed step** in `plugins/kilo-server/src/main/seed-kilo-mcp-config.ts` writes
  an `mcp` block into the app-owned `kilo.jsonc` before `KiloServerManager#start`
  runs. Idempotent, JSONC-preserving (`jsonc-parser`), atomic (`atomically`).
  When the runtime fuse detection reports `RunAsNode` off, the same call
  **removes** any managed entry it previously wrote and prunes the sidecar,
  so downgrade / rollback / fuse re-hardening self-heals.
- **Ownership sidecar** at `${runtime}/config/kilo/.anaconda-desktop-managed.json`
  tracks which MCP entry names we own. Kilo never opens this file — Kilo's
  top-level `Config` schema is `additionalProperties: false`, so any marker
  stored inside `kilo.jsonc` would fail validation and stop `kilo serve` from
  starting. Missing sidecar (deleted by user, corrupt, or absent) = "we own
  nothing" = escape hatch.
- **Bundled relay entry** — the same `@mcp-b/webmcp-local-relay@4.0.0` package
  that `apps/web/scripts/sync-webmcp-assets.mjs` reads for its browser assets
  is now also unpacked from asar (see `apps/desktop/forge.config.ts`) so its
  `bin/cli.mjs` has a real filesystem path, and it is launched via
  `process.execPath` + `ELECTRON_RUN_AS_NODE=1`. The sync script asserts at
  build time that `apps/web`, `plugins/kilo-server`, and the resolved
  installed package all pin the exact same version.

### Boot sequence (cold start)

```
Time ─►

 t0   Electron ready
       │
 t1    plugins/kilo-server mainRegister() runs
       │  ├─ defaultRunAsNodeEnabled()        (reads fuses off process.execPath)
       │  ├─ resolveWebMcpRelayEntry()        (fs check, logs+skips if missing)
       │  └─ await seedKiloMcpConfig()        (JSONC merge + sidecar write)
       │       │
       │       ├─ RunAsNode enabled → seed managed entry + record in sidecar
       │       └─ RunAsNode disabled → remove any managed entry + prune sidecar
       │
 t2    KiloServerManager.ensureRunning()      (only after t1 completes)
       │  └─ spawn kilo serve
       │
 t3    kilo serve boots
       │  ├─ reads XDG_CONFIG_HOME/kilo/kilo.jsonc
       │  └─ sees mcp["anaconda-desktop-relay"]
       │
 t4    kilo serve spawns the relay subprocess
       │  command = process.execPath          (Anaconda Desktop binary)
       │  args    = [relay.js]
       │  env.ELECTRON_RUN_AS_NODE = "1"     ← makes Electron behave as node
       │
 t5    relay.js binds ws://127.0.0.1:9333
       │  and holds stdio open for MCP framing with kilo serve
       │
 t6    Renderer boots, installWebMcp() runs
       │  └─ injects embed.js → widget iframe scans 9333–9348
       │     └─ finds the relay from t5, opens WS, exchanges handshake
       │
 t7    Widget publishes the current ToolRegistry snapshot over WS
       │  Relay forwards the tool list over stdio to kilo serve
       │
 t8    Kilo shows the tools under `anaconda-desktop-relay` in its MCP list
       READY
```

The seed is **awaited** before `ensureRunning`. `kilo serve` cannot read the
config file before the atomic rename lands.

Key ordering guarantee: the relay is a **child of `kilo serve`**, not of the
shell. If Kilo restarts (`KiloServerManager.restart()`), Kilo tears down and
re-spawns the relay for us — no extra lifecycle wiring in `kilo-server`.

### Runtime — a Kilo agent calls a plugin tool

```
Kilo agent LLM
   │  "call todos_list()"
   ▼
kilo serve  ── stdio JSON-RPC ─►  relay.js
                                     │
                                     ▼  WS frame
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
Before seeding (user's kilo.jsonc, if any):    After seeding:

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
  }                                                "anaconda-desktop-relay": {       ← added
}                                                    "type": "local",
                                                     "command": [
                                                       "/Applications/Anaconda…/MacOS/Anaconda Agentic Desktop",
                                                       "/…/app.asar.unpacked/node_modules/@mcp-b/webmcp-local-relay/dist/cli.mjs"
                                                     ],
                                                     "environment": { "ELECTRON_RUN_AS_NODE": "1" },
                                                     "enabled": true
                                                   }
                                                 }
                                               }

                                                 .anaconda-desktop-managed.json   ← sidecar (new)
                                                 ──────────────────────────────
                                               {
                                                 "version": 1,
                                                 "managed": ["anaconda-desktop-relay"]
                                               }
```

Rules:

1. **Only** `mcp["anaconda-desktop-relay"]` is written inside `kilo.jsonc`.
   Every other top-level key, every sibling MCP entry, and every JSONC
   comment / formatting quirk is preserved by `jsonc-parser`'s `modify()`
   API. Ownership tracking never leaks into `kilo.jsonc` because Kilo's
   top-level `Config` schema rejects unknown keys.
2. Overwrite only if the entry's name is listed in the sidecar's
   `managed` array. If the user deleted the sidecar or removed the entry
   from the list, we **do not resurrect** the managed entry — that is the
   escape hatch.
3. Writes are atomic (via `atomically`).
4. Absolute paths are recomputed on every boot so app upgrades /
   relocations self-heal.
5. If the existing `kilo.jsonc` is unparseable (invalid JSONC, or top-level
   not an object), we **refuse to write** and return `skipped-error` —
   never clobbering user data. The sidecar is never touched in that case.
6. When the sidecar's `managed` list becomes empty (last managed entry
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

- Seeded relay args: `--port 9345 --relay-id anaconda-agentic-desktop`
  (`WEBMCP_RELAY_PORT` / `WEBMCP_RELAY_ID` in
  `plugins/kilo-server/src/main/seed-kilo-mcp-config.ts`). Fixed-port mode
  refuses to chain to a non-relay owner; 9345 is far from the 9333 default
  foreign relays use, still inside the CSP-allowed range.
- Embed attributes: `data-relay-port="9345" data-relay-id="anaconda-agentic-desktop"`
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

Failure modes that remain (accepted for the interim):

- Two instances of the app (e.g. dev + packaged) share one relay on 9345:
  both widgets publish into whichever instance's relay won the port, and
  both kilos see the union of tools (tab-suffix disambiguation applies).
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
  #102 cleanup or accidentally), the seed detects the fuse state at boot and
  **removes** its previously-written managed entry, so users are not stranded
  with a bogus `command` pointing at a binary that no longer runs as Node.

The fuse flips back to `false` once #102 lands.

---

## 8. Follow-ups

- Split `exposeToModelContext` (or add a peer flag) so a plugin can expose a tool to an in-page assistant runtime without opting into the loopback relay.
- Manifest-driven declarative tool registration (Option B from issue #74) once a plugin has a reason to advertise tools without loading its web module.
- Optional per-tool consent / gating UI for destructive tools when a real in-app assistant lands.
