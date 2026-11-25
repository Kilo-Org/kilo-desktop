# Kilo v2 server: what Desktop uses and how it maps

Desktop is moving from the Kilo v1 server (`kilo serve`, `@kilocode/sdk`) to the
Kilo v2 server (`kilo2`, `@kilocode/client`), v2 only. This document maps every
Desktop interaction with the server to its v2 equivalent and lists the gaps. It
is the reference for the migration steps; update it as each area moves.

Sources: Kilo-Org/kilocode branch `origin/v2` (surveyed at `3036835f40`,
2026-11-24) and the published client types at `0.0.0-v2-239`. Start upstream
with `migration-tracking/technical-notes/v1-v2-client-breaking-changes.md`,
`packages/protocol/src/groups/*.ts`, `packages/schema/src/*.ts` and
`packages/kilo-vscode` (a working v2 client).

Status in the tables: **same** (rename at most), **changed** (new route, shape
or semantics), **missing** (no v2 equivalent; see [Gaps](#gaps)).

## Packages and versions

| Package                  | Use                                                            | Version                                |
| ------------------------ | -------------------------------------------------------------- | -------------------------------------- |
| `@kilocode/client`       | HTTP + SSE client (`OpenCode.make`), typed `client.rpc()`      | catalog `kilo-v2` (now `0.0.0-v2-239`) |
| `@kilocode/schema`       | Wire types and Kilo RPC definitions (`kilocode/*`)             | catalog `kilo-v2`                      |
| `@kilocode/cli-<target>` | `kilo2` binary per platform, staged by kilo.core's `fetch-cli` | catalog `kilo-v2`                      |

- Desktop tracks the `kilo-v2` dist-tag. The lockfile fixes each build;
  `pnpm update "@kilocode/*"` moves it forward. Runtime version checks accept
  any compatible v2 build rather than one exact version.
- The client depends on the schema under its upstream alias
  (`@opencode/schema` → `npm:@kilocode/schema`). Importing definitions from
  `@kilocode/schema/kilocode/<name>` and passing them to `client.rpc()`
  type-checks; pnpm resolves both names to one package.
- The promise client (`@kilocode/client`, `./promise`) has no runtime
  dependency on `effect` or Node built-ins, so it is safe in the renderer.
  `@kilocode/schema` (RPC definitions) depends on `effect` 4.1.0; renderer code
  that calls RPCs pulls `effect` into its bundle.
- `@kilocode/sdk` has no v2 release; it is removed once nothing imports it.
  `@kilocode/protocol` comes in transitively and is not imported directly.

## Conventions every call changes

- **Every route is under `/api`.** Responses are unwrapped by the client (no
  `{ data }`); list calls return `{ data, cursor: { next?, previous? } }`, and
  location-scoped reads return `{ location, data }`. Methods throw on error.
- **Location, not directory.** `directory` becomes `location: { directory }`
  (or header `x-opencode-directory`). Session-scoped calls take no location;
  the server resolves it from the session. Rows expose `location.directory`.
- **Auth:** HTTP Basic, user **`opencode`**, password from
  `KILO_SERVER_PASSWORD`.
- **Model and agent are session state:** `session.switchModel` /
  `session.switchAgent` before a prompt, not fields on every prompt. A model
  reference is `{ providerID, id, variant? }`.
- **IDs:** `ses_`, `msg_`, `evt_`, `per_` (permissions), `frm_` (forms). Message
  content blocks have no IDs.
- **Kilo-specific calls are plugin RPCs:** `POST /api/rpc/:rpcID/:method`,
  called as `client.rpc(<X>Rpc.Definition).<method>(input, { location })`.
  RPC events arrive as `rpc.<rpcID>.<event>`. RPCs register after the
  location's plugins load; a call can briefly fail with `rpc.unavailable`.

## Desktop's shared contracts

Contracts other plugins use carry v2's shapes, so consumers move once:

- `PermissionRule` is `{ action, resource, effect }` (`Permission.Rule`).
- `PermissionRequest` is `{ id, chatId, action, resources, save?, message?,
  metadata, toolKey? }`; `replyPermission` takes `{ decision }` (`once`,
  `always`, `reject`) and no `interactive` flag.
- kilo.chat's `PermissionInteraction` follows it (`action`, `resources`,
  `save`); `kilo.chat/permission-renderer` matches `actions` (was
  `permissions`) and offers `showResources` (was `showPatterns`).
- Auto-approve leaves to a person what v2 marks `interactive: true`, plus
  `sandbox_escalation` / `browser_sensitive` and their flags (as v2's VS Code
  client does); v1's `configProtected` and `skillShell` flags are gone.
- `McpServerEntry` is v2's `Mcp.ServerConfig` (`local` / `remote`, `disabled`
  rather than `enabled`); agent extensions use `system` (was `prompt`) and
  `subagent` (was `subtask`).
- `KiloProfile` is flat: `email`, `name`, `organizations`,
  `hasPersonalAccount`, `organizationId`, `balance`, `kiloPass`.
- Desktop's `ModelRef` (`{ aiProviderId, modelId }`) is a domain type, not a
  wire type, and keeps its names; saved model preferences start again in
  `models-preferences-v2`.

Every kilo.core producer is on the v2 client (steps 5–6); nothing converts to
v1 shapes any more.

## Server process (kilo.core `KiloServerManager.ts`)

| v1                                                                                                | v2                                                                                          | Status  | Notes                                                                                                          |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| binary `kilo`                                                                                     | `kilo2` / `kilo2.exe`                                                                       | changed |                                                                                                                |
| `serve --hostname --port=0 --cors`                                                                | `serve --hostname --port 0 --cors --stdio`                                                  | changed | `--stdio` prints one JSON line `{"url":…}` and exits when stdin closes (`packages/cli/src/server-process.ts`). |
| `KILO_PARENT_PID`                                                                                 | stdin lifetime                                                                              | changed | Keep the stdin pipe open; closing it stops the server.                                                         |
| Basic user `kilo`                                                                                 | Basic user `opencode`                                                                       | changed | `--stdio` strips the password from the environment tools inherit.                                              |
| `GET /global/health` → `{ healthy, version }`                                                     | `client.server.info()` (`GET /api/info`) → `{ version, pid, urls, … }`                      | changed | Also `kilocode.handshake.get` → `{ product, version, channel }`. No `healthy` field.                           |
| `POST /telemetry/setEnabled`, `KILO_TELEMETRY_LEVEL`                                              | none                                                                                        | missing | v2 has no CLI telemetry.                                                                                       |
| `KILO_APP_NAME`                                                                                   | `KILO_CLIENT`                                                                               | changed | Some v2 plugins gate on the client name.                                                                       |
| `KILO_PLATFORM`, `KILOCODE_FEATURE`, `KILO_MACHINE_ID`, `KILO_API_URL`, `KILO_API_KEY` (stripped) | same                                                                                        | same    | Gateway headers and URL (`packages/kilo-gateway-core`).                                                        |
| `KILO_CONFIG_DIR` (layered over global)                                                           | `KILO2_CONFIG_DIR` **replaces** the global dir; `KILO2_CONFIG=<file>` is the additive layer | changed | v1 `KILO_CONFIG_DIR` is ignored.                                                                               |
| `KILO_CONFIG_CONTENT`                                                                             | same                                                                                        | same    | Contents must use v2 config keys.                                                                              |
| `XDG_CONFIG_HOME`, `XDG_STATE_HOME`                                                               | same                                                                                        | changed | Roots become `<base>/kilo2`; database `kilo2.db`, separate from v1.                                            |
| `KILO_ENABLE_QUESTION_TOOL`                                                                       | none needed                                                                                 | same    | The question tool is native, gated by the `question` permission.                                               |
| `KILO_EXPERIMENTAL_MCP_APPS`                                                                      | none                                                                                        | missing | See MCP Apps.                                                                                                  |
| `KILO_TREE_SITTER_WASM_DIR`, `NO_PROXY`, `KILO_DESKTOP_WEBMCP_*`                                  | same                                                                                        | same    | `{env:…}` substitution still works in config.                                                                  |
| `instance.dispose` + `server.instance.disposed`                                                   | `debug.location.evict({ location })` (204 after disposal) or `location.reload()`            | changed | No event wait needed.                                                                                          |

**What Desktop does** (`KiloServerManager.ts`):

- Spawns `kilo2 serve --hostname 127.0.0.1 --port <n> --stdio --cors <origin>`
  with stdin piped and held open; stopping closes stdin and only signals the
  process group when the server hasn't exited.
- Probes `GET /api/info` with Basic `opencode:<password>`. Any v2 build that
  answers with a version is accepted; a v1 server fails the probe (404).
- Passes `KILO_SERVER_PASSWORD`, `KILO_CLIENT=desktop`, `KILO_PLATFORM`,
  `KILOCODE_FEATURE`, `KILO_MACHINE_ID`, `KILO_API_URL`,
  `KILO_TREE_SITTER_WASM_DIR`, `KILO_CONFIG_CONTENT` and
  `KILO2_CONFIG=<app config dir>/kilo2.jsonc` (Desktop's layer over the user's
  global config; `KILO2_CONFIG_DIR` would replace it). Inherited `KILO2_*` and
  `OPENCODE_*` variables are dropped.
- Keeps Kilo's data and cache roots inherited, so chats and credentials are
  shared with the Kilo v2 CLI and VS Code; state goes under kilo.core's storage.
- A plugin module in the old v1 shape (`{ id, server }`) is skipped by v2
  without failing the server or the location, so Desktop's managed plugins stay
  in the inline config until they are ported.

## Config (`KiloConfigManager`, inline config, WebMCP relay)

- File `kilo2.json` / `kilo2.jsonc` in `<XDG_CONFIG_HOME>/kilo2/`; project dir
  `.kilo2/`. `kilocode.settings.target({ scope })` returns the path.
- Renamed keys: `permission` (map) → `permissions` (ordered
  `[{ action, resource, effect }]`); `agent` → `agents`; `command` →
  `commands`; `provider` → `providers`; `plugin` → `plugins` (strings or
  `{ package, options }`); `mcp.<id>` → `mcp.servers.<id>`.
- Remote MCP entry (the `mcp.desktop` WebMCP relay):
  `{ type: "remote", url, headers, oauth: false, disabled? }` (no `enabled`).
- Reads: `kilocode.settings.read({ scope })` → `{ document }`;
  `config.get` returns per-document entries, not one merged object.
  Writes: `kilocode.settings.write({ scope, set, unset, expected })`.
- Inline config: permission rules use v2 actions (`shell`, not `bash`).

## Account, models, work style and config: what Desktop does

These areas are on v2 (`account/kilo-client.ts`, `models/kilo-models-client.ts`,
`work-style/production.ts`, `KiloConfigManager.ts`):

- **Account:** status, profile, balance, Kilo Pass and organisation through
  `kilocode.gateway`; device sign-in through `integration.oauth.connect`
  (`kilo` / `device`) and `status` polling (cancel through `oauth.cancel`);
  sign-out removes the `kilo` integration's credentials; changes are applied
  with `location.reload()`.
- **Models:** one read of `provider.list`, `model.list`, `integration.list`,
  `model.default` and `kilocode.gateway.models` (free flag, ranking,
  description, BYOK). Kilo fills the catalog in after startup, so the models
  area re-reads on `provider.updated`, `model.updated`, `integration.updated`,
  `credential.*` and on every stream (re)connect.
- **Keys:** `integration.connect.key` against the provider's integration;
  removal deletes that integration's credentials.
- **Custom AI providers:** entries under `providers` in the user's global
  config (`Config.Provider`: `package`, `settings.baseURL`, `headers`,
  `models.<id>.capabilities` / `limit`), written with `kilocode.settings`
  (leaf writes; removed keys sent as `null`). The entry is written before the
  key, because Kilo creates the provider's integration from it.
- **Work style:** v2 permission rules are an ordered list where the last match
  wins, so Review first appends the preset (VS Code's v2 `HUMAN_PERMISSIONS`)
  after the user's global `permissions`; switching back restores the list it
  replaced.
- **Desktop's config file** is `<app config dir>/kilo2.jsonc` in v2 keys
  (`mcp.servers`, `agents`, `commands`, `providers`). The WebMCP relay entry is
  a v2 remote server without `enabled`. Global writes go to the user's
  `~/.config/kilo2` file, never to Desktop's layer, so the two never collide.
- **Starting locations:** integration calls (Kilo's own `kilo` sign-in comes
  from a plugin) fail with an unexplained 500 until the location's plugins
  load; Desktop waits with `locationPluginsReady` first. Lists are empty until
  then too.

## Account, models, work style (kilo.core)

| v1                                              | v2                                                                                                          | Status  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------- |
| `kilo.authStatus`                               | `kilocode.gateway.authStatus({})`                                                                           | same    |
| `kilo.profile` (one object)                     | `kilocode.gateway.profile` + `balance` + `kiloPass`                                                         | changed |
| `kilo.organization.set({ organizationId })`     | `kilocode.gateway["organization.set"]({ organizationID })`                                                  | changed |
| `provider.oauth.authorize` / `callback`         | `integration.oauth.connect({ integrationID: "kilo", methodID: "device" })`, poll `integration.oauth.status` | changed |
| `auth.set({ type: "api", key })`                | `integration.connect.key({ integrationID, key })`                                                           | changed |
| `auth.remove({ providerID })`                   | `credential.list()` then `credential.remove({ credentialID })`                                              | changed |
| `global.dispose()`                              | `location.reload()`                                                                                         | changed |
| `provider.list` → `{ all, default, connected }` | `provider.list` + `model.list` + `model.default`; connected from `credential.list` / `integration.list`     | changed |
| `global.config.get` / `update`                  | `kilocode.settings.read` / `write`                                                                          | changed |

The model catalog fills in after startup: the first list can be partial; reload
on `provider.updated` / `model.updated`.

## Chats in the main process (kilo.core `conversations/*`)

| v1                                                                              | v2                                                                                                    | Status  | Notes                                                                                                 |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `experimental.session.list({ roots, archived: true, cursor })`                  | `session.list({ parentID: null, limit, order, cursor })`                                              | changed | Opaque cursor. `archived: true` returns **only** archived; omit it for both.                          |
| `session.get({ sessionID, directory })`                                         | `session.get({ sessionID })`                                                                          | changed | `location.directory`; `title` optional; `permission` → `permissions`.                                 |
| `session.status`                                                                | `session.active()` → `{ [id]: { type: "running" } }` plus `session.execution.*` events                | changed | Running sessions only.                                                                                |
| `session.create({ directory, model, permission, metadata })`                    | `session.create({ location, agent, model, metadata, permissions })`                                   | changed |                                                                                                       |
| `session.update({ time: { archived }, permission })`                            | `session.update({ sessionID, title, metadata, permissions, archived: boolean })`                      | changed | Changes arrive as `session.renamed` / `metadata.updated` / `archived` / `unarchived` / `permissions`. |
| `session.fork({ messageID, directory })`                                        | `session.fork({ sessionID, before })`, then `session.move` for another directory                      | changed | The fork is a root in the source's location, titled "… (fork #n)", with its metadata and rules.       |
| `promptAsync({ noReply: true, parts: [synthetic] })`                            | `session.synthetic({ sessionID, text, resume: false })`                                               | changed |                                                                                                       |
| `promptAsync({ parts, agent, model, variant, system, snapshotInitialization })` | `session.prompt({ sessionID, text, files, agents, skills, metadata, delivery })`                      | changed | `system`, `snapshotInitialization`: see Gaps. Returns once admitted, not when the turn ends.          |
| `session.command({ command, arguments, model: "p/m" })`                         | `session.command({ sessionID, name, text })`                                                          | changed |                                                                                                       |
| `session.abort`                                                                 | `session.interrupt({ sessionID, resume?, steer? })`                                                   | changed |                                                                                                       |
| `session.delete`                                                                | `session.remove({ sessionID })`                                                                       | changed |                                                                                                       |
| `session.prompt({ format: json_schema })` → `info.structured`                   | none                                                                                                  | missing | See Gaps (structured generation).                                                                     |
| `branchName.generate`                                                           | `kilocode.branch-name.generate({ sessionID, prompt, providerID, modelID })` → `{ branch }`            | same    |                                                                                                       |
| `kilocode.drainSession({ token })`                                              | `kilocode.session-drain.drain({ sessionID, token })`; done event `rpc.kilocode.session-drain.drained` | same    |                                                                                                       |
| `permission.list`                                                               | `permission.request.list({ location })`, or `permission.list({ sessionID })`                          | changed | `permission`/`patterns` → `action`/`resources`.                                                       |
| `permission.reply({ requestID, reply, message, interactive })`                  | `permission.reply({ sessionID, requestID, decision, message })`                                       | changed | `decision`: `once` / `always` / `reject`. No `interactive`.                                           |
| `question.list`                                                                 | `form.list({ location })` or `session.form.list({ sessionID })`                                       | changed | Questions are forms with `metadata.kind === "question"`.                                              |
| `question.reply({ answers: string[][] })`                                       | `session.form.reply({ sessionID, formID, answer: { q0, q1, … } })`                                    | changed |                                                                                                       |
| `question.reject`                                                               | `session.form.cancel({ sessionID, formID, message? })`                                                | changed |                                                                                                       |
| `global.event` + `x-kilo-sse-skip-fork-sync`                                    | `event.subscribe({ types? }, { signal })` (`GET /api/event`)                                          | changed | One stream for all locations, no replay, no `sync` wrapper. First event `server.connected`.           |

### What kilo.core's chats do on v2 (step 6)

- `kilo-chat-client.ts` is the only chat client: one `@kilocode/client`, calls
  by session id (the server resolves the location), Kilo RPCs in the chat's
  directory through `callLocationRpc`.
- One `event.subscribe({ types, signal })` stream. On every (re)connect it
  first opens the stream, then reads the full root list (paged, cursor only
  after the first page), `session.active()` and, for running or still-waiting
  chats only, `permission.list` / `session.form.list`; what the stream said
  meanwhile wins (`store.ts` epochs).
- Activity: busy from `session.execution.started`, retry from
  `session.retry.scheduled` until the next `session.step.started`, idle on
  `succeeded` / `failed` (with `{ type, message }` as the chat's error) /
  `interrupted`. Questions are forms with `metadata.kind === "question"`.
- `session.created` carries no times: the event's `created` stamps the chat.
  Renames, metadata, archive and moves update known chats from their own
  events.
- A fork is announced only by `session.forked { sessionID, parentID }` (no
  `session.created`); the fork already carries the source's metadata (the
  `kilo-desktop` stamp) and permission rules, so Desktop's
  apply-rules-then-publish dance (`unfinished-forks`, `lost-forks`) is gone.
  Desktop forks in place, so it never needs `session.move`. Other clients'
  forks are looked up by id.
- `user-message` comes from `session.inbox.enqueued` with a `user` item (once
  per inbox id); its model is the prompt's selection or the chat's last
  `session.model.selected`. Synthetic notes and copied fork history are never
  announced.
- Prompts: `switchAgent` (only when it changes) and `switchModel`, then
  `session.prompt` with text parts joined and files as `{ uri, name }`.
  kilo.chat's per-prompt `system` is stored on the user message's metadata
  (`metadata["kilo-desktop"].system`) until step 14's server plugin feeds it
  to the model.
- `kilo.core/chats` gains `findMissing({ ids })` and a `listed` event after
  every full read. kilo.work-sessions (work sessions' `chatIds` and chat
  panes) and kilo.git (branch-namer progress) drop the ids the server lacks on
  each `listed`, which on the first v2 launch is every v1 chat.
- `kilo.core/generation`: `generate` is one `experimental.generate.text` reply
  (no tools, no chat) with the JSON schema written into the prompt, checked
  with `z.fromJSONSchema` and asked once more on a mismatch;
  `generateCommitMessage` is `kilocode.commit-message.generate` (kilo.git's
  commit action uses it); `generateBranchName` is
  `kilocode.branch-name.generate`.

## Events

Frame: `{ id: "evt_…", created, type, location?, data, metadata? }`; durable
events also carry `durable: { aggregateID, seq, version }`. Text, reasoning and
tool-input deltas are ephemeral; the matching `*.ended` carries the full value.
After a reconnect, reload with `session.active()` and list calls, or replay one
session with `experimental.session.log({ sessionID, after, follow })`.

| v1                                           | v2                                                                                                                                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session.created` (`info`)                   | `session.created` (flat `data`)                                                                                                                                                                            |
| `session.updated`                            | split: `session.renamed`, `metadata.updated`, `archived` / `unarchived`, `moved`, `permissions`, `agent.selected`, `model.selected`, `revert.*`, `usage.updated`                                           |
| `session.deleted`                            | `session.deleted`                                                                                                                                                                                          |
| `session.status`, `session.idle`             | `session.execution.started` / `succeeded` / `failed` / `interrupted`, `session.retry.scheduled` (defined `session.status` is never published)                                                              |
| `session.error`                              | `session.execution.failed { error }`, `session.step.failed`                                                                                                                                                |
| `session.compacted`                          | `session.compaction.started` / `delta` / `ended` / `failed`                                                                                                                                                |
| `message.updated`                            | `session.step.started` (new assistant message), `session.step.ended` (finish, cost, tokens, snapshot), `session.inbox.delivered` (user message), `session.synthetic`                                       |
| `message.removed`                            | `session.revert.committed { to }`, `session.inbox.cancelled`                                                                                                                                               |
| `message.part.updated` / `delta` / `removed` | `session.text.*`, `session.reasoning.*` (by `ordinal`), `session.tool.input.*` (by call `id`), `session.tool.called` / `progress` / `success` / `failed`, `session.message.content.updated` (full replace) |
| `permission.asked` / `replied`               | same names; payload `{ id, sessionID, action, resources, save, metadata, source: { messageID, id } }` / `{ sessionID, requestID, reply }`                                                                  |
| `question.asked` / `replied` / `rejected`    | `form.created { form }` / `form.replied { id, sessionID, answer }` / `form.cancelled { id, sessionID }`                                                                                                    |
| —                                            | `session.inbox.enqueued` / `delivered` / `cancelled` / `delivery.changed`                                                                                                                                  |

## Messages and content

v2 messages are a union on `type`: `user`, `assistant`, `synthetic`, `system`,
`skill`, `shell`, `compaction`, `idle`, `agent-switched`, `model-switched`,
`location-switched`. Each step is its own `assistant` message with an ordered
`content[]` of `text`, `reasoning` and `tool` blocks; keep arrival order.

| v1 part                  | v2                                                                                                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| text                     | assistant `{ type: "text", text }`; user messages have one `text`                                                                                                                                                          |
| reasoning                | `{ type: "reasoning", text, time? }`                                                                                                                                                                                       |
| file                     | user `files[]` `{ data, mime, source, name }`; tool output `ToolFileContent { uri, mime, name }`                                                                                                                           |
| tool                     | `{ type: "tool", id, name, executed?, time, state }`; state `streaming { input: string }`, `running`, `completed { input, content[], metadata }`, `error { input, error, content? }`; no `title`, output as content blocks |
| step-start / step-finish | the assistant message itself; `finish`, `cost`, `tokens`, `snapshot.{ start, end }`                                                                                                                                        |
| patch                    | `assistant.snapshot.files` / `step.ended.files`                                                                                                                                                                            |
| retry                    | `assistant.retry { attempt, at, error }`                                                                                                                                                                                   |
| compaction               | `compaction` message `{ status, reason, summary }`                                                                                                                                                                         |
| agent                    | `user.agents[]`                                                                                                                                                                                                            |
| subtask                  | none; the `subagent` tool creates a child session (`parentID`)                                                                                                                                                             |

History: `message.list({ sessionID, limit ≤ 200, order: "desc" })` for the
first page, then `message.list({ sessionID, cursor: cursor.next })` (do not
resend `order` with a cursor). No `X-Next-Cursor`, no `before`, no unbounded
load.

### Observed on kilo2 (step 7, `0.0.0-v2-239`)

`plugins/chat/src/test/kilo2/golden-turn.json` is a recorded turn (stand-in
model, a `read` tool call) that `golden-turn.test.ts` re-records on every run.

- A prompt publishes `session.inbox.enqueued` (user item, `delivery: "steer"`),
  `execution.started`, `inbox.delivered`; the user message is stored then.
- Each step: `step.started { agent, model (with variant), assistantMessageID,
  started }`, `step.first-token`, parts, `step.streamed`, `step.ended { finish,
  rawFinish, tokens, cost }`, then `usage.updated` with the chat's totals.
- Text and reasoning: `*.started { ordinal }`, `*.delta`, `*.ended { text }`
  (ordinals count per type). A part that arrives whole is one delta.
- Tool: `tool.input.started { id, name }`, `tool.input.ended { text }` (no
  delta for whole input), `tool.called { input, executed: false }`,
  `tool.success { content, metadata, executed }`.
- The turn ends with an `idle` message `{ outcome }` and
  `execution.succeeded`. The title request runs alongside: its usage is added,
  then `session.renamed`.
- Frames: `durable` on everything but deltas, `step.first-token` and
  `usage.updated`. Order across event types varies a little between runs;
  order within a type doesn't.
- `message.list` pages: `cursor.previous`/`next` encode the anchor message and
  order; a cursor with `order` is `InvalidCursorError`.
- Errors decode as tagged objects (`_tag`, `message`, fields) for declared
  statuses; an undeclared status is a `ClientError` (`UnexpectedStatus`).

## Chat renderer (kilo.chat and its react-opencode fork)

Since step 8 the runtime is Desktop's own source package
`@kilo-desktop/react-opencode` (`plugins/chat/react-opencode`): upstream
`@assistant-ui/react-opencode@0.2.17` (assistant-ui `c67168ee`) with the old
pnpm patch applied as source. The patch, the `@opencode-ai/sdk` override and the
`opencode-sdk-compat` shim are gone; it still uses `@kilocode/sdk` (v1) until
steps 9–12 rewrite it on `@kilocode/client`.

- Two patch behaviours existed only in the shipped `dist`, not the patch's
  `src` diff, and were ported by hand: synthetic text shows only while its step
  runs (with `Initializing snapshot` as `opencode-snapshot-progress`), and a
  user message's synthetic text is hidden.
- The fork now goes through the React Compiler (renderer builds and kilo.chat's
  browser tests). `openCodeExtras.use(…)` is a hook the compiler doesn't
  recognise, so `useOpenCodePermissions` / `useOpenCodeQuestions` opt out with
  `"use no memo"`; the compiler skips `useOpenCodeRuntime.ts` on its own. Keep
  this in mind while rewriting it.

### Patch behaviours: requirements for the v2 rewrite

What Desktop's former patch added to upstream, as requirements rather than code
to port. Steps 9–12 keep each one on v2 or record a decision to drop it; tick
each off as its step lands. "Where" is the fork's file today, "Guarded by" the
tests that pin it (port them to v2 with the behaviour).

| #   | Requirement                                                                                                                        | Where (fork)                                              | Guarded by                                                            | v2 step / note                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| R1  | Pluggable backend: global and per-session clients, an injected event subscriber (kilo.chat owns the one stream)                    | `types.ts` `OpenCodeRuntimeBackend`, `useOpenCodeRuntime` | `OpenCodeThreadController.test.ts`                                    | 10, 12: one `@kilocode/client` and one `/api/event` stream                      |
| R2  | History paging: newest 50, then older pages on demand                                                                              | `OpenCodeThreadController`, `openCodeThreadState`         | `OpenCodeThreadController.test.ts`, `openCodeThreadState.test.ts`     | 10: `message.list` cursors (`cursor.next` goes older in `desc`)                 |
| R3  | Status sync on load and reconnect, ignoring a reply older than a newer one                                                         | `OpenCodeThreadController`                                | `OpenCodeThreadController.test.ts` (reconnect cases)                  | 10: `session.active` + execution events; no `session.status`                    |
| R4  | A running thread stays attached when hidden; a hidden idle thread marks itself stale and reloads when shown                        | `OpenCodeThreadController`, `useOpenCodeRuntime`          | `kiloReattach.test.ts`, `useOpenCodeControllerState.browser.test.tsx` | 10                                                                              |
| R5  | Revert and unrevert applied from the REST response; reverted messages hidden by id order                                           | `openCodeThreadState`, projection                         | `kiloRevert.test.ts`                                                  | 10: `session.revert.stage/commit/clear`, `session.revert.staged` events         |
| R6  | Human permission approvals reply as interactive                                                                                    | `OpenCodeThreadController.replyToPermission`              | `kiloPermissionInteractive.test.ts`                                   | 11: v2 reply is `{ decision, message }`; likely drop the flag (record it)       |
| R7  | MCP App registry: local apps and `mcpApp` metadata stamp `mcp.app` on tool calls                                                   | `openCodeMessageProjection` (`setLocalMcpApps`)           | kilo.chat `mcp-apps/*` tests                                          | 12: hidden until v2 has MCP resource routes (decision)                          |
| R8  | A stopped, unfinished or halted-between-steps turn projects as `incomplete/cancelled` ("You stopped")                              | projection (`endsBetweenSteps`)                           | `kiloStopStatus.test.ts`                                              | 9: from `idle { outcome: "interrupted" }` and `session.execution.interrupted`   |
| R9  | Stable step grouping (tool calls and reasoning under their step)                                                                   | projection (`parentId`)                                   | `openCodeMessageProjection.test.ts`                                   | 9: one assistant message per step                                               |
| R10 | Hidden background and synthetic messages; synthetic text shows only while its step runs; synthetic text in user messages is hidden | projection                                                | `kiloSnapshotProgress.test.ts`, `openCodeMessageProjection.test.ts`   | 9: v2 `synthetic` messages are their own type                                   |
| R11 | Projection cache: a streamed token re-projects only the message it touched                                                         | `createOpenCodeProjectionCache`                           | `kiloProjectionCache.test.ts`                                         | 9                                                                               |
| R12 | Snapshot progress shown as an `opencode-snapshot-progress` data part                                                               | projection                                                | `kiloSnapshotProgress.test.ts`                                        | 9: v2 publishes no snapshot progress note; likely drop (record it)              |
| R13 | Client-side message queue (pause, reorder, edit, steer), replaceable by the host                                                   | `openCodeMessageQueue`, `messageQueue.create`             | kilo.chat `prompt-queues.test.ts`, `composer-extras.browser.test.tsx` | 10: Desktop's main-process queue stays (decision); fork's built-in queue can go |
| R14 | One runtime that switches from the optimistic new thread to the live one without remounting                                        | `useOpenCodeRuntime`                                      | kilo.chat `agent-pane.browser.test.tsx` (first send)                  | 10                                                                              |
| R15 | Session titles mirrored into the thread list, without echoing them back                                                            | `useOpenCodeRuntime`, `openCodeThreadListAdapter`         | kilo.chat chat-pane tests                                             | 10: follow `session.renamed`                                                    |

| v1                                                           | v2                                                                                                                 | Status  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------- |
| `createKiloClient({ baseUrl, headers, directory })`          | `OpenCode.make({ baseUrl, headers })`; location per call                                                           | changed |
| `session.messages({ limit, before })`                        | `message.list` (see History)                                                                                       | changed |
| `session.revert({ messageID })` → `Session`                  | `session.revert.stage({ sessionID, messageID, files? })` → `SessionRevert`; `session.revert.commit`                | changed |
| `session.unrevert`                                           | `session.revert.clear`                                                                                             | changed |
| `session.summary.diffs`, `SnapshotFileDiff`                  | `FileDiffInfo`; `session.revert.files`; `session.diff({ sessionID, from, to })`                                    | changed |
| `promptAsync({ messageID, parts: [] })` (retry in place)     | none                                                                                                               | missing |
| `session.summarize({ providerID, modelID })`                 | `session.compact({ sessionID, delivery? })` (session's model; steers by default)                                   | changed |
| `app.agents`                                                 | `agent.list({ location })`; `AgentInfo { id, name, model?, mode, hidden, color? }`                                 | changed |
| `command.list`                                               | `command.list({ location })`; `CommandInfo { name, description, template, model }` (no `agent`, `source`, `hints`) | changed |
| `mcp.status`                                                 | `mcp.list({ location })` → `McpServer[]`                                                                           | changed |
| `file.read({ path })` → `{ content, encoding }`              | `file.read({ location, path })` → `Uint8Array`                                                                     | changed |
| `kilocode.sessionModelUsage`                                 | none                                                                                                               | missing |
| `/experimental/resource/read`, `/experimental/mcp/call-tool` | none                                                                                                               | missing |
| `/experimental/resource?server=`                             | `mcp.resource.catalog({ location })` (filter by `server` client-side)                                              | changed |

## Tools

| v1                                                                                               | v2             | Input / metadata                                                                                       |
| ------------------------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------ |
| `read`                                                                                           | `read`         | `filePath` → `path`                                                                                    |
| `edit`                                                                                           | `edit`         | `path`; metadata `files: [FileDiff]` (not `diff`)                                                      |
| `write`                                                                                          | `write`        | `path`, `content`                                                                                      |
| `bash`                                                                                           | **`shell`**    | `command`, `workdir`, `timeout`, `background`; progress `{ shellID, output, status }`                  |
| `apply_patch`                                                                                    | **`patch`**    | `patchText`; metadata `files`                                                                          |
| `task`                                                                                           | **`subagent`** | `agent`, `description`, `prompt`, `model`, `sessionID`, `background`; metadata `{ sessionID, status }` |
| `skill`                                                                                          | `skill`        | `name` → `id`                                                                                          |
| `grep`, `glob`, `websearch`, `webfetch`, `question`, `plan_exit`, `semantic_search`, `todowrite` | same           | `grep` adds `literal`, `caseSensitive`, `limit`                                                        |
| `list`, `todoread`, `codebase_search`                                                            | none           |                                                                                                        |

MCP tools are named `<server>_<tool>`.

## Marketplace (kilo.marketplace)

| v1                                   | v2                                                                                                   | Status  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- | ------- |
| `GET /kilocode/marketplace`          | `kilocode.marketplace.list({ kind, refresh, query })` + `kilocode.marketplace.installed({})`         | changed |
| `POST /kilocode/marketplace/install` | `kilocode.marketplace.install({ registry, kind, id, scope, option, params })` (`preview` for review) | changed |
| `POST /kilocode/marketplace/remove`  | `kilocode.marketplace.uninstall({ registry, kind, id, scope })`                                      | changed |
| `GET /agent`, `GET /skill`           | `agent.list`, `skill.list` (no `native` / `source` / builtin marker)                                 | changed |
| `GET /mcp`                           | `mcp.list` (`pending` new; `needs_client_registration` gone)                                         | changed |
| `POST /mcp/:id/auth/authenticate`    | `integration.oauth.connect({ integrationID: server.integrationID, methodID })`, poll status          | changed |

## Desktop server plugins (notebook, tool-gateway caller context)

| v1                                                     | v2                                                                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `export default { id, server }`                        | `export default { id, setup(ctx) }`, loaded through config `plugins: ["file:///…"]`                                    |
| hook `tool.execute.before(input, output)`              | `ctx.tool.hook("execute.before", e => …)`; `e` has `tool`, `sessionID`, `agent`, `messageID`, `id`, mutable `input`    |
| `{ tool: { name: { description, args, execute } } }`   | `ctx.tool.transform(ed => ed.add({ name, description, input, execute }))`; result `{ content, metadata }` (no `title`) |
| tool context `ask`, `abort`, `directory`, `metadata()` | `ctx.permission.assert({ sessionID, action, resources, save, metadata })`, `signal`, `ctx.location`, `progress()`      |
| `event` hook                                           | `ctx.event.subscribe({ types })`                                                                                       |
| `config` hook                                          | none; `ctx.permission.hook("evaluate")` or `ctx.agent.transform` instead                                               |
| —                                                      | session request hooks can edit `system` per request (`packages/plugin/src/promise/session.ts`)                         |

## Gaps

Per the plan, Desktop features with no v2 equivalent are hidden and recorded
until v2 supports them. Gaps with a v2 workaround are adapted instead.

| Gap                                                        | Desktop impact                                                  | Handling                                                                                                                                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MCP resource read and tool call routes                     | MCP Apps widgets (`mcp-apps/*`)                                 | **Hide.** v2 also never sets `metadata.mcpApp` on tool calls.                                                                                                                  |
| `kilocode.sessionModelUsage`                               | Per-model usage breakdown                                       | **Hide.** Totals remain (`SessionInfo.cost` / `tokens`, `session.usage.updated`).                                                                                              |
| CLI telemetry                                              | Telemetry toggle's effect on the server                         | **Hide** the server side; Desktop's own telemetry is unaffected.                                                                                                               |
| Structured output on `session.prompt`                      | `generation.ts` (git commit and PR text, other JSON generation) | **Adapted (step 6):** `kilocode.commit-message.generate` for commit messages; otherwise `experimental.generate.text` with the schema in the prompt, zod validation, one retry. |
| Per-prompt `system`                                        | Per-chat workspace context sent with each prompt                | **Adapt (step 14):** a Desktop server plugin edits `system` in a session request hook. Until then it is stored on the user message's metadata and the model doesn't see it.    |
| `snapshotInitialization: "wait"`                           | Snapshot readiness before a turn                                | **Dropped (step 6):** v2 always captures a step's start snapshot before its local tools run (`core/src/session/runner/step.ts`); generation no longer uses a chat at all.      |
| Retry in place (`promptAsync({ messageID, parts: [] })`)   | Retry a failed turn                                             | **Adapt:** resend the user's text as a new prompt (optionally after `revert.stage` + `commit`).                                                                                |
| `interactive` on permission replies                        | Auto-approve tracking                                           | **Drop** the flag.                                                                                                                                                             |
| Plugin `config` hook                                       | Notebook plugin's permission edits                              | **Adapt:** permission rules in Desktop's config or `ctx.permission.hook("evaluate")`.                                                                                          |
| `AgentInfo.native` / `source`, skill builtin marker        | Marketplace's "installed vs built-in"                           | **Adapt:** derive from `kilocode.marketplace.installed`.                                                                                                                       |
| `KILO_PARENT_PID`, `x-kilo-sse-skip-fork-sync`, SSE replay | Process and stream plumbing                                     | Replaced by stdin lifetime and reload-on-reconnect.                                                                                                                            |

## Prompt queue vs the v2 session inbox

Desktop's queue lives in the main process (`plugins/chat/src/main/prompt-queues`,
bridged by `runtime/main-prompt-queue.ts`); the patched library's
`openCodeMessageQueue.ts` is only its fallback. v2's inbox
(`session.inbox.list` / `cancel` / `update`, `delivery: "steer" | "queue"`) is
durable and shared across clients but covers only part of it:

| Desktop queue feature                        | v2 inbox                                                  |
| -------------------------------------------- | --------------------------------------------------------- |
| Queue while busy, FIFO, one per turn on idle | yes                                                       |
| Remove                                       | yes (`cancel`)                                            |
| Attachments                                  | yes                                                       |
| Pause / resume                               | partial (parked after `interrupt({ resume: true })` only) |
| Reorder                                      | no                                                        |
| Inline edit keeping position                 | no (cancel and re-prompt)                                 |
| Send now (abort, then send this item)        | partial (`update` to steer + `interrupt`, two calls)      |
| Pause after a failed send or abort           | no                                                        |
| Per-item agent / model / variant             | no (internal `selection` only)                            |
| Per-item system prompt                       | no                                                        |

**Outcome:** keep Desktop's main-process queue as the holding layer and deliver
each item with `session.prompt`. Send now becomes `session.interrupt` followed
by the item's prompt. Prompts other clients queued on the server can be shown
from `session.inbox.list` and `session.inbox.*` events. Revisit when v2 adds
public per-item selection, edit/reorder and a pause flag.
