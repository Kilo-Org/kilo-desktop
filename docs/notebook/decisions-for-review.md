# Notebook integration — decisions to review

Audience: engineers reviewing the production Electron integration. The implemented choices and
their rejected alternatives are recorded in [embedding-decisions.md](./embedding-decisions.md).
This page contains only decisions that still need an owner or release confirmation.

## Before merging the nteract dependency

### Stable package version

Confirm the stable nteract release containing `@runtimed/node/electron`. Agentic Desktop should
depend on that registry version and commit the normally generated lockfile. Do not vendor a local
tarball or add a Git dependency as a release workaround.

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

### Runtime prerequisite experience

Installation is outside this plugin for the demo. Confirm the exact message and retry affordance
shown when runtimed is missing, stopped, or incompatible, and identify the team-owned installation
entry point that will replace the manual prerequisite for beta.

### Blob transport follow-up

The notebook CSP currently permits loopback HTTP for runtimed's content-addressed blob server.
Decide whether beta accepts that narrow exception or requires serving blobs through the custom
protocol. This does not affect runtime-frame transport, which already uses the transferred
MessagePort exclusively.

## Decisions already closed

- Reuse the user-owned singleton; never package or spawn a competing daemon.
- Use protocol numbers and semantic capabilities, not commit equality.
- Transfer one scoped Electron MessagePort; expose neither generic IPC nor a WebSocket relay.
- Keep the notebook application and untrusted rich output on distinct CSP profiles.
- Keep Save As path selection in the Electron host and notebook bytes in runtimed's typed protocol.
