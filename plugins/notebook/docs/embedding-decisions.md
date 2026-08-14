# Notebook embedding — decisions and the options not taken

Companion to [embedding-handoff.md](./embedding-handoff.md). That doc tracks
_what is built_; this one records _why it is shaped this way_, including options that were
considered and rejected, so a later reader does not have to re-derive the tradeoffs.

## D1. The notebook bundle gets its own protocol **host**, not a path under `app`

Chosen: serve nteract's built SPA at `anaconda-agentic-desktop://notebook/`, a second host on the
existing scheme. The app stays at `anaconda-agentic-desktop://app/`.

**Why:** three problems the handoff listed as work all disappear rather than getting solved.

- nteract's Vite config sets `base: "/"`, so its `index.html` and lazy chunks reference
  **absolute** `/assets/...` paths. Our web renderer uses `base: "./"` but still emits an
  `assets/` directory. Under one host those two `assets/` trees have to be merged; the filenames
  are content-hashed so a collision is unlikely, but it would be silent. Separate hosts means
  separate roots and no patch to nteract's `base`.
- `/` already maps to `index.html` in `resolveRendererPath`, so a dedicated host needs **no
  directory-index fallback**, and the assertion at `ElectronProtocol.test.ts:168` that
  `resolveRendererPath(root, "/settings/")` resolves `undefined` stays true. The handoff planned
  to deliberately invert that test; it no longer has to.
- Separate origin means a separate CSP. The app's policy stays exactly as strict as it is today
  instead of absorbing `'wasm-unsafe-eval'` and `blob:` workers on nteract's behalf.

It also buys isolation we would otherwise have to argue about: the notebook document gets its own
storage partition (no access to the app origin's localStorage/IndexedDB), and `isTrustedRendererUrl`
matches `host === "app"` only, so the notebook frame cannot reach IPC. Neither is a change — both
fall out of the host boundary.

### Options not taken

**(a) Same-origin `/notebook/` path** — what the handoff planned. Needs nteract's `base` patched
to `"./"` (or the handler rooted at the bundle dir), a directory-index fallback, and the
`:168` assertion deliberately updated. The notebook document then shares an origin — and therefore
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
restrains — and once features become loadable plugins (Decision #10), a plugin could declare
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
function of the running sidecar — the handoff's stated reason to avoid the HTTP blob server
altogether.

Chosen: allow loopback HTTP for the daemon's content-addressed blob server. Runtime frames do not
use loopback HTTP or WebSockets; they use the transferred feature port. The notebook origin can
reach loopback blob URLs; the app origin still cannot.

This does **not** foreclose the better option. Step 8 of the handoff (serve blobs from our own
protocol via `blobStorePath()`/`resolveBlobPath`) remains available and would let this tighten to
`'self'`. Recorded here so the wildcard is understood as an interim position, not a runtime-frame
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

## D6. The app attaches to the user-owned singleton

Chosen: discover the standard `runtimed` endpoint and attach to the daemon already owned by the
user's nteract installation. Agentic Desktop does not package, install, spawn, stop, upgrade, or
replace the daemon. If it is absent, the notebook surface reports the prerequisite and offers a
retry path.

**Why:** the singleton is the collaboration authority. A user and multiple agents opening the same
`.ipynb` must join the same live Automerge document and daemon-owned runtime state, rather than
partitioning work across competing daemons. Runtime installation is a separate product concern and
is intentionally outside this plugin for the initial integration.

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
