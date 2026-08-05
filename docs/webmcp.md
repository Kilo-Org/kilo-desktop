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

## 7. Follow-ups

- Split `exposeToModelContext` (or add a peer flag) so a plugin can expose a tool to an in-page assistant runtime without opting into the loopback relay.
- Manifest-driven declarative tool registration (Option B from issue #74) once a plugin has a reason to advertise tools without loading its web module.
- Optional per-tool consent / gating UI for destructive tools when a real in-app assistant lands.
