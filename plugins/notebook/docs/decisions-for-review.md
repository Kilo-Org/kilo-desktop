# Notebook integration — decisions to review

Audience: engineers reviewing the production Electron integration. The implemented choices and
their rejected alternatives are recorded in [embedding-decisions.md](./embedding-decisions.md).
This page contains only decisions that still need an owner or release confirmation.

## Before merging the nteract dependency

### Supported daemon protocol

Record the minimum supported runtimed protocol number and any semantic capabilities the notebook
host requires. Compatibility must be based on the wire contract, not an exact source commit. A
missing required capability should disable only the affected feature and leave the user's running
singleton untouched.

### Default channel for beta

The integration currently targets the nightly singleton for the demo and accepts an explicit
development socket override. Decide when the internal beta changes its default to stable. This is a
distribution decision; it must not introduce daemon ownership into the plugin.

## Before promoting the Agentic Desktop PR

### Packaged application proof

Run the packaged app against a real installed singleton and verify:

- a Kilo chat creates and restores its own notebook tab;
- two clients can attach to the same notebook id;
- Python execution and output updates survive reconnect;
- Save and Save As write through runtimed and reopen the same document;
- interactive Plotly/Vega-style output renders only in the isolated output frame;
- closing a tab or quitting Agentic Desktop does not stop the singleton.

### Bundled runtime failure experience

Confirm the exact retryable message shown when the bundled daemon cannot start or the running
singleton is incompatible. Agentic Desktop must not instruct users to install a second daemon or
attempt to displace the process holding the singleton lock.

### Blob transport follow-up

The notebook CSP currently permits loopback HTTP for runtimed's content-addressed blob server.
Decide whether beta accepts that narrow exception or requires serving blobs through the custom
protocol. This does not affect runtime-frame transport, which already uses the transferred
MessagePort exclusively.

## Decisions already closed

- Depend on the exact registry release `@runtimed/node@0.5.0`; do not vendor, source-build, or use a
  Git dependency for the Electron adapter.
- Reuse a compatible running singleton; only start the bundled daemon when the canonical endpoint
  is idle.
- Use protocol numbers and semantic capabilities, not commit equality.
- Transfer one scoped Electron MessagePort; expose neither generic IPC nor a WebSocket relay.
- Keep the notebook application and untrusted rich output on distinct CSP profiles.
- Keep Save As path selection in the Electron host and notebook bytes in runtimed's typed protocol.
