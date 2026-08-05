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

`runtimed-standalone-assets` @ `45f91612` (2 commits) in worktree
`~/.t3/worktrees/nteract/runtimed-standalone-assets`. **Pushed to origin as of
2026-08-05; still no PR** — opening one is the next upstream step.

**Risk 4 has not bitten.** The branch is still based exactly on `origin/main`
(`152eb6e4`, 0 commits behind as of 2026-08-05), so `release-common.yml` has not
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

### One real gap found — now fixed

**Done** in `45f91612`. The **release-body table advertised the daemon as
Linux-only.** In the
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

1. ~~**Add the release-body rows** above.~~ **Done**, `45f91612`.
2. **Land the branch upstream.** Pushed, but **no PR yet** — open one. It is safe
   to merge as additive assets — see
   [Verifying](#verifying-the-workflow-change) before doing so.
3. **Consume the assets in agentic-desktop.** **Partly done** (`76230fe`): the
   staging + `extraResource` half is built and proven in a real packaged bundle.
   What remains is sourcing the binary from a released asset instead of a local
   path, and signing under our identity. See
   [Daemon bundling, as built](#daemon-bundling-as-built).
4. **Pin by commit hash.** The commit-hash-equality constraint is unchanged: app
   and sidecar must be pinned to the same nteract commit, not merely a
   compatible protocol version. Pin explicitly. **Not yet done** — `RUNTIMED_BINARY`
   takes any path, with no version assertion.

## Daemon bundling, as built

`76230fe` in agentic-desktop. `apps/desktop/config/daemon-asset.ts` (+ colocated
test, 8 cases) stages the daemon into gitignored `apps/desktop/build/daemon/`;
`config/stage-daemon.ts` is the entry point, run via a new `prepare:daemon`
script that `premake`/`prepackage`/`prepublish` all reach through
`prepare:build`.

**Source is `RUNTIMED_BINARY`, a local path — not a download.** Deliberate: the
release assets do not exist until step 2 lands, so there is nothing to download
yet. Swapping in a fetch means changing only `stageDaemonBinary`'s source; the
staging, naming, guard, and `extraResource` wiring are source-agnostic.

Three things worth knowing before changing this:

- **Staging must be a script, not a Forge hook.** `extraResource` is a _value_ in
  `forge.config.ts`, evaluated at module load, so the file must already exist by
  then. Every Forge hook runs too late. This is why it hangs off `prepackage`.
- **The asset name should match `daemonBinaryBasename`, but not for the reason
  previously recorded here.** This doc used to claim the daemon derives its Unix
  socket and Windows pipe name from its own file basename, so renaming the asset
  would point the app at the wrong pipe. **That is wrong.** The channel comes from
  the _compile-time_ `option_env!("RUNT_BUILD_CHANNEL")`
  (`crates/runt-workspace/src/lib.rs:43-45`), and both the pipe name
  (`daemon_binary_basename_for`, `:75`) and the cache namespace
  (`cache_namespace_for`, `:60`) are derived from that channel — never from
  `argv[0]` or `current_exe()`. Renaming the staged file changes nothing at
  runtime. Keep the names aligned anyway, so the asset on disk describes which
  channel it was built from.
- **A magic-byte guard rejects non-executables** (Mach-O thin/universal, ELF, PE).
  A truncated download or an HTML error page saved under the right filename would
  otherwise package fine and only fail at spawn.

Verified on real hardware: the daemon lands at
`Contents/Resources/runtimed-nightly` in the packaged `.app` and runs from there
(`--version` → `2.6.3+22d094c`, exit 0). `codesign --force --options runtime`
over it succeeds, `--verify --strict` passes, and it still runs after signing —
so hardened-runtime signing does not break the binary. **That was ad-hoc
signing: there are 0 valid codesigning identities on this machine**
(`security find-identity -v -p codesigning`), so real Developer ID signing and
notarization remain unproven and can only be exercised in CI, which populates
`APPLE_SIGNING_IDENTITY` (`.github/actions/setup-macos-codesign/action.yml:59`).

Also confirmed: `socket-path.ts` predicts the daemon's socket location exactly.
Running the real daemon logs
`Socket: "/Users/…/Library/Caches/runt-nightly/runtimed.sock"`, which is
byte-identical to `resolveDaemonSocketPath()` for the same env. That assumption
is no longer a guess.

## Spawn and supervise the daemon

Was: **nothing spawns the daemon** — `mainRegister` only queried it. Being built
now, hanging off the lazy-start pattern in `features/notebook/index.ts:38` and the
`mainSdk.onDispose` at line 56, with path resolution in `index.ts` (`*Service.ts`
files are lint-forbidden from importing electron).

### What the daemon's CLI actually guarantees

Read out of the Rust source rather than assumed; each of these shaped the design.

- **Bare `runtimed` == `runtimed run`, in the foreground** (`crates/runtimed/src/main.rs:439`,
  defaults `:467-476`). No `fork`/`daemonize` anywhere, so it is a normal child to
  supervise. `--socket <path>` overrides the endpoint; `--log-level`, `--dev`, and
  pool-size flags are the other relevant ones.
- **No machine-readable readiness signal.** No pid file, no stdout handshake —
  only a `tracing` line to stderr and `{daemon_base_dir}/runtimed.log`
  (`[runtimed] Listening on "<path>"`, `daemon.rs:2124`, Windows `:2442`). **Poll
  the socket instead**, which is what nteract itself does. Bind happens before
  pool init, so a successful connect is a valid readiness edge.
- **`RUNTIMED_SOCKET_PATH` panics if the parent directory is missing**
  (`runt-workspace/src/lib.rs:1211-1219`) — confirmed. Worse, it is checked
  _before_ the `#[cfg(windows)]` pipe branch (`:1171-1176`), so on Windows a
  filesystem-style value becomes the pipe name and fails to create. Prefer the
  `--socket` flag over this env var.
- **`RUNTIMED_CACHE_NAMESPACE` is not read by any Rust code** — only by nteract's
  TS/Vite files. `RUNT_BUILD_CHANNEL` is compile-time only; setting either at
  runtime does nothing. Our `socket-path.ts` honors both, which is harmless but
  should not be mistaken for a way to relocate a spawned daemon.
- **No idle auto-shutdown.** It runs until told to stop.
- **Graceful shutdown is Unix-only.** SIGTERM/SIGINT → `trigger_shutdown()`
  (`main.rs:787-817`), which drains rooms and unlinks the socket
  (`daemon.rs:2336-2338`) — but shutdown can legitimately _fail_ and leave it
  running when a room isn't durable (`daemon.rs:1682-1689`), so a supervisor needs
  a SIGKILL timeout. Windows has **no signal path at all** (the handler block is
  `#[cfg(unix)]`); nteract's own service stop is `taskkill /F`. Kernels are safe
  either way: process groups killed via `killpg` on Unix
  (`runtime_agent_handle.rs:190-207`), Job Objects with `KILL_ON_JOB_CLOSE` on
  Windows (`runtime_agent_manifest.rs:412-448`), so they die with the daemon
  rather than orphaning.

### Decision: daemon identity — default path, connect-first

**The finding that drove this.** The single-instance guard is an `flock` on
`{daemon_base_dir}/daemon.lock` (`crates/runtimed/src/singleton.rs:60-98`,
acquired in `Daemon::new`, `daemon.rs:1522`) — and `daemon_base_dir()` is derived
from the **channel and dev-mode**, _not_ from `--socket`. On lock loss the process
logs "Another daemon already running" and calls **`std::process::exit(0)`**
(`main.rs:768-782`) — a success exit code. So two daemons of the same channel
collide on the lock even with different `--socket` values, and the loser looks
like a clean spawn while binding nothing.

Options considered:

1. **Default path, connect-first** ← **CHOSEN.** Probe the default socket; if a
   daemon answers, use it. Otherwise spawn our bundled binary bare (no `--socket`)
   and poll until it binds. This makes the lock collision _harmless_: a lock
   holder implies a daemon on exactly the socket we are already connecting to.
   `socket-path.ts` is verified byte-identical to the daemon's own computation for
   this path. Cost: we share with a user-installed nteract of the same channel, so
   the commit-hash pinning check below stops being optional.
2. **Private via dev-mode isolation.** `RUNTIMED_DEV=1` +
   `RUNTIMED_WORKSPACE_PATH=<our app-support dir>` relocates base dir, socket,
   _and_ lock under `worktrees/<hash>/` — true isolation. Rejected: repurposes a
   dev-only flag in production, also relocates logs and caches, and carries
   unknown other dev-mode behavior differences.
3. **Private via `--socket` only.** Isolates the socket but not the lock, so a
   user's nteract daemon silently prevents ours from ever binding. Rejected as
   actively broken.

This supersedes the older "recommend a private instance with an explicit
`RUNTIMED_SOCKET_PATH`" note — that recommendation predates the lock finding and
is option 3, the broken one.

### Decision: supervision — restart with backoff

Options considered:

1. **Restart with capped exponential backoff** ← **CHOSEN.** Respawn on
   unexpected exit, with a give-up threshold, surfaced through the status channel.
   Matches nteract's own service definitions (launchd `KeepAlive{Crashed}`,
   `runtimed-service/src/lib.rs:753-788`; systemd `Restart=on-failure`, `:250-273`).
2. **Spawn once, no restart.** Smaller surface, but a crashed daemon would leave
   the feature dead until the next status call.

### Consequences to respect when implementing

- **Do not hold the child's stdio pipes open.** nteract's own Windows service
  spawns with all three stdio set to NUL and warns that a held parent pipe hangs
  interactive callers (`runtimed-service/src/lib.rs:951-966`). Either `ignore`
  them or drain them; do not leave a full pipe unread.
- **An exit code of 0 is not proof we own the daemon** — it is what the lock loser
  returns. Readiness must be established by connecting, never by "spawn didn't
  fail."
- **Watch for an early child exit while polling.** nteract's xtask polls readiness
  and `try_wait()`s the child in the same loop so an immediate exit is reported
  instead of timing out (`xtask/src/main.rs:3110-3130`). Worth copying.
- **Commit-hash pinning is now load-bearing, not hygiene.** Because we may attach
  to a user's daemon, the version check moves onto the critical path. nteract's own
  Tauri app version-checks the running daemon's commit hash and upgrades on
  mismatch (`crates/notebook/src/lib.rs:2074-2100`). Still **not done** here.

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

## State of agentic-desktop

`t3code/9d5bc891`, **12 commits unpushed, no PR.**

- Relay + daemon client transport built, registered in `FEATURES`, tested at all
  four tiers. Full gate green: `pnpm check && pnpm lint && pnpm format:check &&
pnpm test` (**660 tests** after this session's additions).
- Notebook suite run 10× consecutively — 99/99 each time, no socket-timing
  flakiness.
- `e29cb35` fixed a real packaging regression (`ws` missing from the main
  bundle's Vite externals → rolldown inlined a CJS package into ESM output →
  `require("events")` crashed the packaged app at startup). **`pnpm test` cannot
  catch this class of bug** — the documented gate omits e2e.
- **`@smoke` is 6/6** — green for the first time, verified against a bundle that
  contains the daemon.

## Also outstanding

- ~~**Workspaces `@smoke` fails.**~~ **Fixed**, `4c188ff`. The page-wide
  `getByText(folderName, {exact: true})` matched both the workspace selector and
  a tooltip trigger in the create dialog; the assertion is now scoped to the
  combobox, which is what its failure message already claimed to check.
  Confirmed with a negative control (asserting a sentinel name fails), so the
  test still has teeth.
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
- **Build `out/` with `package:e2e`, never plain `package`.** `electron.launch`
  waits for `"Debugger listening on"`, which needs the
  `EnableNodeCliInspectArguments` fuse — gated on `ELECTRON_ENABLE_INSPECT`,
  which only `package:e2e` sets. A plain `pnpm package` yields an `out/` that
  looks fine and then **hangs every spec silently** until the timeout, with no
  error. Cost me a 10-minute dead end this session.
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
