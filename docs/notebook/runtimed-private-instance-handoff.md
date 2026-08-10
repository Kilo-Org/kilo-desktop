# Running our own `runtimed`, or sharing the user's — handoff

Status: **investigation.** Nothing built. This supersedes one recommendation in
`embedding-handoff.md` §5 and reframes a user-facing failure mode.

Scope: whether agentic-desktop should spawn a private `runtimed` daemon or attach
to whatever daemon is already running, and what each costs. Independent of §3/§4
(serving nteract's SPA, CSP) — different files, different repos, no ordering
constraint.

## What we do today

`DaemonProcessService.#ensure()`:

1. Probe the daemon's **default** socket path.
2. Something answers → attach (`external`), compare commit hashes.
3. Nothing answers → spawn our bundled binary, poll until its socket accepts.
4. No binary bundled → `failed` (an expected state, not a crash).

Three of the five terminal states are "not our process": `external`,
`incompatible`, `failed`.

## The handoff doc's advice does not work

`embedding-handoff.md` §5 recommends "a private instance with an
explicit `RUNTIMED_SOCKET_PATH` under our own app-support dir."

**The lock is not keyed on the socket.** The single-instance guard is an `flock`
on `{daemon_base_dir}/daemon.lock`, where `daemon_base_dir` comes from the
compile-time channel (`crates/runt-workspace/src/lib.rs:1075`), not from
`--socket`. A second daemon with a different `--socket` still contends for the
same lock, loses, and **exits with code 0** after logging "another daemon already
running."

So a spawn can appear to succeed while binding nothing. This is why
`DaemonProcessService` probes before spawning, stays on the default path, and
treats readiness as _only_ a completed connection — never a successful spawn.
Those three decisions are load-bearing; don't "simplify" them.

## Why sharing hurts: `incompatible` is a dead end

Typed-frame v4 requires **commit-hash equality**, not just protocol equality. A
user-installed nteract of the same channel built from a different commit is
reachable but unusable — frames corrupt rather than failing cleanly.

`#attachToExternal` detects this and returns `incompatible`, which is terminal:

- Can't displace it — it owns the lock.
- Can't kill it — that could drop another app's live kernels mid-execution.
- Can't speak to it — v4 has no downgrade path.

`index.ts` deliberately reports `daemon: null` in this state so the UI can't show
a healthy version string for a connection that will corrupt on first frame.

Deliberate looseness: if **either** side lacks a CI-stamped commit hash the
verdict is `unknown` and we proceed, because otherwise every locally-built daemon
would be rejected. `+dirty` is ignored — uncommitted edits aren't a different
commit.

### What the user currently sees

`NotebookView.tsx:34`, `daemonAbsenceMessage`:

> "A different notebook daemon is already running (2.6.3+abc1234); this app needs
> 2.6.4+def5678."

**This is not shippable.** It names two SHAs the user cannot act on and offers no
remediation. Neither obvious remedy is good either:

- _"Install version X"_ — wrong. They'd have to match **our bundled commit**, and
  nteract's stable releases won't line up with whatever we pinned.
- _"Quit nteract"_ — works, but our app demanding they close another app to open a
  notebook is a poor experience.

A second, unnamed risk of sharing: if we attach to a user's daemon and it dies,
our restart logic acts on **their** daemon, and both apps' in-flight execution is
at stake.

## A private namespace would make the state unreachable — but it is not cheap

The lock lives at `{cache_dir}/{namespace}/daemon.lock`, where namespace is
`runt` or `runt-nightly`, hardcoded by `cache_namespace_for`
(`crates/runt-workspace/src/lib.rs:61`). If that honored an env override, we'd get
our own namespace, our own lock, our own daemon — and `incompatible` could not
occur.

Two precedents suggest this is the intended shape:

- `is_dev_mode()` **already** partitions the lock dir per worktree
  (`worktrees/{hash}`, line 1080). Concurrent daemons demonstrably work; we'd be
  adding a second partitioning key.
- `SHARED_CACHE_NAMESPACE` (`runt-shared`, line 137) exists precisely for state
  that must be visible across channels and worktrees — "never under a per-channel
  `cache_namespace_for` root."

**Correction to an earlier estimate: this is not a ~5-line change.**
`daemon_base_dir()` roots much more than the lock:

| Rooted at `daemon_base_dir()`      | Location                                                |
| ---------------------------------- | ------------------------------------------------------- |
| environments cache (`envs/`)       | `crates/runtimed/src/paths.rs:25`                       |
| `trusted-packages.sqlite`          | `crates/runtimed/src/lib.rs:83`                         |
| `notebook-registry.sqlite`         | `crates/runtimed/src/lib.rs:87`                         |
| `agents.json`, `kernels.json`      | `crates/runtimed/src/runtime_agent_manifest.rs:100,105` |
| `inline-envs/`                     | `crates/runtimed/src/inline_env.rs:150`                 |
| `tools/`                           | `crates/kernel-launch/src/tools.rs:46`                  |
| `notebook.log`, `mcp-logs/`        | `crates/runt-workspace/src/lib.rs:1094,1106`            |
| `session.json`, `workstation.json` | `crates/runt-workspace/src/lib.rs:1238,1257`            |

Partitioning the namespace wholesale duplicates **all** of it — including the
Python environments cache, which is gigabytes. The partition must be selective:
lock and socket move, heavy shared caches stay. Deciding which is which is the
actual design work, and `SHARED_CACHE_NAMESPACE` is the existing mechanism for
expressing it.

nteract is Anaconda-owned, so this is a same-company change rather than an
upstream negotiation — but the blast radius, not the review gate, is the cost.

## Separate bug, worth fixing regardless

Our `socket-path.ts` reads `RUNTIMED_CACHE_NAMESPACE`. **The nteract Rust never
reads it.** Repo-wide it appears only in
`apps/notebook/vite-plugin-browser-relay.ts:122` and a slide deck.

So our TS honors an override the daemon ignores: set it and we compute a socket
path nothing is listening on. Either drop the variable or get Rust to honor it —
but don't leave the divergence.

## Options

- **(a) Selective private namespace.** Add an env override to
  `cache_namespace_for`, moving lock + socket while keeping heavy caches under
  `runt-shared`. Makes `incompatible` and `external` unreachable. Cost: the
  audit above, plus a second set of kernel pools (RAM).
- **(b) Keep sharing, make `incompatible` actionable.** Reword to "Quit nteract
  and reopen this notebook." Cheap, honest, but leaves a real dead end and the
  shared-daemon restart risk.
- **(c) Pin to nteract's stable releases** so commits match by construction.
  Removes our freedom to pin a daemon build; likely incompatible with
  commit-hash equality in practice.

Recommend **(a)**, with **(b)**'s reworded message shipped immediately as the
fallback either way — (a) is not a prerequisite for shipping something honest.

## Suggested order

1. Fix the `RUNTIMED_CACHE_NAMESPACE` divergence. Small, independent, no design
   needed.
2. Reword `incompatible` and `failed` in `daemonAbsenceMessage`. `failed`'s "no
   daemon binary is bundled with this build" is developer-facing too.
3. Audit `daemon_base_dir()` callers: which need per-instance isolation, which
   belong in `runt-shared`. This is the decision, not the code.
4. Implement the override in nteract Rust + our `socket-path.ts`.
5. Verify two daemons coexist, then that `incompatible` is unreachable.

Steps 1–2 are independently shippable and don't depend on the design question.

## Open questions

- Which `daemon_base_dir()` consumers can be shared vs must be isolated? The
  environments cache almost certainly should stay shared — duplicating gigabytes
  of Python per app is not acceptable — but the trust database is a security
  boundary and may not be safely shareable across apps.
- Does a private daemon change the Python-environment story? The
  already-open question of reconciling the daemon's uv/conda/pixi pools with
  Anaconda's own environment management gets harder if we isolate the env cache.
- Should `external` survive at all? If (a) lands, attaching to a foreign daemon
  becomes a choice rather than a necessity — and we may not want it.
