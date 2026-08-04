# Embedding the nteract notebook in Electron — handoff

Status: **partly built.** The main-process transport is committed, tested, and verified against a live daemon (commit `e41b398`). It is not wired into the app yet. The plan below has changed materially from the original proposal — read "Correction" first.

Goal: ship nteract's notebook UI inside the packaged agentic-desktop app, installed with it, with real Python execution and no dev server.

## Correction: the browser host is NOT dev-only. Only the relay is.

The original version of this doc said the transport `createBrowserHost()` relies on is dev-only and absent from the production bundle. **That conflated two separate things and overstated the problem.**

- **Client half — ships in production.** `createBrowserHost()` lives in `packages/notebook-host/src/browser/index.ts`, is listed in that package's `exports` as `./browser`, and is selected by `createNotebookHost()` at _runtime_ purely on `"__TAURI_INTERNALS__" in window` (`apps/notebook/src/host/create-notebook-host.ts:4`). Nothing build-gates it. In Electron, `__TAURI_INTERNALS__` is absent, so the stock bundle picks the browser host on its own.
- **Server half — dev-only.** Only `apps/notebook/vite-plugin-browser-relay.ts` is gated, via `apply: "serve"` (line 443). That is the piece that cannot survive a build.

So the gap is not "write a host," it is "serve the relay's server half from Electron main." nteract's own production answer is Tauri IPC, which we cannot use — which is what motivated the proposed `ElectronHost`. But supplying the relay instead is materially cheaper, and it is the approach now committed under `apps/desktop/src/main/features/notebook/`.

**Consequence: work item 2 below (`ElectronHost`, 682 lines, upstream PR — previously the single biggest schedule risk) is avoidable.** It is retained below only as a fallback.

## What the original spike proved, and what it does not

The spike added `/notebook` in `apps/web` which iframes nteract's **Vite dev server** on `localhost:8737` (`apps/web/src/features/notebook/NotebookView.tsx`, committed in `a0dbb9a`). Python executed for real (`3.13.11`, `sum(range(101))` → `5050`).

It was effectively `npm run dev` three times over: a Vite dev server iframing another Vite dev server, plus a hand-started debug Rust daemon. Three reasons it cannot ship as-is:

1. It depends on the dev-only relay plugin above.
2. The iframe only loads in dev because `createContentSecurityPolicy()` adds the Vite origin and bare `ws:` to `script-src`/`connect-src` via `developmentSources` (`apps/desktop/src/main/platform/ElectronProtocol.ts:55`). Production CSP is `connect-src 'self'` with `frame-ancestors 'none'`.
3. The `runtimed` daemon was started by hand from a local Rust build.

The spike's value: it proved the UI renders standalone under React 19 and that the daemon executes Python. Treat it as a throwaway harness, not a foundation.

## What is now built (commit `e41b398`)

`apps/desktop/src/main/features/notebook/` — 2,103 lines, 96 tests, all green. Adds `ws` to `apps/desktop/package.json`.

| File                      | Role                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `wire/constants.ts`       | Vendored `MAGIC`, `PROTOCOL_VERSION` (4), frame types, per-type size caps                         |
| `wire/codec.ts`           | `LengthPrefixedFrames`, preamble/frame encode, typed-frame encode/decode                          |
| `socket-path.ts`          | Daemon socket / Windows named-pipe resolution, dev vs production namespaces                       |
| `RuntimedService.ts`      | `node:net` daemon client: `connectNotebook`, `queryDaemonInfo`. Electron-free per the oxlint rule |
| `NotebookRelayService.ts` | Loopback HTTP+WebSocket server replacing nteract's dev-only Vite relay                            |

**Verified against the live daemon** (`v2.6.3+560e539`, dev socket under `~/Library/Caches/runt-nightly/worktrees/<hash>/`), twice, on separate days: relay config → authorized WebSocket carrying the custom-protocol `Origin` → `ready` control frame → real Python kernel launched (`kernel_launched`, correlated by request id), with no nteract dev server involved.

Two non-obvious constraints are load-bearing and documented at the seam in `NotebookRelayService.ts`:

1. **The WebSocket path must NOT start with `/__nteract_dev_relay/`.** The host's `normalizeRelayWebSocketUrl` (`packages/notebook-host/src/browser/index.ts:141`) rewrites loopback URLs under that prefix onto `window.location`, which for our custom-protocol origin yields an unusable `anaconda-agentic-desktop://` WebSocket URL. Hence `RELAY_WS_PATH = "/notebook-relay"`.
2. **The config path is hardcoded** at `/__nteract_dev_relay/config` (same file, line 38) and is not runtime-configurable, so it must be served at exactly that path — `CONFIG_PATH`.

Also worth knowing: the relay accepts our custom-protocol `Origin` explicitly, because nteract's own relay treats it as cross-origin and refuses it. Authorization is a constant-time token check; the loopback port alone is not a security boundary.

Two upstream bugs were found and fixed in our port rather than inherited:

- Frames arriving before a consumer attaches were silently dropped upstream. The window is real: the relay awaits `queryDaemonInfo` (a separate socket round-trip) between reading the bootstrap and attaching `pipeTo`, so a dropped Automerge sync frame would desync the document. Our `LengthPrefixedFrames` buffers instead.
- `RUNTIMED_SOCKET_PATH` panics if its parent directory does not exist; `socket-path.ts` accounts for this.

## Why not import nteract as a library

Do not spend time here. The published `@nteract/*` npm packages are frozen since 2021, pinned to React 16, and blocked on React 19 by an unresolvable `react-redux`/`redux` version diamond. The live nteract project is a Rust/Tauri app whose UI lives in a `private` workspace app (`apps/notebook`, no `exports` field), reachable only by deep relative source import, depending on a repo-root `src/` tree via a `@/` Vite alias plus module-global CRDT stores. Consuming it as source means adopting its alias graph, Tailwind config, and `virtual:isolated-renderer` plugin.

**Ship nteract's built bundle as an asset and talk to the daemon over our own transport.**

## Background: the `NotebookHost` seam (context for the fallback)

We do **not** implement this interface — the relay approach reuses nteract's stock browser host, which implements it for us. Retained because it explains the fallback in step 2 and is useful when reading nteract's source.

nteract's `NotebookHost` interface is a host-services abstraction with a `transport` namespace of exactly six members (`packages/runtimed/src/transport.ts:66`):

```ts
sendFrame(frameType: number, payload: Uint8Array): Promise<void>;
sendTypedRequest(frameType, payload, id, timeoutMs, timeoutLabel?): Promise<NotebookResponse>;
onFrame(callback: FrameListener): () => void;
sendRequest(request: unknown, options?): Promise<unknown>;
readonly connected: boolean;
readonly connectionStatus$: Observable<ConnectionStatus>;
disconnect(): void;
```

The Tauri host implements this over Tauri IPC → Rust → Unix socket. An Electron host does the same over Electron IPC → main process → Unix socket. Structurally identical.

nteract has already reserved space for an Electron host: `packages/notebook-host/src/types.ts:440` types `name` as `"tauri" | "electron" | "browser"`, and line 9 says _"in the (coming) Electron host it routes through `window.electronHost` exposed by the preload contextBridge."_ But `exports` lists only `.`, `./browser`, `./tauri` — **the Electron host is planned, not written.** Building it is the fallback, not the plan: we use `./browser` instead, which is written, exported, and selected automatically in Electron.

## Architecture (as built)

The relay approach removes the preload/MessagePort/`ElectronHost` layers entirely — nteract's **stock, unmodified** browser host is the client:

```
agentic-desktop renderer (anaconda-agentic-desktop://app)
  └─ notebook surface (iframe or WebContentsView) → nteract's built SPA, served from our protocol
       └─ createBrowserHost()  ← stock nteract, unmodified
            ├─ fetch  http://127.0.0.1:<port>/__nteract_dev_relay/config   (CONFIG_PATH)
            └─ ws://127.0.0.1:<port>/notebook-relay?token=…                (RELAY_WS_PATH)
                 └─ main: NotebookRelayService  ── token + Origin check
                      └─ main: RuntimedService — node:net socket/named pipe
                           └─ runtimed (bundled sidecar) → Jupyter ZMQ → Python kernel
```

Superseded by this: the original `ElectronHost` → `window.electronHost` → MessagePort chain, and with it the preload contextBridge work (step 5 in the old sequencing — the contextBridge allowlist has no MessagePort pattern and `invoke` cannot transfer a port, which is now moot).

## Work breakdown

### 1. Frame client in the main process — ✅ DONE (committed `e41b398`)

Built as described in "What is now built" above. The notes below are retained because they still constrain maintenance.

The protocol is well specified: nteract's `docs/adr/typed-frame-v4-wire-protocol.md` documents the 5-byte preamble (`C0 DE 01 AC` + version), length-prefixed framing, all eleven frame types, and the 100 MiB / 64 KiB size ceilings. Rust source of truth: `crates/notebook-wire/src/lib.rs`.

`@runtimed/node` (published, BSD-3-Clause, napi-rs) is **not** a substitute — it is a high-level session API and exposes no raw `sendFrame`/`onFrame`, so it cannot carry the Automerge sync frames the UI's `SyncEngine` needs.

Lift `LengthPrefixedFrames`, `writePreamble`, `writeFrame`, `relayHandshake`, and `queryDaemonInfo` from `vite-plugin-browser-relay.ts` — roughly 250 of its 550 lines are directly portable to Node.

Per `.oxlintrc.json`, a `RuntimedService.ts` must not import `electron`; keep `node:net`/`node:child_process` in the service and put `app.isPackaged` / `process.resourcesPath` resolution in `handlers.ts` or `platform/`.

**Version drift risk:** the TS copy of `MAGIC`/`PROTOCOL_VERSION` is hardcoded in nteract's Vite plugin, not exported from a package. Protocol v4 fails closed with no downgrade path, and the app↔sidecar relationship requires **commit-hash equality**, not just protocol equality (`crates/notebook-wire/AGENTS.md`). Pin the `runtimed` build against the UI build. Ask upstream to export the constants.

### 2. `ElectronHost` implementing `NotebookHost` — ⛔️ NOT NEEDED (fallback only)

**Skip this.** See "Correction" above: the stock browser host already ships in production and is selected at runtime in Electron, so supplying the relay's server half (done, step 1) replaces this entirely. This removes the plan's single biggest schedule risk — a 682-line upstream PR gated on someone else's review.

Reach for it only if the relay approach fails on something structural, e.g. upstream deletes or build-gates the browser host, or CSP makes a loopback WebSocket untenable. Original notes retained below for that case.

<details>
<summary>Fallback: original ElectronHost plan</summary>

Model on `packages/notebook-host/src/browser/index.ts` (682 lines) and swap WebSocket for Electron IPC. Also needs an Electron branch in `apps/notebook/src/host/create-notebook-host.ts` (currently only Tauri-or-browser) and an `"./electron"` entry in `exports`.

Load-bearing for render-and-execute: `transport`, `daemon`, `daemonEvents`, `relay`, `blobs`, `commands`, `log`.
Stub-able initially: `trust`, `deps`, `notebook`, `window`, `system`, `dialog`, `externalLinks`, `updater`, `settings`.

Caveat: the interface deliberately does not mark these optional ("to keep the contract honest"), so stubs compile but the UI may call them and fail at runtime rather than compile time.

**Do this as an upstream PR, not a fork.** It's pre-named in their types, benefits them, and a fork means re-merging a 682-line file forever. Note the git history suggests we have contributors in that repo; confirm appetite before committing to a date.

</details>

### 3. Serving nteract's SPA from our protocol

`resolveRendererPath` (`ElectronProtocol.ts:70`) already has a containment guard and can serve a second bundle from e.g. `.vite/renderer/main_window/notebook/`. Two gaps:

- `base: "/"` in nteract's Vite config emits **absolute** asset paths. Either patch to `"./"` or root the protocol handler at the bundle dir.
- `/notebook/` (directory, no filename) 404s. Needs a directory-index fallback — which **contradicts an existing assertion** at `ElectronProtocol.test.ts:168` that `resolveRendererPath(root, "/settings/")` resolves `undefined`. Update that test deliberately.

Also: nteract's UI is **not a single SPA** — seven HTML entries (`main`, `onboarding`, `settings`, …). We only need `main`. WASM must be served with the correct MIME type. Add a second copy step in the `packageAfterCopy` hook alongside `stageWebRenderer`.

### 4. CSP changes

**The relay approach adds a requirement here that the `ElectronHost` approach would not have had.** Electron IPC needs no CSP grant; a loopback WebSocket does. The notebook subtree's `connect-src` must allow `http://127.0.0.1:<relay_port>` **and** `ws://127.0.0.1:<relay_port>` — and since the relay binds port 0 (so two app instances cannot collide), that port is dynamic, making the CSP string a function of the running relay. Budget for this; it is the main cost transferred from step 2.

If that proves unacceptable, the fallback is `WebContentsView` (below) or step 2's IPC host.

Production CSP is asserted by `ElectronProtocol.test.ts:65`, which requires `frame-ancestors 'none'` and no `wss:`. Changes needed:

- Emit `frame-ancestors 'self'` for responses under the notebook subtree. `frame-src` is absent and inherits `default-src 'self'`, so a same-origin iframe is otherwise already allowed — it's the **child's** header that blocks framing. `withSecurityHeaders` takes only `developmentOrigin` today, so this needs a new parameter.
- If we use the HTTP blob server, `connect-src`/`img-src` need `http://127.0.0.1:<blob_port>`, and since the port is dynamic the CSP string becomes a function of the running sidecar.

**Prefer avoiding that**: `@runtimed/node` exposes `blobStorePath()` / `resolveBlobPath(hash, socketPath)`, so `HostBlobs.resolver()` can read blobs from disk through our own protocol and leave `connect-src 'self'` intact. Blobs are not needed for text output but are required for plots, images, and DataFrames.

Alternative to iframe+CSP: **`WebContentsView`**, which gets its own session and CSP and sidesteps the parent policy entirely. Used nowhere in this repo today; costs manual bounds/z-order management against the 56px custom titlebar. `webviewTag: false` rules out `<webview>`.

### 5. Shipping and supervising the `runtimed` sidecar — greenfield

**`mainSdk.resolvePluginAsset` is the wrong seam.** It resolves assets inside a node_modules package via `createRequire`. Use `extraResource` + the `process.resourcesPath` pattern already in `ElectronWindow.ts:142`. Fuses `OnlyLoadAppFromAsar` and `EnableEmbeddedAsarIntegrityValidation` are on, so the binary must live outside the asar. Today `extraResource` ships exactly one PNG and no native binary — this is the first.

**The hard blocker.** nteract publishes `runt-darwin-arm64` and `runt-darwin-x64`, but standalone `runtimed` **only** as `runtimed-linux-x64`. On macOS the daemon ships inside the signed `.app` at `Contents/MacOS`, and there is no standalone Windows `runtimed`. Since agentic-desktop targets macOS (dmg+zip), Windows (squirrel), and Linux (deb), with e2e smoke on `windows-latest`, options are:

- **(a) Ask nteract to publish standalone per-platform `runtimed` assets.** Cleanest; an external dependency. Recommended — raise this immediately, it gates the estimate.
- (b) Extract the sidecar from their macOS `.app` tarball in CI. Works now, fragile, and re-signing a nested binary with entitlements under our own notarization needs care.
- (c) Build Rust in our CI. Avoids the dependency; adds a Rust toolchain to the pipeline and Windows support may not exist upstream at all.

**No child-process supervision exists in this repo.** No `spawn`/`utilityProcess`, no health check, restart, or shutdown pattern. Closest analogue is `features/auth/oauth/callback-server.ts` (node:http server, `EADDRINUSE` handling, injected logger, explicit close). Disposal convention is `Application.#disposers` (LIFO on `before-quit`) plus `mainSdk.onDispose`.

Also decide whether we spawn our own private daemon or reuse a user-installed one. nteract installs a **per-user** launchd/systemd service (`crates/runtimed-service`, driven by `runt daemon doctor --fix`). Two daemons on one machine invites confusion; sharing invites version-coupling conflicts. Recommend a private instance with an explicit `RUNTIMED_SOCKET_PATH` under our own app-support dir — and note that env var **panics if its parent directory does not exist**, so create the dir first.

Socket paths: production is `~/Library/Caches/runt/runtimed.sock` (macOS) with **no** `worktrees` segment; dev mode (`RUNTIMED_DEV=1` or `RUNTIMED_WORKSPACE_PATH`) inserts `worktrees/<sha256(path)[..12]>`. Windows uses a named pipe (`\\.\pipe\…`) — `node:net` handles both, but verify nothing upstream assumes `AF_UNIX`.

### 6. Tests and gates

Per `AGENTS.md` and `.agents/skills/new-feature/SKILL.md`: contracts → `mainRegister` → `FEATURES` entry → hooks → View with `data-qa-id` → route file → tests at four tiers (unit, integration, `.browser.test.tsx`, and **at least one `@smoke` Playwright spec** — mandatory per feature). Coverage gate is 90% on all four metrics. Gate: `pnpm check && pnpm lint && pnpm format:check && pnpm test`. Use `createFakeSdk`/`createFakeFeatureSystem`.

Done for the transport: 96 unit tests including golden-byte codec tests against the ADR and partial/oversized frame cases. **The full desktop suite is 321/321 green and the whole gate passes.**

Still owed: the `mainRegister`/`FEATURES`/hooks/View/route wiring (none of it exists yet — the feature directory is not referenced anywhere outside itself), plus the integration, `.browser.test.tsx`, and `@smoke` tiers.

**Watch for socket-timing flakiness when adding tests here.** Three of the existing tests were flaky for one root cause: the fake daemon replies so fast that the client promise resolves _before_ the server has processed the client's writes, so assertions read a partial or wrong buffer. Two variants to avoid:

- Asserting on `daemon.received` right after an `await` — wait for the bytes first: `await vi.waitFor(() => expect(Buffer.concat(daemon.received).length).toBeGreaterThan(9))`.
- Clearing `daemon.received = []` to isolate an outbound frame — drain the handshake bytes _before_ clearing, or they land afterwards and get mistaken for the frame under test.

Also: a fake daemon must track the channel from the **first** frame only. Treating every pre-notebook frame as a handshake misclassifies the pool channel's second frame (`{"type":"get_daemon_info"}`) and registers the pool socket as the notebook socket. Run the suite several times in a row (`for i in 1 2 3 4 5; do …; done`) before believing a fix — a single green run means little here.

**Local dev prerequisites** (both cost real time to rediscover):

- `pnpm install` needs `GH_PACKAGE_TOKEN` with `read:packages` for `@anaconda` GitHub Packages. `gh auth token` is **not** a substitute (no `read:packages` → 403).
- `pnpm-workspace.yaml` sets `nodeLinker: hoisted`, so deps land in the **repo-root** `node_modules/`, not `apps/desktop/node_modules/` (which holds only workspace links). Checking the latter for `ws` gives a false negative.
- Vitest only discovers `config/**/*.test.ts` and `src/**/*.test.ts` — a scratch probe at the package root is silently not run.
- To drive the live daemon from a scratch script, use `../../node_modules/.bin/tsx` from `apps/desktop`; `npx tsx` can hang on resolution.

There is no ADR directory — architectural decisions are recorded as numbered inline comments at the seam they govern (highest observed: #21) and mirrored into `CONTEXT.md`.

## License

nteract is **BSD-3-Clause** ("Copyright (c) 2024, runtimed"); `@runtimed/node` matches. Permissive and compatible with shipping in a proprietary app, with three obligations:

1. Reproduce the copyright notice and disclaimer in materials provided with the distribution — i.e. an in-app licenses screen.
2. Clause 3: do not use the "runtimed" name or contributor names to promote our product without written permission. Get sign-off on any "powered by nteract" copy.
3. **Not covered by nteract's LICENSE:** the Git-LFS'd third-party renderer bundles (plotly, bokeh, panel, vega, leaflet) carry their own licenses. Run a proper license scan of the renderer-plugin artifacts before shipping.

Worth a legal review before committing, not after.

## Recommended sequencing

**One external dependency still gates the estimate.** Start it immediately, in parallel with everything else:

1. **Ask nteract for standalone per-platform `runtimed` binaries** (and for exported protocol constants, which would retire our vendored copy in `wire/constants.ts`). If this is a no, see (b)/(c) under step 5 — it changes the packaging plan, not the transport.

_(The old blocker "confirm appetite for an upstream `ElectronHost` PR" is dropped — see "Correction".)_

Done:

2. ✅ Frame client, socket client, and relay in main, verified against the live daemon.

Next, in this order — the first two are independently testable with no UI and no nteract change:

3. **Wire the feature into the app.** `contracts` → `mainRegister` → an entry in `apps/desktop/src/main/features/registry/features.ts` (`BUILT_IN_FEATURES`) → hooks → View → route. Relay lifecycle goes in `Application.#disposers` (LIFO on `before-quit`) or `mainSdk.onDispose`; `NotebookRelayService.dispose()` already exists and is idempotent. Note `RuntimedService.ts` must not import `electron` (oxlint override), so `app.isPackaged` / `process.resourcesPath` resolution belongs in `handlers.ts` or `platform/`.
4. **Sidecar spawn/supervise/dispose** (step 5 below). No child-process supervision exists in this repo yet.
5. **Serve nteract's built SPA from our protocol** (step 3 below) — including the `base: "./"` fix and the directory-index fallback that contradicts `ElectronProtocol.test.ts:168`.
6. **CSP change for the dynamic relay port** (step 4 below). Decide iframe-plus-CSP vs `WebContentsView` here.
7. **Blob resolver over our protocol**, so `connect-src` need not allow the blob server's port.
8. **`@smoke` spec that executes a cell in the packaged app.**

The first end-to-end milestone worth aiming at: steps 3–6 together are what turn the verified transport into a notebook that renders and executes inside the packaged app.

## For whoever picks this up

Start by reading `apps/desktop/src/main/features/notebook/NotebookRelayService.ts` — its header comment states the two hardcoded-path constraints that shape the whole design.

To re-verify the transport against a live daemon before changing anything:

```bash
# 1. A daemon must be running (nteract's own dev daemon is fine):
ps aux | grep '[r]untimed'
find ~/Library/Caches/runt* -name runtimed.sock

# 2. Full gate (needs GH_PACKAGE_TOKEN — see step 6):
pnpm check && pnpm lint && pnpm format:check && pnpm test
```

A scratch script that constructs `RuntimedService({ socketPath })` → `NotebookRelayService({ runtimed, allowedOrigin })` → `relay.config()` → a `ws` client sending the custom-protocol `Origin` should receive a `ready` control frame within a second or two. That is the whole contract; if it holds, the transport is fine and any failure is in the layers above.

**Unverified end to end:** everything from step 3 onward. The transport works; nothing renders yet.

## Open questions

- Private daemon or shared with a user-installed nteract? (recommend private) — **still open.** Note the verification above ran against nteract's _own_ dev daemon, which proves sharing works technically but does not settle the version-coupling question.
- iframe + CSP change, or `WebContentsView`? (iframe is smaller; `WebContentsView` is cleaner isolation) — **now weightier**, because the relay needs a dynamic-port `connect-src` grant that `WebContentsView` would isolate in its own session.
- Do we need `.ipynb` file open/save in v1, or is a fixed scratch notebook enough? The runtime is pinned by the file's `kernelspec` metadata, **not** the `?runtime=` param — a notebook created without it defaults to Deno/TypeScript. Write `kernelspec.name: "python3"`.
- Which Python environment? The daemon manages its own uv/conda/pixi pools; reconciling that with Anaconda's own environment management is a product question, not a technical one, and probably the most important thing on this list.
