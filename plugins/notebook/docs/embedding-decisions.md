# Notebook embedding — decisions and the options not taken

Records _why_ the notebook embedding is shaped this way, including options that were considered
and rejected, so a later reader does not have to re-derive the tradeoffs.

## D1. The notebook bundle gets its own protocol **host**, not a path under `app`

Chosen: serve nteract's built SPA at `kilo-desktop://notebook/`, a second host on the
existing scheme. The app stays at `kilo-desktop://app/`.

**Why:** three problems a same-origin path would need solved all disappear rather than getting solved.

- nteract's Vite config sets `base: "/"`, so its `index.html` and lazy chunks reference
  **absolute** `/assets/...` paths. Our web renderer uses `base: "./"` but still emits an
  `assets/` directory. Under one host those two `assets/` trees have to be merged; the filenames
  are content-hashed so a collision is unlikely, but it would be silent. Separate hosts means
  separate roots and no patch to nteract's `base`.
- `/` already maps to `index.html` in `resolveRendererPath`, so a dedicated host needs **no
  directory-index fallback**, and `resolveRendererPath(root, "/settings/")` keeps resolving
  `undefined`.
- Separate origin means a separate CSP. The app's policy stays exactly as strict as it is today
  instead of absorbing `'wasm-unsafe-eval'` and `blob:` workers on nteract's behalf.

It also buys isolation we would otherwise have to argue about: the notebook document gets its own
storage partition (no access to the app origin's localStorage/IndexedDB), and `isTrustedRendererUrl`
matches `host === "app"` only, so the notebook frame cannot reach IPC. Neither is a change — both
fall out of the host boundary.

### Options not taken

**(a) Same-origin `/notebook/` path** — the original plan. Needs nteract's `base` patched
to `"./"` (or the handler rooted at the bundle dir), a directory-index fallback, and the
`resolveRendererPath` directory test inverted. The notebook document then shares an origin — and therefore
storage and IPC trust — with the app, and the app's CSP has to be loosened for nteract's needs.
Rejected: strictly more work for strictly weaker isolation.

**(b) `WebContentsView`** — its own session and CSP, sidestepping the parent policy entirely.
Genuinely cleaner isolation, but used nowhere in this repo today, and it costs manual bounds and
z-order management against the 56px custom titlebar: the notebook stops being positioned by our
React layout and starts being positioned by main-process arithmetic. `webviewTag: false` already
rules out `<webview>`. Rejected as premature — the host boundary gets most of the isolation for a
fraction of the cost. Still the right escape hatch if we later need a separate session (different
proxy, different permissions, or a partition we can clear independently).

## D2. The platform owns embedded-host CSP profiles

A feature contributes an `EmbeddedWebHost` (`host`, `root`, optional exact-path
`securityProfiles`) and does **not** supply a policy string. `ElectronProtocol.ts` owns the small
profile vocabulary and every resulting directive.

**Why:** a CSP is a security decision about untrusted-ish content, and features are the thing being
constrained. If the capability carried a `csp` string, the policy would be written by the party it
restrains — and once features become loadable plugins, a plugin could declare
`script-src *` and the platform would serve it.

## D3. Runtime bytes cross one transferred feature port

nteract's Electron host receives one `MessagePort` after an exact parent-window and parent-origin
handshake. The trusted app renderer obtains it through `sdk.ports.open("host", args)`; main validates
the feature, channel, arguments, and sender before passing its `MessagePortMain` to the notebook
plugin. The plugin authorizes one native `@runtimed/node/relay` session and binds both ends with
`serveElectronNotebookHost`.

Runtime protocol frames remain opaque and retain their negotiated protocol number. The iframe gets
no `ipcRenderer`, generic IPC, socket path, room discovery API, token, or WebSocket endpoint.
Discrete platform actions use the same port but are restricted to the public host method allowlist.

The generic `embeddedWebHost` capability contributes only static bundle ownership and exact
security-profile paths. Its collector remains a per-request thunk because protocol registration
precedes feature boot.

## D4. Loopback HTTP is blob transport only

The daemon's blob HTTP server binds an ephemeral port, so an exact-port CSP would make the policy a
function of the running sidecar.

Chosen: allow loopback HTTP for the daemon's content-addressed blob server. Runtime frames do not
use loopback HTTP or WebSockets; they use the transferred feature port. The notebook origin can
reach loopback blob URLs; the app origin still cannot.

Serving blobs from our own protocol would let this tighten to `'self'`, but it is gated on upstream
(see D9). Recorded here so the wildcard is understood as an interim position, not a runtime-frame
transport.

## D5. Rich outputs get one exact route-specific CSP

nteract emits `output-frame.html` and the Electron bootstrap supplies its host-served URL. The
notebook feature declares only that exact path as `active-untrusted-content`; the platform maps the profile
to a CSP that grants nteract's JavaScript and visualization renderers `'unsafe-inline'` and
`'unsafe-eval'`. The notebook shell does not gain either script grant, and the app origin remains
stricter still. The output iframe keeps nteract's opaque-origin sandbox without
`allow-same-origin`; the response intentionally omits `frame-ancestors` because Chromium rejects
self-framing custom-scheme documents after that sandbox makes the child origin opaque. nteract's
exact parent-window validation remains the message boundary.

The output profile deliberately omits inline-script hashes. CSP ignores `'unsafe-inline'` when a
hash or nonce is present, while nteract's JavaScript output renderer creates inline script elements
at runtime. Hashes remain required for static inline scripts on the app and notebook-shell
documents, where arbitrary dynamic output code is not part of the contract.

## D6. The app preserves the shared singleton and bundles the fallback executable

Chosen: probe the standard `runtimed` endpoint before starting anything. If a compatible daemon is
already listening, attach without taking process ownership. If the endpoint is idle, start the
pinned executable packaged with Kilo Desktop. The app never searches `PATH`, displaces an
existing daemon, or signals a process it did not start.

**Why:** the singleton remains the collaboration authority, while a fresh Kilo Desktop install
must have working notebooks without a separate runtime installation. "Prefer bundled" therefore
means prefer those bytes when a new process is needed—not prefer a second process over a live
singleton.

The ordering is load-bearing. The daemon lock is channel-scoped rather than socket-scoped, and a
lock loser can exit with code zero without binding. Readiness is therefore a successful daemon
query after a connect-first probe, never successful process creation. Concurrent notebook opens
share one start attempt. Clean shutdown stops only the child started by this app; external daemons
are left running.

Compatibility belongs to the wire contract: require a supported protocol number and the semantic
capabilities used by the client. Exact source revisions remain diagnostics, not admission policy.
Unknown optional capabilities are ignored; a missing required capability fails that feature closed
without displacing the running daemon.

## D7. Notebook is a plugin contribution to Kilo's chat right panel

Chosen: `kilo-ui` declares the `chat-right-panel-tab` zone and reads its live registry through
`useSdkContributions`. The notebook manifest contributes one stable `notebook` definition to
`kilo-ui/chat-right-panel-tab` through `contributes.zones`.
Kilo owns the add menu, creates a unique tab instance for every add action, persists that metadata
per chat session, and passes `{ sessionId, instanceId, title }` into the plugin component. Neither
plugin imports the other's source.

Each notebook instance is an ephemeral scratch document. The stable tab `instanceId` is a bare
UUID passed to nteract as `notebook_id` (via the existing `create_notebook` handshake with no
path). Prefixing the contribution definition id (e.g. `notebook.notebook:<uuid>`) breaks
interoperability with nteract / runt MCP tools, which look up the bare UUID. Closing a tab removes
Kilo's UI metadata and closes its relay peer; it does not stop the singleton, delete the
daemon-owned document, or remove a saved `.ipynb` file.

The old standalone `/notebook` page, route `sidecar` manifest field, built-in sidecar registry, and
generic split-page layout are removed. If the notebook plugin unloads while persisted tabs exist,
Kilo renders a closeable unavailable state until the contribution returns.

## D8. Kilo uses direct Node bindings for notebook tools

Chosen: bundle a Kilo plugin that loads the packaged `@runtimed/node` entry and connects to the
same socket as the embedded notebook. The notebook feature installs that plugin through
kilo-server's ownership-checked plugin capability and removes its previous Desktop-owned `runt`
and `notebooks` MCP entries only after installation succeeds.

This removes the `nteract-mcp` proxy, its `runt mcp` child, and their platform-specific staging
artifacts. Kilo remains responsible for tool permission prompts and lifecycle; `runtimed` remains
responsible for notebook state, kernels, outputs, dependencies, and persistence. The WebMCP relay
is retained separately for right-panel navigation tools.

## D9. The in-app browser blocks remote-embedded loopback; the daemon blob server stays on loopback HTTP

The daemon's loopback blob/output HTTP server is third-party, is not designed to be embedded by
remote origins, and cannot be hardened by spawn flags. Remote pages in the in-app browser
(`persist:kilo-desktop-browser`) must not be able to reach it.

Chosen: close the crossing at the partition, not the daemon. `ElectronBrowserHost.initialize()`
installs a `webRequest.onBeforeRequest` filter (`shouldCancelLoopbackRequest`) that cancels loopback
**sub-resources** (nested iframe / `fetch` / `img`) whose top-frame is a remote origin — the attack
shape. It allows a top-level navigation to loopback (the user's own dev server) and loopback
sub-resources whose top-frame is itself loopback (that server's same-origin assets), and fails closed
when the embedder is unknown. Loopback = `localhost`, `127.0.0.0/8`, `0.0.0.0`, `::1`, `::`,
`::ffff:127.0.0.1`. The notebook feature is unaffected — it renders over the custom protocol and the
feature port in the default session, not this partition.

Not the D4 custom-protocol migration: the loopback URL is minted inside nteract's prebuilt bundle from
`blobs.getPort`, and the host protocol exposes no resolver seam, so that remains upstream-gated.

Residual (informational, local-only): the daemon keeps listening; a same-user local process can still
reach it directly, crossing no new boundary. Hardening the server itself is upstream `runtimed` work.
