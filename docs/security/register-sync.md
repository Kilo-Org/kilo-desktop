# Register sync — keep the boundary register matching the code

Shared first step of both security skills (`security-architecture` and
`threat-model`). Whichever skill runs first does the real work; the second run
should find nothing to change. Never skip it: both skills trust
[`boundary-register.md`](./boundary-register.md) only after it has been synced.

## Steps

1. **Existence check** — glob every file anchor in the register. A deleted or
   renamed path marks that row stale: find the new location (or remove the row
   if the boundary is gone).
2. **No line numbers** — the register cites files, never `file:line`. Strip any
   line references found.
3. **New-boundary scan** — sweep for undocumented boundary candidates:
   - `plugins/*/plugin.json` whose plugin is not represented in the register;
   - new `createServer` / `.listen(` / `net.fetch` / keyring / `openExternal` /
     `registerSchemesAsPrivileged` / `protocol.handle` / `spawn(` usages;
   - new CLI-distribution, relay, sidecar, or embedded-host code.

   Anything undocumented means the register is behind the code — add a row.

4. **Semantic drift** — covered by whichever skill runs next: both read the
   anchored files, so behavior changes (e.g. `ScopedFsService` stops rejecting
   escapes) surface during their walk; update the affected row when they do.
5. **Record changes** — keep a list of every register change (file + what
   changed). The calling skill reports it: `threat-model` in the scan report's
   Run notes; `security-architecture` in the overview's Version history row.

## Known limit

Structural drift is caught mechanically. A boundary that changed _meaning_ with
no mechanical trace is only covered by the PR maintenance-trigger rule in
`boundary-register.md`.

## Ordering

Because both skills sync first, there is no hidden dependency on run order. The
recommended refresh order is still **`security-architecture` → `threat-model`**:
the scan reads its attacker model from the overview, so refreshing the overview
first means the scan uses the current statement. See
[`README.md`](./README.md#how-to-refresh).
