# Embed the nteract notebook in agentic-desktop — scoping brief

Intended as the basis for a JIRA epic. Deliberately free of file paths and line numbers;
implementation detail lives in `embedding-handoff.md`,
`protocol-csp-handoff.md`, and `runtimed-standalone-daemon-handoff.md`. Decisions and
their alternatives are in `decisions-for-review.md`.

## Goal

Ship nteract's notebook UI inside the packaged agentic-desktop application — installed
with it, executing real Python, with no development server and no separate install step
for the user.

## What this is, in five pieces

The integration treats nteract as a **product we ship inside ours**, not as a library we
compile against. That shapes everything below.

1. **The notebook UI** — nteract's built web bundle, staged into our application package
   as an asset (~22MB) and served from our own internal URL scheme. The app frames it.
2. **Its own origin** — the bundle is served from a dedicated origin, separate from the
   app's. That gives the notebook its own security policy, its own storage, and no access
   to app internals, without loosening anything for the rest of the application.
3. **A transport in the main process** — the notebook UI expects to talk to a local
   notebook daemon. We supply that connection: the app's main process speaks the daemon's
   binary wire protocol over a local socket and bridges it to the UI over a
   localhost-only WebSocket.
4. **The daemon, bundled and supervised** — nteract's `runtimed` daemon ships inside our
   package as a native binary. The app starts it on demand, watches it, restarts it on
   crash with backoff, and shuts it down cleanly on quit.
5. **Kernels** — the daemon manages Python processes and executes cells. This is the one
   piece we neither ship nor control, and it is where the largest open question sits (see
   Open questions).

Roughly: `app renderer → notebook frame → local WebSocket → main process → daemon →
Python kernel`.

## Current state

**The end-to-end path is proven in a real packaged application.** As of 2026-08-05, on a
signed-adjacent local build: the notebook renders, a Python kernel starts, and cells
execute — `sum(range(101))` returns `5050` against Python 3.13. Zero security-policy
violations and zero failed subresource loads, verified through the browser devtools
protocol in both the app page and the notebook frame.

Complete and tested at all four of our test tiers, with the full quality gate green:

- Wire protocol client and codec, with byte-level tests against the protocol spec
- The local relay standing in for nteract's development-only server component
- Daemon location, staging into the package, and start/supervise/dispose
- Version-skew detection: a daemon built from a different commit is refused, not used
- Serving the bundle from its own origin, with the security policy that requires
- Packaging: the bundle and the daemon both land correctly in a built application

## What remains

Sized relatively, not in hours. Nothing here is a research task — the unknowns were
resolved during the spike.

### Must have before shipping

| Work                                        | Size | Notes                                                                                                                                                                                                                                           |
| ------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Land the upstream release-workflow change   | S    | Publishes the daemon binary for macOS and Windows. Currently a draft PR with no reviewer. Same-company change, not an external negotiation.                                                                                                     |
| Source the daemon from a published asset    | S    | Today it comes from a local path via an environment variable. Needs to become a real download, with the commit verified at build time rather than at runtime.                                                                                   |
| Sign and notarize the bundled daemon        | M    | **The main unproven risk.** The daemon is signable and runs after signing, but this has only been shown with ad-hoc signing on a machine with no real signing identity. Real Developer ID signing and notarization can only be exercised in CI. |
| End-to-end smoke coverage of cell execution | M    | A packaged-application test that opens the notebook and executes a cell. Existing smoke coverage asserts the surface renders and the daemon is reachable; it does not execute anything.                                                         |
| Third-party license review                  | S–M  | Gates release, not development, so start it early. See Open questions.                                                                                                                                                                          |
| Resolve the daemon-sharing decision         | —    | Decision, not implementation. See Open questions.                                                                                                                                                                                               |

### Needed for a notebook users would call complete

| Work                                              | Size | Notes                                                                                                                                                                                                                                  |
| ------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interactive plots                                 | M    | Plotly, vega, bokeh and panel currently do **not** render. Text, markdown and tracebacks do. Fix is a third origin for the output document, mirroring what nteract does in its own application. Known limitation by design, not a bug. |
| Serve output attachments through our own protocol | M    | Needed for images, plots and dataframes. Also lets us tighten the notebook's network policy from a localhost wildcard back to same-origin.                                                                                             |
| Open and save `.ipynb` files                      | ?    | Unscoped — depends on whether v1 is a scratch notebook or a file-backed one. See Open questions.                                                                                                                                       |

### Optional / later

- Replace the localhost WebSocket with direct application IPC. Removes a listening socket
  from the app; requires authoring a component that nteract's own types anticipate but
  nobody has written. **Not blocking** — this was originally believed to be the biggest
  schedule risk and turned out to be avoidable entirely.
- Stamp a version marker into nteract's UI build, so UI-to-daemon version skew is caught
  the same way app-to-daemon skew already is. One-line upstream change for a real gap.

## Open questions — decisions needed, mostly not from engineering

1. **Which Python environment do notebooks use?** The daemon manages its own environment
   pools; Anaconda has its own environment management. Nobody has reconciled them. This
   is the most consequential question on the list and it is a product question. It is now
   answerable on its own merits — the daemon has no Python dependency of its own, so this
   is a question about kernels, not about packaging.

2. **Do we run our own daemon or share the user's?** Today we attach to whatever notebook
   daemon is already running and only start our own if none is. If a user has nteract
   installed and its daemon was built from a different commit than ours, the notebook does
   not work, and the only remedy is quitting the other application. Making that
   impossible requires giving our daemon its own isolated state — **which costs roughly
   3GB of duplicated Python per machine plus a second set of kernel processes.** The
   investigation is complete and that price is firm; someone needs to accept or refuse it.
   Detail in `runtimed-private-instance-handoff.md`.

3. **Is a notebook without interactive plots a shippable milestone?** Determines whether
   the plot work is in this epic or the next one.

4. **Does v1 need file open/save, or is a fixed scratch notebook enough?** Scope
   question.

5. **License review of bundled renderer artifacts.** nteract itself is permissively
   licensed and fine to ship in a proprietary product, subject to including a notice and
   getting sign-off on any promotional use of the name. But the third-party rendering
   libraries bundled alongside it are **not** covered by that license and carry their own.
   Needs a real scan, and it gates release.

## Risks

- **Notarizing the bundled daemon is the largest unproven step.** Everything else in the
  remaining work has been at least partially exercised; this one has not, and it can only
  be exercised in CI. Worth doing early rather than at the end.
- **Our standard test gate cannot catch this class of integration.** A packaging
  regression during the spike broke the packaged application at startup while the entire
  unit and integration suite stayed green — the gate omits packaged end-to-end tests.
  Anything touching packaging or process supervision needs a packaged verification, not a
  green suite.
- **Version coupling is tight by design.** The app and the daemon must be built from the
  same commit; the protocol fails closed with no compatibility fallback. This is a
  permanent operational constraint on how we release, not a bug to fix — every release
  pins a specific nteract commit.
- **nteract is Anaconda-owned**, which removes the review gate on upstream changes but not
  the coordination cost. Several items above are upstream changes.

## What has been de-risked

Worth stating, because the original assessment was wrong about all four:

- Authoring a notebook host component upstream was called the biggest schedule risk. It
  is **not needed at all** — nteract's stock bundle already selects a path we can serve.
- Building the daemon for macOS and Windows was called a hard blocker needing new build
  toolchains. It was only a **publishing** gap; nteract already compiles all four targets.
- The daemon was assumed to need Python. It **does not** — no Python dependency at all,
  which decoupled the packaging question from the environment question.
- Whether any of this could work in a packaged, security-policy-constrained application
  was unproven. **It now demonstrably does.**
