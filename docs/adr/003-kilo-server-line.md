# ADR-003: Kilo server line (v1 or v2), chosen at build time

**Status:** Accepted. Supersedes the first version of this ADR ("Kilo server
plugins"), which put server code in `kilo.server-v1` / `kilo.server-v2`
behind backend extension points picked by a run-time flag.

## Context

Kilo Desktop is moving from the Kilo v1 server (`kilo serve`, `@kilocode/sdk`)
to the Kilo Code v2 server (`kilo2`, `@kilocode/client`, npm dist-tag
`kilo-v2` from Kilo-Org/kilocode `origin/v2`); see
[the compatibility report](../kilo-v2-compatibility.md). The Kilo-server code
lives in kilo.core (main), kilo.chat (mostly renderer, including the
react-opencode fork) and kilo.marketplace (main).

The v1 → v2 period is meant to be short, and users will not be supported on
both. A seam built so v1 and v2 can coexist would have one contributor after
cutover, which the architecture treats as a red flag, and building it costs
more than the migration's own changes.

Kernel constraints: every id is `<pluginId>/<name>` and ownership is enforced,
so only a plugin whose id is `kilo.core` may provide `kilo.core/*`; one
process registers one plugin per id; nothing chooses a plugin set before the
kernel boots; and those ids are written into other plugins' manifests,
contract imports and saved state (pane kinds, storage folders, allow-lists).

## Decision

- **v2 copies with the same ids.** kilo.core, kilo.chat and kilo.marketplace
  each get a v2 copy in its own package (`plugins/core-v2`,
  `plugins/chat-v2`, `plugins/marketplace-v2`; `@kilo-desktop/plugin-*-v2`)
  whose manifest keeps the id `kilo.core`, `kilo.chat` or `kilo.marketplace`.
  A copy is made only when that plugin's migration starts, so the two copies
  drift for as short a time as possible.
- **Same contracts.** A v2 copy re-exports its v1 package's contracts
  (`@kilo-desktop/plugin-core/contracts` …) until cutover, so no other plugin
  changes and their tests keep booting the v1 packages.
- **Build-time selection.** `KILO_SERVER_LINE` (`v1` default, or `v2`;
  anything else fails the build) is read by
  `@kilo-desktop/bundled-plugins/server-line`. The main and renderer Vite
  configs alias each copied plugin's entry subpaths (`main`, `web`,
  `plugin.json`) to its v2 package, so the bundled list and both entry maps
  stay as they are, no plugin id appears in `apps/*/kernel`, and v1 code does
  not ship in a v2 build. Contracts are not aliased (the v2 copy imports
  them from the v1 package). Forge stages kilo.core's CLI resources from the
  line's package, and main receives the line as the `KILO_SERVER_LINE`
  define where it resolves plugin assets in development.
- **react-opencode.** The v1 fork stays at `plugins/chat/react-opencode`;
  `plugins/chat-v2` carries its own copy translated to `@kilocode/client`.
- **CI** builds and tests the v1 line; a v2 job is added once `plugins/core-v2`
  boots.
- **Cutover** deletes the v1 packages, moves the contracts into the v2
  packages, drops the `-v2` names and deletes `server-line.ts` and its
  aliases.

## Rejected alternatives

- **Per-version server plugins behind backend extension points**, picked by
  a launch-latched `kernel/flag` (the first version of this ADR): a large
  up-front refactor of three plugins for a seam that would have one
  contributor after cutover.
- **Migrating in place on a long-lived branch**: no duplication, but `main`
  could not build or test v2, and the branch would need repeated rebases.
- **A launch-time switch** carrying both lines in one build: needs the host
  to choose plugins before the kernel boots and tell every window.

## Consequences

- Fixes to the three v1 plugins during the migration may need repeating in
  their v2 copies; v2 work stays in the v2 packages.
- Other plugins' tests cover only v1 until cutover; v2 is covered by the v2
  packages' own tests and by e2e against a v2 build.
- A v2 package must be resolvable from the importing app (it is a workspace
  dependency of `apps/desktop` and `apps/web`) for its alias to work.
