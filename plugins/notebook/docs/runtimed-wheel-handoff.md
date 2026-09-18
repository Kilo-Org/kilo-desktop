# Handoff: source `runtimed` from the Python wheel

> **SUPERSEDED — do not follow this plan.** See
> `runtimed-standalone-daemon-handoff.md`. The premise below is false: the published
> wheels contain **no** `runtimed` binary (`_bin/` holds only `.gitkeep` on all
> four platforms) because `python/runtimed/.gitignore` makes maturin drop the
> daemon CI stages there. Verified by extracting real release assets. The daemon
> is also Python-free (no `libpython`), so the wheel was never the right
> carrier. Decision: publish standalone per-platform assets instead. Kept for
> the reasoning trail only.

Next step for the notebook feature. Supersedes the "publish standalone binaries"
plan for the sidecar problem — see [Why the wheel](#why-the-wheel).

## State going in

**kilo-desktop** (`t3code/9d5bc891`, 8 commits unpushed, no PR):

- The relay + daemon client transport is built, registered in `FEATURES`, and
  tested at all four tiers. Full gate green: `pnpm check && pnpm lint &&
pnpm format:check && pnpm test` (652 tests), plus `pnpm coverage` (80% gate).
- The notebook suite was run 10× consecutively — 99/99 each time, no
  socket-timing flakiness.
- `e29cb35` fixed a real packaging regression: `ws` was missing from the main
  bundle's Vite externals, so rolldown inlined this CJS package into an ESM
  output and its `require("events")` crashed the packaged app at startup. Every
  `@smoke` spec was failing to launch. **`pnpm test` cannot catch this class of
  bug** — the documented gate omits e2e, and the notebook `@smoke` spec had never
  actually executed before this session.
- 5 of 6 `@smoke` specs now pass, including notebook.

**nteract** (`runtimed-standalone-assets` @ `22d094ca`, **unpushed**): a
publishing-only workflow change that emits standalone macOS/Windows `runtimed`
release assets. Statically validated + arm64 build verified. **Park this branch.**
Do not delete it — it is the fallback if the wheel route fails.

## Why the wheel

The original handoff called standalone per-platform `runtimed` binaries "the hard
blocker" needing new Rust build targets. That is wrong. nteract already compiles
`runtimed` for all four targets we need. Verified against real release assets on
`v2.6.3-nightly.202607290952`:

- `runtimed-nightly-linux-x64` — the only standalone daemon.
- `runtimed-<version>-cp39-abi3-{macosx_11_0_arm64,macosx_10_12_x86_64,manylinux_2_39_x86_64,win_amd64}.whl`
  — **all four targets, already published.**

So the daemon we need is already shipping on every platform; it just arrives in a
wheel. Two reasons to prefer that over publishing new binaries:

1. **No new release surface.** The workflow change is unnecessary, so there is
   nothing new to keep green.
2. **Notarization.** Standalone macOS binaries published outside the signed
   `.app` are not notarized, so an embedding host must sign them under its own
   identity. Consuming a wheel does not dodge this (see risk 1) but it does move
   the problem to a boundary where Anaconda already has tooling and conventions.

And Anaconda is a Python-packaging company: a conda/PyPI-delivered daemon likely
fits the product story better than a bundled binary. That is the thesis to test.

## What to find out first — before writing code

The wheel is **not** a plain binary carrier, and this is the crux of the whole
approach. `python/runtimed/pyproject.toml` builds via **maturin/pyo3**
(`module-name = "runtimed._internals"`, `bindings = "pyo3"`), so the wheel is a
compiled Python extension module that _also_ bundles the daemon at
`src/runtimed/_bin/runtimed` (`_binary.py:54`, `_BIN_DIR`). `find_binary()` prefers
an env override (`RUNTIMED_RUNTIMED_PATH`), then `_bin/`, then well-known install
paths.

**The decisive question: can we take the binary without taking Python?**

Answer it before committing to a design. A `.whl` is a zip, so extracting
`runtimed/_bin/runtimed` in CI needs no Python at runtime — if that binary is
self-contained. Verify by extraction, not by reading code:

```bash
# from a release asset, on each platform
unzip -o runtimed-*-macosx_11_0_arm64.whl -d /tmp/whl
file /tmp/whl/runtimed/_bin/runtimed
otool -L /tmp/whl/runtimed/_bin/runtimed   # macOS: any libpython dependency?
/tmp/whl/runtimed/_bin/runtimed --version  # does it run with no Python present?
```

If `runtimed` links `libpython` or needs the `_internals` extension, the "just
extract it" plan collapses and the real choice becomes: ship a Python runtime,
require a user-provided environment, or fall back to `22d094ca`.

Also confirm the wheel's `runtimed` is the **same build** as the standalone Linux
asset (same version and flags), so behavior does not diverge per platform.

## Then decide the delivery model

Three shapes, in ascending order of coupling to Python:

1. **Extract in CI, bundle the binary.** Download the platform wheel during our
   build, unzip, place the binary via `extraResource`. No Python at runtime.
   Preferred if the check above passes.
2. **Depend on a user/product-provided environment.** Resolve `runtimed` from an
   Anaconda-managed env at runtime. No bundling, but couples the feature to
   environment management — which is the open product question below, so do not
   pick this by default.
3. **Ship a Python runtime.** Only if the binary genuinely cannot stand alone.
   Largest packaging cost; treat as a last resort.

Whichever wins, the **commit-hash-equality** constraint still holds: the app and
sidecar must be pinned to the same nteract commit, not merely a compatible
protocol version. Pin explicitly.

## Then the work already scoped

Unchanged by the wheel decision, and still the bulk of the remaining effort.
Do these two together — neither is verifiable alone:

- **Serve nteract's SPA from our protocol.** Today the view frames nteract only
  when `VITE_NTERACT_ORIGIN` is set, i.e. dev only. Needs a second bundle copied
  in `packageAfterCopy`, a directory-index fallback in `resolveRendererPath`
  (which **contradicts an existing assertion** at `ElectronProtocol.test.ts:168`
  — update it deliberately), nteract's `base: "/"` changed to `"./"`, and correct
  WASM MIME types. nteract has seven HTML entries; we need only `main`.
- **CSP.** `ElectronProtocol.ts` still emits `frame-ancestors 'none'` (line 66)
  and `connect-src 'self'` (line 63), so the iframe cannot load in packaged
  Electron at all right now. The relay binds port 0, so the CSP string must
  become a function of the running relay's port. Prefer `HostBlobs.resolver()` to
  read blobs from disk and keep `connect-src 'self'` intact.

Then: supervise the sidecar (spawn, health, dispose), and verify end to end —
nothing from here on has ever run in a packaged build.

## Risks

1. **Notarization does not go away.** Any `runtimed` we extract and bundle is an
   unsigned foreign binary inside our `.app`. It must be signed under our
   identity and survive our notarization. Prove this early on real hardware —
   it is the most likely late surprise.
2. **A wheel is a heavier dependency than a binary.** Wheels carry Python ABI
   tags (`cp39-abi3`) and platform tags; our CI must select the right one per
   target. More moving parts than fetching one named asset.
3. **Windows.** `_bin/runtimed.exe`, and the `win_amd64` wheel is the only
   Windows source. Our e2e smoke runs on `windows-latest`, so this cannot be
   deferred.
4. **This branch's fallback rots.** If `22d094ca` sits unpushed for long,
   `release-common.yml` will drift. Either land it as harmless extra assets or
   accept re-doing it.

## Also outstanding

- **Workspaces `@smoke` fails** — pre-existing, unrelated to notebook work. A
  Playwright strict-mode violation: `getByText(folderName, {exact: true})` matches
  both the workspace selector and a tooltip trigger in the create dialog
  (`e2e/pages/features/workspaces/workspaces-page.ts:17`). Small, self-contained;
  fixing it gets the smoke suite fully green.
- **8 commits unpushed on `t3code/9d5bc891`; no PR opened.**
- **Product questions still open:** private vs. shared daemon; iframe vs.
  `WebContentsView`; whether v1 needs `.ipynb` open/save (the runtime is pinned by
  the file's `kernelspec` metadata, **not** the `?runtime=` param — a notebook
  without it defaults to Deno/TypeScript, so write `kernelspec.name: "python3"`).
  **Which Python environment** is the most consequential and is now entangled with
  the wheel decision — settle it alongside, not after.

## Local prerequisites

- Every `pnpm` command needs `GH_PACKAGE_TOKEN` with `read:packages`
  (`gh auth token` is **not** a substitute — no `read:packages` → 403).
- **Node must be 24.18.1** per `.nvmrc`, not just `>=24`. On 24.2.0 Playwright
  dies at _collection_ with `Unexpected module status 3` from `require(esm)`
  loading `winston` via `@anaconda/playwright-utils`. `fnm use 24.18.1`.
- **e2e packaging needs full Xcode.** `apps/desktop/assets/icon.icon` (a tracked
  Icon Composer _directory_) makes the packager invoke `actool`; Command Line
  Tools alone fails, packaging aborts, and all 6 specs then fail with a
  misleading `electron.launch ... ENOENT`. Editing `forge.config.ts` does **not**
  avoid it — the packager finds the asset on disk. Workaround is to move
  `icon.icon` aside and restore it (it is tracked; do not leave it moved).
- Packaging takes ~5–7 min; once `apps/desktop/out/` exists reuse it with
  `SKIP_BUILD=true pnpm test:e2e:smoke`.
- Building nteract in a fresh worktree needs gitignored generated assets first:
  `git lfs pull && cargo xtask artifacts ensure runtime,sift,renderer &&
cargo xtask artifacts ensure mcp-widget`. Without them `-p runtimed` panics on
  `Missing renderer plugin asset` and `-p runt` on `assets/_output.html is
missing`; neither is a real problem. Beware chaining cargo with
  `echo exit=$?` — it can report a stale/wrong code. Check for the binary on disk.
