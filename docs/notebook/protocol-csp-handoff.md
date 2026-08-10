# Handoff: serve nteract's SPA from our protocol + CSP (handoff steps 3 & 4)

Status: **done.** Steps A–F are implemented, the gate is green
(`pnpm check && pnpm lint && pnpm format:check && pnpm test` — 445 desktop + 102 web tests; desktop
branch coverage 89.67%, web 81.73%, against an 80% threshold), and the packaged render is verified
end-to-end (see "Verified: the first packaged render works"). The `@smoke` suite is 6/6 in **both**
build configurations — with the daemon and bundle staged, and without, which is what CI runs.

Corrections to this plan's own text, found while implementing it:

- The gate is **80%** on all four coverage metrics (`vitest.coverage.shared.mjs`), not 90%.
- `NOTEBOOK_HOST` went in **`packages/contracts`** (`features/notebook.ts`), as Step D anticipated,
  because the renderer needs it too.
- Step E's asset logic went in `config/notebook-bundle-asset.ts` with `stage-notebook-bundle.ts` as
  the thin script, mirroring how `daemon-asset.ts`/`stage-daemon.ts` are split — the plan named only
  the script.
- `mainRegister` needed a **`resolveBundleRoot` test seam** alongside the existing
  `resolveDaemonBinary`, for the same reason: the default reads `app.getAppPath()`, so
  `mainRegister.integration.test.ts` cannot construct the feature without it.
- Unit tests must run with **cwd = `apps/desktop`**. The `$config` alias lives in that package's
  `vitest.config.ts`, so `pnpm vitest run <path>` from the repo root fails to resolve
  `$config/*.js` — a module-not-found error unrelated to the code under test.

Read first, in order:

1. [embedding-decisions.md](./embedding-decisions.md) — the six decisions (D1–D6)
   this plan implements, each with the option that was rejected and why. **Do not re-litigate these
   without reading it**; two of them invert what the older handoff plans.
2. [embedding-handoff.md](./embedding-handoff.md) — overall state. Note its
   sections 3 and 4 are the work described here, and its plan for those two sections is
   **superseded** by D1 (see "What changed vs. the old plan" below).

## The one-paragraph version

nteract's built SPA gets served from a **second host on our existing scheme** —
`anaconda-agentic-desktop://notebook/` alongside `anaconda-agentic-desktop://app/` — and the app
renderer iframes it. A separate host is a separate origin, which gets the notebook its own CSP
(looser: wasm, loopback ws, blob workers) while the app's policy stays exactly as strict as today.
The notebook feature contributes its bundle root and its config endpoint as an `embeddedWebHost`
capability; `ElectronProtocol` reads those back generically, so no feature name appears in
`platform/` or `Application.ts`.

## What changed vs. the old plan

The old handoff's steps 3 and 4 planned a same-origin `/notebook/` **path**. D1 chose a separate
**host** instead. Consequences for anyone following the old text:

| Old plan said                                                       | Now                                                                          |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Patch nteract's Vite `base: "/"` → `"./"`                           | **Not needed.** Absolute `/assets/...` resolve correctly under its own host. |
| Add a directory-index fallback for `/notebook/`                     | **Not needed.** `/` already maps to `index.html`.                            |
| Deliberately invert the assertion at `ElectronProtocol.test.ts:168` | **Do not touch it.** It stays true.                                          |
| Emit `frame-ancestors 'self'` for the notebook subtree              | Emit `frame-ancestors <app origin>` on the notebook **host**.                |
| App CSP absorbs `wasm-unsafe-eval` / `ws:` / blob workers           | Only the notebook origin gets those. App policy unchanged.                   |

The assertion at `ElectronProtocol.test.ts:65` (production CSP has `frame-ancestors 'none'`, no
`wss:`) also **stays true** for the app policy and must keep passing.

## Already landed (verify, don't redo)

All in `apps/desktop/src/main/platform/ElectronProtocol.ts`, purely additive — nothing calls the new
code yet, which is why the suite is still green:

- `.wasm` → `application/wasm` and `.ttf` → `font/ttf` added to `MIME_TYPES`. The wasm one is
  load-bearing: `WebAssembly.instantiateStreaming` rejects any other MIME type, and the bundle ships
  `assets/runtimed_wasm_bg-*.wasm`.
- `getDesktopOrigin(isDevelopment, host?)` — origin without the `/#/` suffix. `getDesktopUrl` now
  delegates to it.
- `EmbeddedWebHost` interface — `{ host, root, routes? }`.
- `createContentSecurityPolicy(developmentOrigin?, inlineScriptHashes?, frameOrigins?)` — third
  parameter appends `frame-src 'self' <origins>`. **Omitted when `frameOrigins` is empty**, so the
  default policy string is byte-identical to before.
- `createEmbeddedContentSecurityPolicy(appOrigin, inlineScriptHashes?)` — the notebook-origin
  policy. Read its docstring; every extra grant has a stated reason.

## What landed for each step

Steps A–F below are implemented as described, with the deltas noted above. Files added:
`platform/ElectronProtocol.ts` (extended), `features/registry/embedded-hosts.ts`,
`features/notebook/notebook-bundle-path.ts`, `config/notebook-bundle-asset.ts`,
`config/stage-notebook-bundle.ts`, plus tests for each. Two traps confirmed handled with tests that
fail if they regress:

- The thunk: `ElectronProtocol.test.ts` "reads contributed hosts per request" flips an array
  **after** `register()` and asserts the host becomes reachable — a snapshot fails it.
- The origin move: `mainRegister.integration.test.ts` "accepts a websocket from the notebook origin,
  not the app origin" asserts `://notebook` upgrades and `://app` gets 401.

The original step text is kept below as the specification each piece was built against.

### Step A — teach `ElectronProtocol` about embedded hosts

`apps/desktop/src/main/platform/ElectronProtocol.ts`.

`register()` gains one option:

```ts
readonly embeddedHosts?: () => readonly EmbeddedWebHost[];
```

**A thunk, not a value** — and this is the single easiest thing to get wrong. In
`Application.start`, `this.#protocol.register(...)` runs at line ~81 but `bootFeatures` runs later
(inside `#registerIpc`, line ~88). A snapshotted array is empty forever. Evaluate it per request.

Then in the `protocol.handle` callback, the host check at line ~145 (`requestUrl.host !== DESKTOP_HOST`)
stops being a bare rejection and becomes a three-way branch:

1. `host === DESKTOP_HOST` → today's behavior, unchanged, except the CSP call now passes the
   embedded hosts' origins as `frameOrigins`.
2. `host` matches a contributed `EmbeddedWebHost` → serve from that host's `root`, with
   `createEmbeddedContentSecurityPolicy`. Check `routes` **before** the filesystem: if
   `requestUrl.pathname` is an exact key, call it and return `Response.json(await it())`. If
   `root` is `undefined`, 404 (an expected state — this build ships no bundle).
3. anything else → 404, as today.

Three things to get right:

- **Dev-mode proxying must not apply to embedded hosts.** The `isDevelopment && developmentOrigin`
  branch at line ~149 currently fires for any host that passed the check. It must stay scoped to
  the app host, or notebook asset requests get proxied to the web Vite server and 404 there.
- **`withSecurityHeaders` takes a policy, not a flag.** It currently hardcodes
  `createContentSecurityPolicy(...)`. Refactor it to accept the already-built policy string (or a
  builder taking the inline hashes), since which of the two policies applies is decided by the
  caller. Keep the existing HTML-inline-hash extraction working for both.
- **The 404 responses need a policy too.** Pick the one matching the host that was requested.

Recommend a small pure helper (`findEmbeddedHost(hosts, host)`) so the branch is unit-testable
without going through `protocol.handle`.

### Step B — collect the capability

New file `apps/desktop/src/main/features/registry/embedded-hosts.ts`:

```ts
export function collectEmbeddedHosts(): readonly EmbeddedWebHost[];
```

Reads `featureRouter.capabilityRegistry.get(id)` across `FEATURES`, picks out an `embeddedWebHost`
key, validates its shape, and returns the valid ones. Skip and warn on a malformed contribution
rather than throwing — one bad plugin must not take down the protocol handler. Note this file is in
`features/registry/`, which already imports both `FEATURES` and the router, so it introduces no new
coupling; `ElectronProtocol` stays free of it because `Application.ts` passes the thunk in.

Then `Application.ts` gains exactly one line inside the existing `register` call:

```ts
embeddedHosts: collectEmbeddedHosts,
```

Passing the function itself, not calling it. No feature name appears.

### Step C — the notebook feature contributes its host

`apps/desktop/src/main/features/notebook/index.ts` — in `mainRegister`, after the relay exists:

```ts
mainSdk.plugins.expose("embeddedWebHost", {
  host: NOTEBOOK_HOST,
  root: resolveNotebookBundleRoot({ isPackaged: app.isPackaged, ... }),
  routes: { [CONFIG_PATH]: () => relay.config() },
});
```

`relay.config()` already returns exactly the JSON `createBrowserHost()` wants (`websocket_url`,
`token`, `blob_port`, `daemon`) and already starts the relay on demand — so the first asset fetch
does not bind the port, but the config fetch does. That is the behavior you want and it needs no
change.

Two supporting pieces:

- `NOTEBOOK_HOST = "notebook"` — export it from the feature (the renderer needs it too, so consider
  the contracts package instead; see Step D).
- New `notebook-bundle-path.ts`, mirroring `daemon-binary-path.ts` almost exactly: packaged →
  `path.join(process.resourcesPath, "notebook")`; unpackaged → the staged dir under `app.getAppPath()`.
  Returns `undefined` when absent, same "not an error" contract. Electron values passed in as
  arguments, not imported, so it unit-tests without Electron.

Also update `relay`'s `allowedOrigin`: it is currently `${scheme}://app`, but after this change the
WebSocket is opened by a document on `${scheme}://notebook`, so the origin check would reject every
connection. **This is the failure that will look like "the daemon is broken" if you miss it** — the
symptom is a 401 on upgrade, surfaced to the UI as an unavailable daemon.

### Step D — the view frames it

`apps/web/src/features/notebook/NotebookView.tsx` currently reads `VITE_NTERACT_ORIGIN` and frames
nteract's dev server, falling back to a placeholder. Change the `src` to the notebook origin on the
same scheme the app is running under, keeping the `VITE_NTERACT_ORIGIN` path as the browser-mode
escape hatch (browser mode has no custom protocol at all, so it still needs it).

The renderer cannot read `app.isPackaged`, so it cannot derive the scheme — but it does not need to:
`window.location.origin` already carries the right scheme, so build the notebook origin by
substituting the host. Put that in a tested helper rather than inline in JSX. Add `?path=` for the
scratch notebook as today.

Keep the existing `data-qa-id` attributes (`notebook-frame`, `notebook-placeholder`,
`notebook-status`) — e2e depends on them.

### Step E — packaging

`apps/desktop/config/stage-notebook-bundle.ts` + a `prepare:notebook` script, following
`stage-daemon.ts` exactly:

- Source from an env var (`NTERACT_BUNDLE` — a path to a built `apps/notebook/dist`), mirroring
  `RUNTIMED_BINARY`. Unset → stage nothing; the app already handles a missing bundle.
- Stage into `build/notebook/` (gitignored, like `build/daemon/`).
- **Validate** the way `isNativeExecutable` does for the daemon: assert `index.html` exists and
  contains a `/assets/` reference. A wrong or half-copied directory should fail the build, not ship.
- Clear the destination first, so an unset env var cannot silently ship a stale bundle.
- Add to `prepare:build` in `apps/desktop/package.json` alongside `prepare:web`/`prepare:daemon`.
- Add to `extraResources` in `forge.config.ts` next to the staged daemon, `existsSync`-guarded the
  same way. `extraResource` on a **directory** lands it as `Contents/Resources/notebook/` — verify
  this rather than assuming; if it flattens, use the `packageAfterCopy` hook instead, which is what
  the old handoff assumed.

Only the `main` entry of nteract's seven HTML entries is needed, but copying the whole `dist` is
simpler and the extra entries are inert — they are only reachable by a URL nothing navigates to.
22MB total. Don't hand-prune; a missing lazy chunk fails at runtime, not at build.

### Step F — tests

Gate is `pnpm check && pnpm lint && pnpm format:check && pnpm test`, 90% coverage on all four
metrics.

- `ElectronProtocol.test.ts` — extend, don't rewrite. Keep `:65` and `:168` passing. Add: embedded
  host serves an asset with the embedded CSP; app host keeps the strict CSP; app CSP gains
  `frame-src` naming the notebook origin **only when** a host is contributed; `routes` hit before
  the filesystem; `undefined` root → 404; unknown host → 404; dev proxy does not fire for the
  embedded host; `.wasm` gets `application/wasm`; **containment still holds under the embedded root**
  (`/../secret` cannot escape — `resolveRendererPath` already guards this, but assert it for the new
  path since it is a new caller).
- `embedded-hosts.test.ts` — collects a contributed host; ignores a feature that exposes nothing;
  skips and warns on a malformed contribution.
- `notebook-bundle-path.test.ts` — packaged vs unpackaged, present vs absent (copy
  `daemon-binary-path.test.ts`).
- `stage-notebook-bundle.test.ts` — validation rejects a directory with no `index.html`; clears a
  stale bundle; unset env stages nothing.
- `NotebookView.browser.test.tsx` — frames the notebook origin; still renders the placeholder in
  browser mode.
- **`@smoke` e2e** — mandatory per feature and already exists; it must keep passing. Asserting the
  iframe is present is in scope here. Asserting a **cell executes** is old-handoff step 9, a
  separate piece of work — do not scope-creep into it.

Landed: `verifyFramesTheNotebookOrigin()` asserts the frame `src` matches the notebook **host** on
whichever scheme the app is running under. It checks the `src`, not the frame's content, because CI
stages no bundle and the host legitimately 404s there; what can regress is the origin the renderer
derives, which is wrong the moment it falls back to `VITE_NTERACT_ORIGIN`. Note the regex tolerates
an optional `/` before `?path=`: Chromium emits one for this non-special scheme where Node's URL
parser does not, so a Node-derived expectation fails in the browser.

**A CI-only failure was found and fixed while running this.** `verifyDaemonIsReachable()` (added in
`db16a29`) asserted `process.status` is `running`/`external`, but `RUNTIMED_BINARY` is opt-in and
**CI never sets it**, so every CI run would have failed on a build behaving exactly as designed.
`notebook:status` cannot distinguish the two cases — it reports `failed` both for "none bundled" and
for "a bundled one that would not start", and only the second is a regression. The check now asks
disk instead, via `packagedDaemonExists()` in `e2e/utils/paths.ts`, and pushes a `skipped-assertion`
annotation when it skips so a run does not silently look like it covered more than it did.
**If you add an e2e assertion about the daemon or the bundle, gate it the same way** — neither is
staged in CI.

## Verified: the first packaged render works

Done on 2026-08-05, arm64 macOS, with a debug `runtimed` (`2.6.3+560e539`) and the prebuilt bundle:

```
RUNTIMED_BINARY=~/p/nteract/target/debug/runtimed \
NTERACT_BUNDLE=~/p/nteract/apps/notebook/dist \
pnpm --filter @anaconda-agentic-desktop/desktop package
```

Result — the notebook **renders and executes** in the packaged app: 32 cells, WASM initialized,
kernel reached `Running`/Idle, and `print("embedded in agentic-desktop:", platform.python_version())`
returned `3.13.11` with `sum(range(101))` → `5050`. **Zero CSP violations and zero
`Network.loadingFailed` events**, checked over CDP in both the app page and the notebook frame.
The frame's `location.origin` is `anaconda-agentic-desktop://notebook`, confirming origin isolation.

Findings worth keeping:

- **`extraResource` on a directory does land as `Contents/Resources/notebook/`** — the plan said
  verify rather than assume. It does; the `packageAfterCopy` fallback is not needed.
- **Packaging locally needs an icon workaround.** `@electron/packager` derives `assets/icon.icon`
  from `icon.icns` by swapping the extension (`mac.js` → `normalizeIconExtension('.icon')`), so
  removing `.icon` from `forge.config.ts`'s icon array does **not** avoid `actool`. What works
  without full Xcode: point the icon at a directory holding only `icon.icns` (e.g. copy it to
  `/tmp/`) for the local build, and revert. Full Xcode 26+ is the real fix. See the
  `e2e-local-prereqs` memory.
- A **debug** `runtimed` is sufficient for this verification; no release build needed.
- D5 held exactly as predicted: text output, markdown, and tracebacks render. Plots were not
  exercised and remain blocked by design.

## Verification, and the trap in it

Both gates below have been run and pass; kept for how to reproduce them.

`pnpm test` passing proves nothing about whether this works. The whole point of the pair is that it
is the first time anything renders in a packaged build, so:

```
RUNTIMED_BINARY=... NTERACT_BUNDLE=~/p/nteract/apps/notebook/dist pnpm --filter @anaconda-agentic-desktop/desktop package
```

then launch the packaged app and open the notebook. Watch the **renderer console for CSP violation
reports** specifically — a blocked subresource shows up as an empty-ish notebook, not as an error
dialog, and CSP failures are the most likely thing to be wrong here. `/run` or the `verify` skill
can drive this.

A prebuilt bundle already exists at `~/p/nteract/apps/notebook/dist` (22MB, verified: absolute
`/assets/` paths, one `.wasm`, seven HTML entries). Rebuilding it needs generated assets first —
see the `runtimed-standalone-release-assets` memory for the `cargo xtask artifacts ensure` incantation.

**Expected partial success, not a bug:** text output, tracebacks, and markdown should render and
execute. Plots (plotly/vega/bokeh/panel) will **not** — see D5. nteract renders those into a
`srcdoc` iframe, which inherits the parent CSP, and the parent has no `'unsafe-eval'`. Fixing that
means a third protocol host for the output document. Don't chase it here; do note it if you file
follow-up work.

## Two loose ends worth knowing

- **D6, UI/daemon version skew is unchecked.** `daemon-version.ts` enforces commit-hash equality
  between app and daemon, but nteract's `dist/` carries no version marker at all (verified: no
  `__APP_VERSION__` define, nothing in `index.html`), so a UI bundle from a different commit than the
  staged daemon fails the same way a skewed daemon does with nothing to catch it. Out of scope; the
  cheap fix is upstream, and nteract is ours to change.
- The old handoff's "Two things worth starting in parallel" still stand and are untouched by this
  work: re-run `@smoke` (unchanged since spawn/supervision landed), and the legal review of the
  Git-LFS'd renderer bundles, which gates shipping rather than building.
