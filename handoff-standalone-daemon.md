# Handoff: publish standalone `runtimed` assets

Next step for the notebook feature. **Supersedes `handoff-wheel.md`** — the wheel
route is dead, proven by extraction, not code reading. See [Why not the
wheel](#why-not-the-wheel-settled-empirically). Decision made: **publish
standalone per-platform daemon assets** (option 1 of 3).

## The finding that changed the plan

`handoff-wheel.md` bet on `runtimed` arriving inside the Python wheel. It does
not.

**All four published wheels contain no daemon binary.** Verified against real
assets on `v2.6.3-nightly.202607290952`. Each wheel's `_bin/` holds only
`.gitkeep`; the payload is a pyo3 extension module (`_internals.abi3.so` /
`.pyd`, 11–14 MB) plus pure Python:

```
runtimed/_bin/.gitkeep              0 bytes   <-- the daemon should be here
runtimed/_internals.abi3.so    11.3 MB
```

The package's own README says to get the daemon from the desktop app.

**Root cause — an upstream bug, broken since day one.**
`python/runtimed/.gitignore` lists `src/runtimed/_bin/runtimed` (+ `.exe`).
`release-common.yml:966` _does_ `cp` the freshly built daemon there, but
**maturin respects gitignore** and silently drops it. Commit `fd98faec`
("feat(python): bundle runtimed daemon binary in wheel", #531) added the CI copy
_and_ the defeating ignore in the same commit, with no CI assertion that the
binary landed — so the feature has never once worked.

Reproduced in a minimal maturin 1.11.5 project mirroring the layout
(`python-source = "src"`, gitignored file under `_bin/`), yielding wheel
structure identical to the published ones. Three fixes tried:

| Attempt                                            | Result                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `include = [{path=..., format="wheel"}]`           | **Fails.** Logs `📦 Including files matching` and still omits the file — actively misleading. |
| Nested `_bin/.gitignore` with `!runtimed` negation | **Fails.** Ships the `.gitignore` itself, not the binary.                                     |
| Remove the `.gitignore` entry                      | **Works.** Only fix that does.                                                                |

## Why not the wheel (settled empirically)

Beyond being broken, the wheel is the wrong shape for us — and the reason
inverts the handoff's biggest risk.

**The daemon never needed Python.** From the signed
`nteract-nightly-darwin-arm64.app.tar.gz`, `Contents/MacOS/runtimed` (38 MB):

- `otool -L` → **system frameworks only** (CoreFoundation, CoreServices,
  ServiceManagement, Security, Foundation, libSystem, libobjc, libiconv).
  **No `libpython`, no `_internals` dependency.**
- Runs standalone: `runtimed --version` → `2.6.3-nightly.202607290952+60385eb`,
  exit 0.
- Identical build to the standalone Linux asset — `strings` on
  `runtimed-nightly-linux-x64` shows the same `+60385eb`. No per-platform
  behavior divergence.

So routing a Python-free binary through Python packaging buys nothing and costs
per-target ABI/platform tag selection (`cp39-abi3`) plus an unusable 11 MB
extension module. `handoff-wheel.md`'s reasons to prefer the wheel — "no new
release surface" and better notarization ergonomics — do not survive: the wheel
needs an upstream fix anyway (so there _is_ new surface), and see below on
notarization.

**Risk 1 is smaller than documented — but does not vanish for this option.**
The daemon inside the `.app` is already `Developer ID Application: Kyle Kelley
(8E54RDNN6Z)` signed with hardened runtime, and `spctl -a -t install` reports
`accepted, source=Notarized Developer ID` (the app carries a stapled ticket).
That proves the binary itself notarizes cleanly upstream. **However, the assets
this branch publishes are copied from `target/.../release/` before signing, so
they are unsigned and unnotarized.** We must still sign them under our identity.
That was the known trade-off when picking this option; extraction-from-`.app`
was the alternative that would have avoided it (rejected: Windows ships only an
NSIS installer `.exe`, needing 7z-style extraction in CI).

## State of the branch to land

`runtimed-standalone-assets` @ `22d094ca` in worktree
`~/.t3/worktrees/nteract/runtimed-standalone-assets`. **Unpushed, no PR.**

**Risk 4 has not bitten.** The branch is still based exactly on `origin/main`
(`152eb6e4`, 0 commits behind as of 2026-08-04), so `release-common.yml` has not
drifted. It has not rotted — but that clock is running again.

What it does (a publishing-only change, +35/−3 in `release-common.yml`, +7/−1 in
`RELEASING.md`):

- `build-macos`: adds `-p runtimed` to the two `cargo build` lines, copies out
  `runtimed-darwin-{arm64,x64}`, uploads them in `runt-macos-executables`.
- `build-notebook-windows-x64`: new steps stage and upload
  `runtimed-windows-x64.exe` as `runtimed-windows-executable`.
- `prerelease`: downloads that artifact and `cp`s all three into
  `release-assets/` under `${DAEMON_NAME}-*`.

Already verified: actionlint, YAML parse, a programmatic cross-check that every
artifact upload/download name resolves and that `prerelease` already `needs` the
Windows job, plus a real local
`cargo build --release --target aarch64-apple-darwin -p runt -p runtimed`
producing both arm64 Mach-O binaries at the paths the workflow copies from. The
x64 and Windows paths are symmetric but unverified locally (only the arm64
target is installed); CI is the real proof.

**Glob coverage is fine — do not "fix" it.** I briefly suspected the release
`files:` list missed the new macOS daemons. It does not: `runt*-darwin-arm64`
and `runt*-darwin-x64` also match `runtimed-*`, exactly as `runt*-linux-x64`
already catches today's `runtimed-nightly-linux-x64`. Confirmed by running the
patterns against the expected filenames. The explicit
`runtimed*-windows-x64.exe` line is needed only because no `runt*-windows-*`
glob exists.

My first check _did_ report a gap, and it was wrong — the patterns were
unquoted, so the shell expanded them against the real cwd before the `case`
compared anything, and nothing matched. If you re-test this, quote the patterns
and match against a directory of touched dummy filenames.

### One real gap found, not yet fixed

The **release-body table still advertises the daemon as Linux-only.** In the
`Generate release body` step (~line 1530), the download table emits:

```
| Linux | x64 | `${DAEMON_NAME}-linux-x64` |
| macOS | ARM64 | `${CLI_NAME}-darwin-arm64` |
| macOS | x64 (Intel) | `${CLI_NAME}-darwin-x64` |
```

There are no `${DAEMON_NAME}` rows for darwin-arm64, darwin-x64, or
windows-x64.exe. So the branch would upload three assets nobody is told exist.
Add those three rows. Cosmetic, but it is the difference between publishing
assets and _shipping_ them.

## Then, in order

1. **Add the release-body rows** above. Small and self-contained.
2. **Land `22d094ca` upstream.** It is safe to merge as additive assets — see
   [Verifying](#verifying-the-workflow-change) before doing so.
3. **Consume the assets in agentic-desktop**: download the platform daemon at
   build time, place via `extraResource`, sign it under our identity so it
   survives our notarization. **Prove signing on real hardware early** — it is
   still the most likely late surprise, just a smaller one than documented.
4. **Pin by commit hash.** The commit-hash-equality constraint is unchanged: app
   and sidecar must be pinned to the same nteract commit, not merely a
   compatible protocol version. Pin explicitly.

### Optionally, upstream hygiene

Removing the `.gitignore` line would make the wheel actually carry the daemon as
#531 intended. **Not on our critical path** — we no longer want the wheel — but
it is a one-line fix for a feature that has silently never worked, and worth
reporting upstream regardless. If done, add a CI assertion that the binary is
present in the built wheel, since its absence was invisible for months.

## Then the app-side work already scoped

Unchanged by this decision, and still the bulk of remaining effort. Do these two
together — neither is verifiable alone:

- **Serve nteract's SPA from our protocol.** Today the view frames nteract only
  when `VITE_NTERACT_ORIGIN` is set, i.e. dev only. Needs a second bundle copied
  in `packageAfterCopy`, a directory-index fallback in `resolveRendererPath`
  (which **contradicts an existing assertion** at
  `ElectronProtocol.test.ts:168` — update it deliberately), nteract's
  `base: "/"` changed to `"./"`, and correct WASM MIME types. nteract has seven
  HTML entries; we need only `main`.
- **CSP.** `ElectronProtocol.ts` still emits `frame-ancestors 'none'` (line 66)
  and `connect-src 'self'` (line 63), so the iframe cannot load in packaged
  Electron at all right now. The relay binds port 0, so the CSP string must
  become a function of the running relay's port. Prefer `HostBlobs.resolver()`
  to read blobs from disk and keep `connect-src 'self'` intact.

Then: supervise the sidecar (spawn, health, dispose), and verify end to end —
nothing from here on has ever run in a packaged build.

## Verifying the workflow change

`Nightly Release` (`.github/workflows/release-nightly.yml`) has
`workflow_dispatch`:
`gh workflow run "Nightly Release" --ref runtimed-standalone-assets`.
**That publishes a real prerelease — get explicit approval first.**
`release-common.yml` is `workflow_call` only and cannot be dispatched directly.

## State of agentic-desktop (unchanged this session)

`t3code/9d5bc891`, **9 commits unpushed, no PR.** No code was written this
session — it was all investigation.

- Relay + daemon client transport built, registered in `FEATURES`, tested at all
  four tiers. Full gate green: `pnpm check && pnpm lint && pnpm format:check &&
pnpm test` (652 tests), plus `pnpm coverage` (80% gate).
- Notebook suite run 10× consecutively — 99/99 each time, no socket-timing
  flakiness.
- `e29cb35` fixed a real packaging regression (`ws` missing from the main
  bundle's Vite externals → rolldown inlined a CJS package into ESM output →
  `require("events")` crashed the packaged app at startup). **`pnpm test` cannot
  catch this class of bug** — the documented gate omits e2e.
- 5 of 6 `@smoke` specs pass, including notebook.

## Also outstanding

- **Workspaces `@smoke` fails** — pre-existing, unrelated. Playwright
  strict-mode violation: `getByText(folderName, {exact: true})` matches both the
  workspace selector and a tooltip trigger in the create dialog
  (`e2e/pages/features/workspaces/workspaces-page.ts:17`). Small and
  self-contained; fixing it gets the smoke suite fully green.
- **Product questions still open:** private vs. shared daemon; iframe vs.
  `WebContentsView`; whether v1 needs `.ipynb` open/save (the runtime is pinned
  by the file's `kernelspec` metadata, **not** the `?runtime=` param — a
  notebook without it defaults to Deno/TypeScript, so write
  `kernelspec.name: "python3"`).
- **Which Python environment** — still the most consequential open question, but
  **no longer entangled with the daemon decision.** The daemon is Python-free,
  so it can be settled independently, on its own merits, as a question about
  kernels rather than packaging.

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
  `echo exit=$?` — it can report a stale/wrong code. Check for the binary on
  disk.
- Reproducing the wheel finding needs no nteract build: `gh release download
v2.6.3-nightly.202607290952 --repo nteract/nteract --pattern 'runtimed-*.whl'`
  then `unzip -l`. A `.whl` is just a zip.
