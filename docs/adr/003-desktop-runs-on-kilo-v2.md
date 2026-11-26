# ADR-003: Desktop Runs on Kilo v2

**Status:** Accepted

## Context

Kilo Desktop's agent runtime is the bundled Kilo CLI server. Desktop was built
on Kilo v1 (`kilo serve`): kilo.core, kilo.chat and kilo.marketplace called it
through `@kilocode/sdk` and raw `/experimental/*` routes, kilo.chat's runtime
was `@assistant-ui/react-opencode` patched for v1's session model, and
Desktop's own Kilo server plugins used v1's plugin format.

Kilo v2 (`kilo2 serve`) is a rewrite with a different contract:

- `/api` routes with a generated client, `@kilocode/client`, which returns
  `{ data }` or cursor pages and decodes only a route's declared errors.
- Every call names a `location` (a folder); there is no per-directory header.
- `session.*` execution, step, text, tool, retry and inbox events replace
  `session.status` and v1's part updates. Streamed deltas aren't stored, and
  there is no event replay.
- Permissions are rules with `action` / `resource` / `effect`, replied with a
  `decision`; questions are forms.
- Kilo's own features (account, Marketplace, settings, generation) are plugin
  RPCs (`client.rpc` with `@kilocode/schema` definitions), which answer
  `rpc.unavailable` while a location's plugins load.
- Server plugins are `{ id, setup(ctx) }` modules loaded from directories,
  with hooks for tools, permissions and session requests.
- Kilo v2 keeps its data, config and credentials apart from v1 (`kilo2`
  directories), so the two never share chats.

The step-by-step mapping from v1 to v2, the gaps and the requirements for the
chat runtime are in [kilo-v2.md](../kilo-v2.md).

## Decision

Desktop runs only on Kilo v2.

- **One server, one client.** kilo.core stages and runs `kilo2` (from the
  `kilo-v2` npm tag, pinned by the lockfile), tied to Desktop's lifetime through
  stdin, with per-launch Basic auth. Every plugin that talks to Kilo uses
  `@kilocode/client`, and Kilo plugin RPCs go through `client.rpc`.
  `@kilocode/sdk` is removed.
- **No compatibility layer.** There is no v1 code path, no switch between
  server versions and no adapter that turns v2 data into v1 shapes. Contracts
  that carry Kilo data use Desktop's own types in v2's shapes, and Kilo's
  client and wire types stay out of contracts.
- **No migration.** Desktop does not import a person's v1 chats, sessions or
  data. Saved model preferences are cleared once, and work sessions are
  reconciled against the chats the v2 server has.
- **kilo.chat's runtime is a fork.** `@assistant-ui/react-opencode` is forked
  into `plugins/chat/react-opencode` and rewritten on v2's transcript, events
  and controller; the v1 patch's behaviours are kept as requirements or
  dropped by recorded decision.
- **Desktop's server plugins are v2 plugins.** kilo.core installs each as a
  plugin directory listed in Kilo's inline config: the tool gateway's caller
  context (an `execute.before` tool hook), the chat system prompt (a session
  `context` hook that gives the model the chat's per-prompt system text, which
  v2 prompts can't carry), and kilo.notebook's notebook tools (which keep
  their approvals asking through a `permission.evaluate` hook). Desktop's
  `desktop` MCP server opts out of Code Mode, so its tools keep their names.
- **Tests run on v2.** In-memory v2 fakes behind `@kilocode/client`
  (kilo.chat, kilo.marketplace), real-kilo2 integration tests with a stand-in
  Kilo API and model (`@kilo-desktop/plugin-core/testing`), and the packaged
  e2e suite against `kilo2`.

## Consequences

- People start on v2 with no chat history from v1, and their saved model
  choices reset once.
- Features v2 doesn't offer are hidden until it does: MCP Apps (no MCP
  resource-read or tool-call route) and in-place retry (retry sends the
  prompt again). Both are tracked in
  [plugin-architecture.md](../plugin-architecture.md#open-decisions-and-follow-ups).
- Signed out of Kilo, v2 lists only the gateway's free models.
- Kilo's lists and RPCs are incomplete while a folder starts, so callers wait
  for its plugins (`plugin.list`) or retry once on `rpc.unavailable`.
- Desktop follows the `kilo-v2` release line; a new v2 build is accepted as
  long as it is a compatible v2 server, and the client's generated types are
  the reference for every call.

## Rejected Alternatives

- **Supporting v1 and v2 side by side**, with a server version switch: two
  wire models through every plugin, and v1 is being retired.
- **Adapting v2 data to v1 shapes** so the existing code kept working: it
  would hide v2's model (locations, execution events, rules) behind lossy
  conversions and keep `@kilocode/sdk`.
- **Migrating v1 chats** into v2: the stores differ, and Kilo v2 deliberately
  keeps its data apart from v1.
- **Keeping upstream `@assistant-ui/react-opencode`** with a patch: it targets
  v1's session model, so the patch would have been a rewrite.
