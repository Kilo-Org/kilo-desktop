# kilo.pages (spike)

nteract Pages on this device: a celld sidecar serving Pages' Workers build, an
identity bridge standing in for the Kilo app, a Pages pane in a `<webview>`, and
a `pages-local` MCP server for the agent. What the plugin offers and uses is in
[docs/plugins/schema.md](../../../docs/plugins/schema.md) and its `plugin.json`;
its open items are in
[Open decisions and follow-ups](../../../docs/plugin-architecture.md#open-decisions-and-follow-ups).

## What building the spike settled

- **Pages runs locally on celld.** nteract Pages' Cloudflare Workers build
  (`apps/pages/dist`) runs under `celld dev` (Deno, Apache-2.0) with no Docker
  or cloud account. `prepare-assets` stages the build into
  `resources/pages-server/` and celld into `resources/celld/` (both gitignored,
  skipped with a note when missing); `PAGES_SERVER_DIR` and `PAGES_CELLD_PATH`
  override them in development. Packaging adds them as extra resources only
  when staged.
- **celld's project folder lives in plugin storage** (`server/`): the build is
  copied in (APFS clones, symlinks followed — celld refuses them) only when
  `build-receipt.json` changes; `wrangler.json` loses its cron `triggers`;
  `.dev.vars` (0600) is written each run. `.celld/dev` (every page) is never
  touched by a copy.
- **One identity for browser and agent without a Kilo account.** Pages already
  signs in through Kilo; the identity bridge in main stands in for the Kilo app
  (approves every sign-in with a one-time code, exchanges codes and its own
  agent tokens, a new exchange secret each run). Both appear to Pages as
  `user:kilo:local-user`.
- **The agent's environment never changes between runs.** The port, Pages'
  session secret and the agent token's signing key are kept in kv, so
  `PAGES_MCP_URL`/`PAGES_MCP_TOKEN` (and the MCP entry) are the same each run
  and the Kilo server isn't restarted; the first run restarts it once, when the
  port is chosen. A saved port held by a stale celld is reclaimed; only when it
  can't be is a new one taken.
- **The server starts when the app is ready** (Kilo connects to a remote MCP
  server once, with no retry), unless `KILO_PAGES_DEFER_SERVER=1` (packaged
  e2e). celld and its worker share a process group; stop sends SIGTERM, then
  SIGKILL (celld drains slowly and the worker outlives `celld dev`).
- **The pane is a `<webview>` on the browser partition** (the app CSP blocks
  loopback iframes; the host accepts guests only on that partition), opened at
  `/api/auth/login?return_to=/pages`. It needs `browser-host`. Pages' cookies
  share the Browser panes' session.

## Trust boundaries

For [docs/security-architecture-overview.md](../../../docs/security-architecture-overview.md),
which doesn't cover kilo.pages yet:

- a celld sidecar (a third-party Deno runtime running Pages' worker code) on
  `127.0.0.1:<saved port>`;
- the identity bridge on `127.0.0.1:<ephemeral>`, which mints a session for
  anyone who asks (any local process can sign in as the local user, as it could
  read the plugin's storage);
- a long-lived bearer token in the Kilo server's environment and the signing
  key in plugin kv.

Nothing leaves the device.
