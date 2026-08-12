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
  instead of absorbing `'wasm-unsafe-eval'`, `ws:`, and `blob:` workers on nteract's behalf.

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

## D2. The platform owns the embedded-host CSP; the feature only declares its root and routes

A feature contributes an `EmbeddedWebHost` (`host`, `root`, `routes`) and does **not** supply a
policy. `createEmbeddedContentSecurityPolicy` in `ElectronProtocol.ts` owns what an embedded
third-party bundle is allowed to do.

**Why:** a CSP is a security decision about untrusted-ish content, and features are the thing being
constrained. If the capability carried a `csp` string, the policy would be written by the party it
restrains — and once features become loadable plugins (Decision #10), a plugin could declare
`script-src *` and the platform would serve it.

## D3. The relay config endpoint is contributed as a capability, not wired in `Application.ts`

nteract's `createBrowserHost()` fetches `/__nteract_dev_relay/config` — a hardcoded, non-configurable
path — from its own origin. That endpoint has to come out of the protocol handler in `platform/`,
which must not import the notebook feature. So the notebook feature exposes an `embeddedWebHost`
capability in `mainRegister`, and `collectEmbeddedHosts` reads it back generically over the
`FEATURES` array.

**Why:** AGENTS.md rule 4 — never hand-edit `Application.ts` for feature-specific code — and
`sdk.plugins` (Decision #23) is the sanctioned main-side cross-boundary path. `Application.ts` gains
one line that names no feature.

The collector is a thunk evaluated per request, not a value snapshotted at registration, because
`protocol.register` runs before `bootFeatures` in `Application.start`.

### Option not taken

**Explicit option on `protocol.register`** — `Application.ts` passes
`{ notebookRoot, notebookConfig }` straight into `ElectronProtocol.register`. Meaningfully simpler
and easier to read, and there is exactly one consumer today so the generality is unearned. Rejected
because it puts a feature name in `Application.ts` and in `platform/`, which is the coupling the
feature-registry pattern exists to prevent. Worth revisiting if a second embedded host never
materializes and the indirection reads as ceremony.

## D4. `connect-src`/`img-src` use `http://127.0.0.1:*`, not the resolved blob port

The daemon's blob HTTP server binds an ephemeral port, so an exact-port CSP would make the policy a
function of the running sidecar — the handoff's stated reason to avoid the HTTP blob server
altogether.

Chosen: allow the loopback wildcard port, which is what nteract's own production Tauri CSP does
(`crates/notebook/tauri.conf.json`). The notebook origin can reach any loopback port; the app origin
still cannot reach any.

This does **not** foreclose the better option. Step 8 of the handoff (serve blobs from our own
protocol via `blobStorePath()`/`resolveBlobPath`) remains available and would let this tighten to
`'self'` plus the relay's `ws://`. Recorded here so the wildcard is understood as an interim
position, not an accepted end state.

## D5. Known gap: isolated output frames still cannot run plots

nteract renders rich outputs (plotly, vega, bokeh, panel) into an isolated iframe. In Tauri that
iframe loads from a dedicated `nteract-frame://` scheme; in browser mode it is a `srcdoc` document.
A `srcdoc` frame **inherits its parent's CSP**, and the parent policy has no `'unsafe-eval'`, so the
`<meta>` CSP inside `frame.html` (which does grant it) is intersected down and interactive
renderers stay blocked.

This is not a regression and not in scope for the protocol/CSP pair: text output, tracebacks, and
markdown work. Closing it means giving the output document its own origin — a third protocol host
mirroring `nteract-frame://` — which is a natural extension of D1 but a separate piece of work.

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
interoperability with nteract / runt MCP tools, which look up the bare UUID. Closing
a tab removes only Kilo's UI metadata; it does not create, save, restore, select, or delete an
`.ipynb` file.

The old standalone `/notebook` page, route `sidecar` manifest field, built-in sidecar registry, and
generic split-page layout are removed. If the notebook plugin unloads while persisted tabs exist,
Kilo renders a closeable unavailable state until the contribution returns.
