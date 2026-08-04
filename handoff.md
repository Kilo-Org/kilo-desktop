# Embedding the nteract notebook in Electron — handoff

Status: **design proposal.** A working spike exists (browser-mode only); nothing here is built yet.

Goal: ship nteract's notebook UI inside the packaged agentic-desktop app, installed with it, with real Python execution and no dev server.

## What the spike proved, and what it does not

The spike added `/notebook` in `apps/web` which iframes nteract's **Vite dev server** on `localhost:8737`. Python executed for real (`3.13.11`, `sum(range(101))` → `5050`).

Three reasons it cannot ship as-is:

1. The transport it relies on (`createBrowserHost()` in nteract's `packages/notebook-host/src/browser/index.ts`) fetches `/__nteract_dev_relay/config` and dials a `ws://` URL served by `apps/notebook/vite-plugin-browser-relay.ts`. That plugin declares `apply: "serve"` — it is **dev-only** and is not in the production bundle.
2. The iframe only loads in dev because `createContentSecurityPolicy()` adds the Vite origin and bare `ws:` to `script-src`/`connect-src` via `developmentSources`. Production CSP is `connect-src 'self'` with `frame-ancestors 'none'`.
3. The `runtimed` daemon was started by hand from a local Rust build.

The spike's value: it proved the UI renders standalone under React 19 and that the daemon executes Python. Treat it as a throwaway harness, not a foundation.

## Why not import nteract as a library

Do not spend time here. The published `@nteract/*` npm packages are frozen since 2021, pinned to React 16, and blocked on React 19 by an unresolvable `react-redux`/`redux` version diamond. The live nteract project is a Rust/Tauri app whose UI lives in a `private` workspace app (`apps/notebook`, no `exports` field), reachable only by deep relative source import, depending on a repo-root `src/` tree via a `@/` Vite alias plus module-global CRDT stores. Consuming it as source means adopting its alias graph, Tailwind config, and `virtual:isolated-renderer` plugin.

**Ship nteract's built bundle as an asset and talk to the daemon over our own transport.**

## The good news: the seam is clean and already anticipated

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

nteract has already reserved space for us: `packages/notebook-host/src/types.ts:440` types `name` as `"tauri" | "electron" | "browser"`, and line 9 says _"in the (coming) Electron host it routes through `window.electronHost` exposed by the preload contextBridge."_ But `exports` lists only `.`, `./browser`, `./tauri` — **the Electron host is planned, not written.** We would be building it.

## Architecture

```
agentic-desktop renderer (anaconda-agentic-desktop://app)
  └─ notebook surface (iframe or WebContentsView) → nteract's built SPA, served from our protocol
       └─ ElectronHost implements NotebookHost
            └─ window.electronHost (preload contextBridge)
                 └─ MessagePort binary frame stream
                      └─ main: RuntimedService — node:net socket/named pipe
                           └─ runtimed (bundled sidecar) → Jupyter ZMQ → Python kernel
```

## Work breakdown

### 1. Frame client in the main process (~250 lines, greenfield)

The protocol is well specified: nteract's `docs/adr/typed-frame-v4-wire-protocol.md` documents the 5-byte preamble (`C0 DE 01 AC` + version), length-prefixed framing, all eleven frame types, and the 100 MiB / 64 KiB size ceilings. Rust source of truth: `crates/notebook-wire/src/lib.rs`.

`@runtimed/node` (published, BSD-3-Clause, napi-rs) is **not** a substitute — it is a high-level session API and exposes no raw `sendFrame`/`onFrame`, so it cannot carry the Automerge sync frames the UI's `SyncEngine` needs.

Lift `LengthPrefixedFrames`, `writePreamble`, `writeFrame`, `relayHandshake`, and `queryDaemonInfo` from `vite-plugin-browser-relay.ts` — roughly 250 of its 550 lines are directly portable to Node.

Per `.oxlintrc.json`, a `RuntimedService.ts` must not import `electron`; keep `node:net`/`node:child_process` in the service and put `app.isPackaged` / `process.resourcesPath` resolution in `handlers.ts` or `platform/`.

**Version drift risk:** the TS copy of `MAGIC`/`PROTOCOL_VERSION` is hardcoded in nteract's Vite plugin, not exported from a package. Protocol v4 fails closed with no downgrade path, and the app↔sidecar relationship requires **commit-hash equality**, not just protocol equality (`crates/notebook-wire/AGENTS.md`). Pin the `runtimed` build against the UI build. Ask upstream to export the constants.

### 2. `ElectronHost` implementing `NotebookHost` (upstream contribution)

Model on `packages/notebook-host/src/browser/index.ts` (682 lines) and swap WebSocket for Electron IPC. Also needs an Electron branch in `apps/notebook/src/host/create-notebook-host.ts` (currently only Tauri-or-browser) and an `"./electron"` entry in `exports`.

Load-bearing for render-and-execute: `transport`, `daemon`, `daemonEvents`, `relay`, `blobs`, `commands`, `log`.
Stub-able initially: `trust`, `deps`, `notebook`, `window`, `system`, `dialog`, `externalLinks`, `updater`, `settings`.

Caveat: the interface deliberately does not mark these optional ("to keep the contract honest"), so stubs compile but the UI may call them and fail at runtime rather than compile time.

**Do this as an upstream PR, not a fork.** It's pre-named in their types, benefits them, and a fork means re-merging a 682-line file forever. This is the single biggest schedule risk — it depends on someone else's review. Note the git history suggests we have contributors in that repo; confirm appetite before committing to a date.

### 3. Serving nteract's SPA from our protocol

`resolveRendererPath` (`ElectronProtocol.ts:70`) already has a containment guard and can serve a second bundle from e.g. `.vite/renderer/main_window/notebook/`. Two gaps:

- `base: "/"` in nteract's Vite config emits **absolute** asset paths. Either patch to `"./"` or root the protocol handler at the bundle dir.
- `/notebook/` (directory, no filename) 404s. Needs a directory-index fallback — which **contradicts an existing assertion** at `ElectronProtocol.test.ts:155` that `resolveRendererPath(root, "/settings/")` resolves `undefined`. Update that test deliberately.

Also: nteract's UI is **not a single SPA** — seven HTML entries (`main`, `onboarding`, `settings`, …). We only need `main`. WASM must be served with the correct MIME type. Add a second copy step in the `packageAfterCopy` hook alongside `stageWebRenderer`.

### 4. CSP changes

Production CSP is asserted by `ElectronProtocol.test.ts:60`, which requires `frame-ancestors 'none'` and no `wss:`. Changes needed:

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

The frame codec is the highest-value unit-test target: golden-bytes tests against the ADR, plus fuzzing partial/oversized frames.

There is no ADR directory — architectural decisions are recorded as numbered inline comments at the seam they govern (highest observed: #21) and mirrored into `CONTEXT.md`.

## License

nteract is **BSD-3-Clause** ("Copyright (c) 2024, runtimed"); `@runtimed/node` matches. Permissive and compatible with shipping in a proprietary app, with three obligations:

1. Reproduce the copyright notice and disclaimer in materials provided with the distribution — i.e. an in-app licenses screen.
2. Clause 3: do not use the "runtimed" name or contributor names to promote our product without written permission. Get sign-off on any "powered by nteract" copy.
3. **Not covered by nteract's LICENSE:** the Git-LFS'd third-party renderer bundles (plotly, bokeh, panel, vega, leaflet) carry their own licenses. Run a proper license scan of the renderer-plugin artifacts before shipping.

Worth a legal review before committing, not after.

## Recommended sequencing

Two things gate the estimate and are cheap to start. Do them first, in parallel with nothing else:

1. **Ask nteract for standalone per-platform `runtimed` binaries** (and for exported protocol constants).
2. **Confirm appetite for an upstream `ElectronHost` PR.**

If either is a no, the shape of this changes materially — (b)/(c) for binaries, or a fork for the host.

Then:

3. Frame client + codec tests in main. Verifiable against the already-running daemon with no UI.
4. Sidecar spawn/supervise/dispose.
5. MessagePort channel through preload — note the contextBridge allowlist has **no** MessagePort pattern today and `invoke` cannot transfer a port; use `ipcRenderer.postMessage` / `MessageChannelMain`.
6. `ElectronHost` + upstream PR.
7. Protocol serving, CSP change, test updates.
8. Blob resolver over our protocol.
9. `@smoke` spec that executes a cell in the packaged app.

Steps 3–5 are independently testable before any nteract change lands, which is where I'd start.

## Open questions

- Private daemon or shared with a user-installed nteract? (recommend private)
- iframe + CSP change, or `WebContentsView`? (iframe is smaller; `WebContentsView` is cleaner isolation)
- Do we need `.ipynb` file open/save in v1, or is a fixed scratch notebook enough? The runtime is pinned by the file's `kernelspec` metadata, **not** the `?runtime=` param — a notebook created without it defaults to Deno/TypeScript. Write `kernelspec.name: "python3"`.
- Which Python environment? The daemon manages its own uv/conda/pixi pools; reconciling that with Anaconda's own environment management is a product question, not a technical one, and probably the most important thing on this list.
