# Embed nteract notebooks in Agentic Desktop

## Goal

Give each Kilo chat an nteract notebook in its right panel. The notebook, the user, and agents join
the same daemon-owned Automerge document and runtime state. A saved notebook can be reopened by
another nteract client without creating a competing daemon or a private copy of the live document.

## System boundary

Agentic Desktop ships the nteract web application as a static plugin asset. It does **not** ship,
install, spawn, supervise, stop, or upgrade `runtimed`. For the demo and initial beta, the user must
already have the supported singleton daemon running. Installation belongs to a separate product
workstream.

The notebook frame receives one capability-scoped Electron `MessagePort`:

```text
trusted app renderer
  -> feature SDK opens notebook/host port
  -> notebook plugin main process authorizes one native relay session
  -> @runtimed/node connects to the singleton Unix socket
  -> runtimed owns notebook state, kernels, execution, outputs, and persistence
```

The frame never receives `ipcRenderer`, a generic IPC endpoint, the daemon socket path, room
discovery, a relay token, or a WebSocket address. Runtime frames stay opaque while crossing the
Electron port and retain runtimed's negotiated protocol number.

## Product flow

1. Kilo creates or restores a notebook tab for a chat session.
2. The stable tab instance id becomes the daemon `notebook_id`.
3. The plugin opens one relay peer with a label derived from the Kilo session.
4. nteract edits and executes the shared live document.
5. Save writes through runtimed's typed save protocol. Save As first asks Agentic Desktop for a
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
- Missing or incompatible runtimed fails closed with a prerequisite message. There is no bundled
  fallback daemon and no transport fallback to a listening WebSocket.

## Release order

1. Merge the nteract Electron host and publish the stable `@runtimed/node` version containing
   `@runtimed/node/electron`.
2. Resolve that published version in Agentic Desktop and commit the generated lockfile.
3. Run the full repository gate and packaged Electron smoke against an installed singleton.
4. Verify execution, Save, Save As, reopen, reconnect, concurrent attachment, and isolated rich
   output before promoting the plugin from draft.

## Current limitations

- The plugin reports how to install/start runtimed but does not perform installation.
- Opening a notebook in another desktop window and cloning a sidecar notebook are explicitly
  unsupported host operations rather than silent no-ops.
- Blob content still uses runtimed's loopback HTTP server. Moving blobs behind the custom protocol
  could further tighten the notebook CSP later; runtime frames already use only the MessagePort.

See [embedding-decisions.md](./embedding-decisions.md) for the durable decisions and rejected
alternatives. The remaining handoff documents preserve the earlier spike history and are marked
when their loopback-WebSocket or bundled-daemon designs are superseded.
