# Embed nteract notebooks in Kilo Desktop

## Goal

Give each Kilo chat an nteract notebook in its right panel. The notebook, the user, and agents join
the same daemon-owned Automerge document and runtime state. A saved notebook can be reopened by
another nteract client without creating a competing daemon or a private copy of the live document.

## System boundary

Kilo Desktop stages nteract's published, platform-independent notebook UI bundle and a pinned,
platform-specific `runtimed` executable as plugin assets. The release tag, UI archive checksum,
archive manifest, and native executable checksums all identify the same nteract build. During app
launch it probes that release channel's canonical endpoint in the background. A compatible daemon
already listening there is reused without taking ownership; otherwise the app starts and
supervises its bundled executable. It never searches `PATH`, replaces an existing singleton, or
signals a process it did not start.

Kilo loads a Desktop-managed TypeScript plugin that calls `@runtimed/node` directly in its Bun
process. Desktop contributes the exact native binding entry and daemon socket to Kilo's spawn
environment. There is no notebook MCP proxy or `runt` child process; `runtimed` remains the
notebook and kernel authority.

The notebook frame receives one capability-scoped Electron `MessagePort`:

```text
trusted app renderer
  -> feature SDK opens notebook/host port
  -> notebook plugin has already reused the shared daemon or started its bundled fallback
  -> notebook plugin main process authorizes one native relay session
  -> @runtimed/node connects to the singleton Unix socket
  -> runtimed owns notebook state, kernels, execution, outputs, and persistence
```

The agent path is separate and converges on the same singleton:

```text
Kilo plugin -> @runtimed/node -> runtimed
```

The frame never receives `ipcRenderer`, a generic IPC endpoint, the daemon socket path, room
discovery, a relay token, or a WebSocket address. Runtime frames stay opaque while crossing the
Electron port and retain runtimed's negotiated protocol number.

## Product flow

1. Kilo creates or restores a notebook tab for a chat session.
2. The stable tab instance id becomes the daemon `notebook_id`.
3. The plugin opens one relay peer with a label derived from the Kilo session.
4. nteract edits and executes the shared live document.
5. Save writes through runtimed's typed save protocol. Save As first asks Kilo Desktop for a
   sender-scoped native path, then sends that path through the same runtimed protocol.
6. Closing the tab closes only that peer. It does not stop the daemon or delete notebook state.

## Security model

- The app and notebook use separate custom-protocol origins.
- The notebook origin has the minimum CSP needed by the trusted nteract application, including
  WASM and the daemon's loopback blob server.
- Interactive output runs only in `output-frame.html`, under its own exact route-specific CSP.
- The output frame remains sandboxed with an opaque origin and without `allow-same-origin`.
- Native dialogs, safe external links, title changes, and focus events are narrow host methods
  scoped to the renderer that opened the feature port.
- Missing, failed, or incompatible runtimed fails closed with a retryable status. There is no
  transport fallback to a listening WebSocket.

## Release verification

1. Pin the notebook UI, `runtimed`, `runt`, and `nteract-mcp` to one nteract release and use that
   release's channel for the singleton endpoint and MCP proxy.
2. Keep Kilo Desktop pinned to the published `@runtimed/node@0.5.6` package containing
   `@runtimed/node/electron` and its platform-native optional dependencies.
3. Run the full repository gate and packaged Electron smoke both from a clean daemon state and
   against an already-running compatible singleton.
4. Verify execution, Save, Save As, reopen, reconnect, concurrent attachment, and isolated rich
   output before promoting the plugin from draft.

## Current limitations

- A daemon already running on the canonical endpoint takes precedence over the bundled fallback.
- The direct Kilo plugin exposes the intentionally small `notebooks_*` tool set; the existing
  WebMCP relay continues to own notebook-panel navigation tools.
- Opening a notebook in another desktop window and cloning a sidecar notebook are explicitly
  unsupported host operations rather than silent no-ops.
- Blob content still uses runtimed's loopback HTTP server. Moving blobs behind the custom protocol
  could further tighten the notebook CSP later; runtime frames already use only the MessagePort.

See [embedding-decisions.md](./embedding-decisions.md) for the durable decisions and rejected
alternatives. The remaining handoff documents preserve the earlier spike history and are marked
when their loopback-WebSocket or bundled-daemon designs are superseded.
