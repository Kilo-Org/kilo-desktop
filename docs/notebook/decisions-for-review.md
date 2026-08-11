# Notebook integration — decisions to review

Audience: engineers who did not do the spike. Purpose: a discussion agenda.

> **Update:** sections 1.4–1.6 and any private-daemon discussion are superseded. The integration
> attaches to the user's externally installed singleton; Agentic Desktop does not distribute or
> own the daemon. Compatibility is negotiated by protocol number and semantic capabilities, not
> exact source revision.

Two halves. **Part 1** is calls already made where a real alternative existed — review
them, they are all still reversible at modest cost. **Part 2** is genuinely open, and
three of those need someone other than the implementer to decide.

Depth on any item lives in the source docs: `embedding-decisions.md` (D1–D6),
`protocol-csp-handoff.md`, `runtimed-standalone-daemon-handoff.md`,
`runtimed-private-instance-handoff.md`.

---

## Part 1 — calls made, with the option not taken

### 1.1 Ship nteract's built bundle as an asset, not as a library

**Chose:** treat nteract's `dist/` as a binary artifact we stage into our package, and
talk to its daemon over our own transport.

**Alternative:** import nteract as an npm dependency or a source dependency.

**Why:** the published `@nteract/*` packages are frozen since 2021 and React-16-pinned;
we are React 19, and the `react-redux`/`redux` version diamond has no resolution. The
live nteract UI is a `private` workspace app with no `exports` field, reachable only by
deep relative import, and it depends on a repo-root source tree via a Vite alias plus
module-global CRDT stores. Consuming it as source means adopting its alias graph,
Tailwind config, and custom Vite plugins.

**Confidence: high.** This one is not really a tradeoff, and it is the foundation the
rest rests on. Worth stating explicitly only because it is the reason we ship a 22MB
opaque bundle instead of components.

### 1.2 A loopback WebSocket relay, not an upstream `ElectronHost`

**Chose:** reimplement the two endpoints nteract's stock browser host expects — a config
endpoint and a WebSocket carrying typed frames — in our main process.

**Alternative:** write the `ElectronHost` that nteract's own types already pre-name,
routing frames over Electron IPC instead of a socket.

**Why:** the original plan assumed nteract's browser host was dev-only and that we would
have to author a ~680-line host upstream. That was wrong: only the _server_ half is
dev-gated. The client half ships in nteract's production bundle and is selected at
runtime whenever Tauri is absent, which is our case. Supplying the server half is
materially cheaper and removed what the first plan called the single biggest schedule
risk.

**Cost we accepted:** a loopback TCP listener in the app, and a CSP that must permit
`ws://127.0.0.1`. `ElectronHost` remains available later if we want to drop the socket.

**Discuss:** whether a loopback listener is acceptable to whoever owns our security
posture. It is bound to localhost and token-checked with an origin check on upgrade, but
it is a listening socket that did not exist before.

### 1.3 The notebook gets its own protocol origin

**Chose:** serve the bundle from a second host on our existing scheme —
`…://notebook/` alongside `…://app/`.

**Alternatives:** (a) a `/notebook/` path under the app origin, which is what the
original plan called for; (b) `WebContentsView`, which gets its own session entirely.

**Why:** three planned work items disappeared rather than being solved — no patch to
nteract's asset base path, no directory-index fallback, and no test inversion. More
importantly the notebook gets its own CSP, so the app's policy stays exactly as strict as
it is today instead of absorbing wasm-eval, `ws:`, and blob workers on nteract's behalf.
Storage isolation and IPC-trust exclusion fall out of the origin boundary for free.

**Confidence: high**, and verified — the frame's origin in the packaged app is
`anaconda-agentic-desktop://notebook`.

### 1.4 Attach to whatever daemon is running; spawn only if none is

**Chose:** probe the daemon's default socket. If something answers, use it. If nothing
does, spawn our bundled binary. Refuse a daemon built from a different commit.

**Alternative, and the one the first plan recommended:** run a private daemon on our own
socket path.

**Why the alternative is not available:** the daemon's single-instance guard is a file
lock whose location derives from the _compile-time release channel_, not from the socket
flag. A second daemon contends for the same lock regardless of socket, loses, and exits
with **code 0** — so a spawn looks successful while binding nothing. Connect-first makes
that collision harmless, because a lock holder implies a daemon on exactly the socket we
are already dialing.

**Cost we accepted:** we can collide with a user-installed nteract. See 2.1 — this is the
decision's live consequence and the most substantive thing on the agenda.

### 1.5 Refuse a version-skewed daemon rather than replacing it

**Chose:** compare commit hashes on attach; if they differ, report a terminal
`incompatible` state and do not connect.

**Alternative:** what nteract's own app does — run an installer to replace the running
daemon.

**Why:** killing a daemon we did not start could drop another application's live kernels
mid-execution, and the wire protocol has no downgrade path, so a mismatched connection
corrupts rather than failing cleanly. Refusing is the only safe option available to a
guest process.

**Note on comparison semantics, worth a sanity check from a second pair of eyes:** we
compare _commit_, never version number, because two builds of the same version number
from different commits are not interchangeable. A local build carrying no CI stamp is
treated as _unknown_ and allowed through — otherwise no developer could run the app
against a daemon they built. That looseness is deliberate but it is the kind of thing
worth someone disagreeing with.

### 1.6 Standalone per-platform daemon assets

**Chose:** add a publishing-only change to nteract's release workflow so it emits
standalone macOS and Windows daemon binaries, matching the Linux one it already
publishes.

**Alternatives:** (a) source the daemon from nteract's published Python wheel;
(b) extract it from nteract's signed desktop app in CI.

**Why:** the wheel route is dead, established by extracting real release assets rather
than by reading code — **all four published wheels contain no daemon binary at all.** An
upstream `.gitignore` causes the build tool to silently drop the binary CI stages into
it, and has done since the feature was added, with no CI assertion to catch it. The
daemon also turns out to have no Python dependency whatsoever, so routing it through
Python packaging was never the right shape.

**The tradeoff we took:** extraction from the signed app is the only route yielding an
_already notarized_ binary — nteract's macOS daemon is Developer-ID-signed and notarized
upstream. Standalone assets are copied from the build directory before signing, so **we
must sign them under our own identity.** We rejected extraction because nteract's Windows
build ships only an installer executable, which would need archive-extraction hackery in
CI.

**Discuss:** whether signing a foreign binary under our identity is a problem for
whoever owns our release process. This has been proven to work with ad-hoc signing on a
machine with no real signing identity available; **real Developer ID signing and
notarization of the daemon are still unproven** and can only be exercised in CI.

### 1.7 Loopback wildcard port in the notebook CSP

**Chose:** the notebook origin may reach `http://127.0.0.1:*`.

**Why:** the daemon's blob server binds an ephemeral port, so an exact-port policy would
make our CSP a function of a running subprocess. nteract's own production policy does
the same thing.

**Explicitly an interim position.** The better end state is serving blobs through our own
protocol from disk, which would tighten this back to `'self'` plus the relay socket.
Recorded so nobody mistakes it for a settled answer.

### 1.8 Two smaller structural calls

Listed for completeness; low stakes, but they set precedent.

- **The platform owns the embedded CSP, not the feature.** A feature declares its bundle
  root and routes; it does not supply a policy. Rationale: a CSP constrains the feature,
  so the constrained party should not author it — especially once features become
  loadable plugins. The alternative (a `csp` field on the capability) is simpler and was
  rejected on that ground alone.
- **The bundle root is contributed as a capability, not passed in from app startup.**
  Keeps any feature name out of our application bootstrap and platform layer. The
  alternative is meaningfully simpler to read and there is exactly one consumer today, so
  the generality is unearned — worth revisiting if a second embedded host never
  materializes.

---

## Part 2 — open

### 2.1 Private daemon or keep sharing? — needs a product call, not an engineering one

The live consequence of 1.4. If a user has nteract installed and its daemon was built
from a different commit than the one we bundle, the notebook does not work, and the only
remedy the user can carry out is quitting the other application.

Making that state unreachable means giving our daemon its own namespace. **An audit of
what that costs is complete, and it inverted the original plan.** The plan assumed a
_selective_ partition — isolate the lock and socket, keep the heavy caches shared. That
is unsafe: the daemon's environment-cache garbage collector builds its "in use" set from
its own process only, then deletes anything not in it. Two daemons sharing that cache
**delete each other's live Python environments while kernels are running against them.**
Everything under the shared directory came back as must-isolate, including the
package-trust database, which is both a security boundary between two different threat
models and not safe for concurrent access.

So the partition has to be wholesale, exactly as the daemon's own dev mode already does
it. **The honest price is roughly 3GB of duplicated Python per machine plus a second set
of kernel pools.** For calibration, one measured worktree's environment cache is 2.8GB
and the two release channels hold 3.9GB and 5.3GB.

**The decision:** accept ~3GB and a second kernel pool, weighed against how rarely the
collision fires — it needs a same-channel nteract built from a different commit than we
bundle.

**If that price is refused,** the fallback is not a cleverer partition; the audit closed
that door. It is either living with the reworded message permanently, or a fourth option
nobody has costed: **ship no daemon at all and only attach**, which makes the version
question someone else's problem at the cost of requiring nteract to be installed.

Shipped either way: the message now reads "Another app is already running the notebook
daemon. Quit nteract, then reopen this notebook," instead of naming two commit hashes.

> **Status caveat:** that rewording and one related cleanup exist as **uncommitted
> changes in a separate worktree** (`.claude/worktrees/runtimed-namespace`) and are on no
> branch. They need committing before anyone counts them as done.

### 2.2 Which Python environment? — the most consequential question here

The daemon manages its own environment pools. Anaconda has its own environment
management. Nobody has reconciled those.

This is a product question, not a technical one. Two things make it tractable now that
were not true earlier: the daemon has **no Python dependency of its own**, so this can be
settled on its merits as a question about kernels rather than about packaging; and it is
no longer entangled with how we source the daemon. But it does interact with 2.1 — a
private namespace duplicates the environment cache, and the GC finding above means
sharing it is not an option.

### 2.3 Interactive plots do not work, by design — is that shippable?

Text output, tracebacks, and markdown render and execute correctly in the packaged app.
Plotting libraries — plotly, vega, bokeh, panel — **do not render.** nteract puts rich
output in an isolated frame that inherits our parent policy, which grants no
`unsafe-eval`.

This is not a bug and not a regression. Fixing it means giving the output document its own
origin — a third protocol host, mirroring what nteract does in its own app. That is a
natural extension of 1.3, and a separate piece of work.

**Decide:** is a notebook without plots a shippable milestone, or does the third origin
belong in the same scope? This is the largest single functional gap.

### 2.4 Does v1 need opening and saving `.ipynb` files, or is a scratch notebook enough?

Scope question. One technical constraint to know: the kernel a notebook uses is pinned by
metadata inside the file, **not** by a URL parameter, and a notebook created without that
metadata defaults to TypeScript rather than Python.

### 2.5 UI-to-daemon version skew is unchecked

We enforce commit equality between the app and the daemon. The same constraint applies
between the _UI bundle_ and the daemon, and nteract's built output carries no version or
commit marker we can read — so a UI bundle from a different commit than the staged daemon
fails the same way a skewed daemon does, with nothing to catch it.

The cheap fix is upstream: stamp a marker into the notebook build the way CI already
stamps the daemon. nteract is Anaconda-owned, so this is a same-company change.

### 2.6 Legal review of third-party renderer bundles — gates shipping, not building

nteract is BSD-3-Clause and compatible with shipping in a proprietary product, with three
obligations: reproduce the notice in an in-app licenses screen; get sign-off before any
"powered by" copy, since the license restricts promotional use of the name; and — the one
that actually needs work — **the bundled third-party renderer artifacts (plotly, bokeh,
panel, vega, leaflet) are not covered by nteract's own license** and carry their own.

Untouched so far. Needs a real license scan, and it gates release rather than
development, so it should start in parallel rather than after.

### 2.7 Upstream publishing change is still a draft PR

The workflow change that publishes the daemon assets is open as a draft and has no
reviewer. It needs to be marked ready and landed. Note that its CI being green does not
prove the assets publish — the jobs that would exercise it skip on pull requests, so only
a real release run demonstrates it.

---

## Suggested agenda order

1. **2.1** (private vs shared daemon) — the only item blocked on a decision nobody has
   made, with a concrete price attached.
2. **2.2** (Python environments) — most consequential, and interacts with 2.1.
3. **2.3** (plots) — determines whether "v1" means something a user would recognize as a
   notebook.
4. **1.6 / 2.7** (daemon sourcing and signing) — needs whoever owns the release process.
5. **1.2** (loopback listener) — needs whoever owns security posture.
6. Everything else is informational.
