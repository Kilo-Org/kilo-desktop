# Kilo Code v2 compatibility report

What the Kilo Code v2 server (`kilo2`) and its client (`@kilocode/client`)
offer against what Kilo Desktop uses from the Kilo v1 server today. Input to
the v2 plugin copies described in
[ADR-003](./adr/003-kilo-server-line.md).

- **Checked against:** `@kilocode/cli@0.0.0-v2-239` and
  `@kilocode/client@0.0.0-v2-239` (npm dist-tag `kilo-v2`, published
  2026-11-20), source Kilo-Org/kilocode `origin/v2` at `efd2a06bb3`.
- **Live probe:** the published `kilo2` run as the background service in an
  isolated profile (`XDG_*_HOME` under a temp dir, `service set port`), driven
  with `curl` and `@kilocode/client`. Source paths below are in the kilocode
  repo under `packages/`.
- **Status words:** SAME, RENAMED, CHANGED (shape differs), MISSING.

## Summary

- The HTTP API is new: everything is under `/api/*`, Kilo features are RPCs
  (`POST /api/rpc/<id>/<method>`), the event stream is one global
  `GET /api/event` with a new envelope, and messages are a flat tagged union
  instead of `{info, parts}`. Most v1 calls have an equivalent; few keep their
  shape. The react-opencode fork needs a new adapter, not a rename pass.
- **Blockers for the shared background service** (decision of 2026-11-20):
  desktop's per-process configuration, client identity and server plugins
  cannot be set per client on a shared service; a TUI or CLI of another
  version replaces the service; the production renderer origin is refused.
  The v2 VS Code extension avoids all of this by starting its own
  `kilo2 serve --port 0 --stdio`.
- **Missing in v2:** MCP Apps routes, per-session model usage, structured
  (JSON-schema) one-shot generation with a system prompt, per-prompt system
  text, the telemetry toggle.

## 1. Binary and distribution

| Today (v1)                                | v2                                                                                                                    | Status  |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------- |
| `@kilocode/cli-<target>` `bin/kilo`       | `@kilocode/cli-<target>` `bin/kilo2` (+ `tree-sitter`, `libopentui.dylib`, `kilo-sandbox-mutation-worker.js`)         | CHANGED |
| Version `7.8.27` (semver)                 | `0.0.0-v2-239` (prerelease; `--version` prints `kilo2 v0.0.0-v2-239`)                                                 | CHANGED |
| Targets: darwin-arm64, linux, windows     | Adds darwin-x64, musl and non-baseline x64                                                                            | CHANGED |
| `kilo serve --hostname --port --cors`     | `kilo2 serve [--hostname] [--port] [--cors] [--service \| --stdio]`                                                   | CHANGED |
| URL read from stdout                      | `--stdio` prints one JSON line `{"url":…}` and exits when stdin closes; `--service` writes a registration file        | CHANGED |
| `GET /global/health` `{healthy, version}` | `GET /api/info` `{version, pid, hostname, urls, paths, capabilities}`; 503 while booting (live: `/global/health` 404) | RENAMED |
| Basic auth `kilo:<KILO_SERVER_PASSWORD>`  | Basic auth `opencode:<password>`; `/api/info` without auth is 401 (live)                                              | CHANGED |
| Config `~/.config/kilo/kilo.jsonc`        | `~/.config/kilo2/kilo2.json(c)`; data `~/.local/share/kilo2` (`kilo2.db`); separate from v1                           | CHANGED |

## 2. The shared background service

How it works (`cli/src/services/service-config.ts`,
`kilo-cli/src/server-process.ts`, `kilo-cli/src/service/login.ts`,
`client/src/service-*.ts`), confirmed live where noted:

- `kilo2 service start|stop|restart|status|install|uninstall|get|set|unset`.
  `start` spawns `kilo2 serve --service` detached; `install` adds a login
  unit (launchd `ai.kilo.kilo2.<channel>`, systemd user unit, Windows logon
  task) that starts it with only `PATH` in its environment.
- Registration file `<XDG_STATE_HOME|~/.local/state>/kilo2/service-v2.json`
  (mode 0600) holds `{id, version, url, pid, password}` (live). Service config
  `~/.config/kilo2/service-v2.json` holds `hostname, port, password, cors,
  env, disabled, remote` (live: `service set port` wrote it).
- The port is fixed per channel unless `service set port`; it binds
  `127.0.0.1`. One process serves every client and every directory; there is
  no per-client lease.
- `@kilocode/client/service` can discover and ensure the service, but its
  default registration path is upstream's (`~/.local/state/opencode/…`), so
  Kilo clients pass the file explicitly.
- **Version handling:** clients decide `replace` when the running service's
  version doesn't satisfy theirs. The TUI and `mini` require an exact match
  and replace the service (stop, then start their own binary). A desktop
  bundling one `kilo2` and a user's CLI at another version would keep
  replacing each other.
- `service set|unset` (except `set disabled false`) stops the service; the
  next client restarts it.

### What desktop sets per process today, and where it can go on v2

| Desktop needs                                                                               | v2 on a shared service                                                                                                                                                              | Verdict          |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `KILO_CONFIG_CONTENT` (plugin list, `indexing.kilo.baseUrl`, archive-command `bash*` rules) | Read once at service start, from whichever process started it; nothing per client. `service set env` applies to every client and restarts the service                               | **BLOCKER**      |
| `KILO_CONFIG_DIR` (app-owned config dir)                                                    | Ignored; v2 reads `KILO2_CONFIG_DIR`, service-wide                                                                                                                                  | **BLOCKER**      |
| Client identity: `KILO_APP_NAME`/`KILO_CLIENT`, `KILO_PLATFORM`, `KILOCODE_FEATURE`         | Process env only; Kilo plugins gate features on it (plan document, chart, goal, indexing consent). Gateway attribution alone can come per session from metadata `kilocode.platform` | **BLOCKER**      |
| `KILO_MACHINE_ID`, `KILO_API_URL`                                                           | Process env only                                                                                                                                                                    | **BLOCKER**      |
| `KILO_TELEMETRY_LEVEL`, `POST /telemetry/setEnabled`                                        | No telemetry endpoint (live: 404); listed upstream as needing a Kilo RPC                                                                                                            | MISSING          |
| Desktop Kilo server plugins (notebook tools, caller context)                                | Loaded only from config `plugins` or `plugin/` dirs, per location; no runtime load API; see section 6                                                                               | **BLOCKER**      |
| Contributed env (`LLAMA_API_KEY`, `RUNTIMED_SOCKET_PATH`, WebMCP URL/token)                 | `service set env` (service-wide, restarts it). Partial substitutes: credentials API for provider keys, per-session shell env, client-hosted MCP                                     | CHANGED, partial |
| Renderer CORS origin `kilo-desktop://app`                                                   | Refused (live: 403 cross-site, no `access-control-allow-origin`); `service set cors` only takes HTTP(S). `http://localhost:*` (dev) is allowed; requests with no Origin pass        | **BLOCKER**      |
| Fresh state isolated from the user's own Kilo v2                                            | Impossible on the shared service: desktop shares the user's `kilo2` config, credentials and sessions                                                                                | CHANGED          |

All of these work on a private `kilo2 serve --port 0 --stdio` started by
desktop with its own environment, which is what the v2 VS Code extension does
(`kilo-vscode/src/server.ts:15,93-134`).

## 3. Client library

- `import { OpenCode } from "@kilocode/client"`;
  `OpenCode.make({ baseUrl, headers: { authorization }, fetch? })` (live).
  Entry points `.`/`./promise`, `./effect`, `./service`, `./solid`, `./mcp`.
- Namespaces (live): `server, location, agent, plugin, session, experimental,
  message, model, provider, integration, mcp, credential, project, form,
  permission, file, command, skill, rpc, event, pty, shell, reference,
  worktree, vcs, debug, websearch, config, generate, voice, migration, usage`.
- Location-scoped calls take `location: { directory }` as a query parameter;
  session calls resolve the location from the session.
- Kilo features are typed RPC definitions from `@opencode/schema/kilocode/*`
  (published as `@kilocode/schema`): `client.rpc(Def).method(input)`. RPC
  events arrive on the main stream as `rpc.<id>.<name>`.
- `client.event.subscribe({ types?, signal })` is one shared global stream
  (live: first event `server.connected`); no automatic reconnect or
  Last-Event-ID replay; durable session events replay through
  `experimental.session.log`. Envelope:
  `{ id, created, type, location?: { directory }, data, durable? }`.

## 4. Calls, routes and events

### Sessions and chats (kilo.core conversations, kilo.chat runtime)

| v1                                                       | v2                                                                                                                                     | Status            |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `experimental.session.list` (header cursor)              | `session.list({ limit, order, search, parentID, archived, directory, cursor })`, cursor in body                                        | CHANGED           |
| `session.get`                                            | `session.get` → `SessionInfo` (`location`, `permissions`, `cost`, `tokens`, `revert`, `metadata`)                                      | CHANGED           |
| `session.status`                                         | No endpoint; `session.active()` plus `session.status` events                                                                           | CHANGED           |
| `session.create` (+ metadata, permission rules)          | `session.create({ location, title, agent, model: { id, providerID, variant }, metadata, permissions, parentID })` (live with metadata) | CHANGED           |
| `session.update`                                         | `PATCH { title, metadata, permissions, archived }`; metadata replaced whole                                                            | CHANGED           |
| `session.fork({ messageID })`                            | `session.fork({ before })`                                                                                                             | RENAMED           |
| `session.promptAsync({ parts, agent, model, variant })`  | `session.prompt({ text, files, agents, skills, metadata, delivery, resume })`; agent/model via `switchAgent`/`switchModel` first       | CHANGED           |
| per-prompt `system`, `noReply`                           | No `system`; `resume: false`; `session.synthetic` for synthetic text                                                                   | MISSING (system)  |
| `session.prompt` with `format: json_schema` (generation) | No structured output; `session.generate` / `experimental.generate.text` return text                                                    | MISSING           |
| `session.command`                                        | `session.command({ name, text, files, … })`, no agent/model override                                                                   | CHANGED           |
| `session.delete` / `session.abort`                       | `session.remove` / `session.interrupt`                                                                                                 | RENAMED           |
| `session.messages`                                       | `message.list({ sessionID, limit, order, cursor })`                                                                                    | CHANGED           |
| `session.summarize`                                      | `session.compact`                                                                                                                      | CHANGED           |
| `session.revert` / `unrevert`                            | `session.revert.stage` / `.clear` (+ `.commit`)                                                                                        | CHANGED           |
| `kilocode.drainSession`                                  | RPC `kilocode.session-drain` `drain`; event `rpc.kilocode.session-drain.drained`                                                       | RENAMED           |
| `kilocode.sessionModelUsage`                             | None; aggregate from assistant messages (`model`, `cost`, `tokens`) and `session.usage.updated`                                        | MISSING           |
| `branchName.generate`                                    | RPC `kilocode.branch-name` `generate`                                                                                                  | RENAMED           |
| `instance.dispose` + `server.instance.disposed`          | `debug.location.evict` + `location.shutdown` (debug namespace)                                                                         | RENAMED, unstable |
| `global.dispose`                                         | `location.reload()`                                                                                                                    | RENAMED           |

Session metadata is an arbitrary JSON record, settable on create and update
and inherited by forks and children, so the desktop stamp carries over
(live: created a session with a nested desktop metadata key). `kilocode.sandbox`
is still read.

### Events

| v1                                                        | v2                                                                                                                                                                                  | Status         |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `global.event` / `event.subscribe` (per directory)        | `GET /api/event`, one stream; filter on `location.directory`                                                                                                                        | CHANGED        |
| `server.connected`, `session.created/deleted/status/idle` | Same names, new data shapes                                                                                                                                                         | CHANGED        |
| `session.updated`                                         | Split: `session.renamed`, `.metadata.updated`, `.permissions`, `.archived`, `.unarchived`, `.moved`, `.agent.selected`, `.model.selected`, `.usage.updated`, `.revert.*`, `.forked` | CHANGED        |
| `session.error`                                           | `session.execution.failed`, `session.step.failed`                                                                                                                                   | RENAMED        |
| `message.updated`, `message.part.updated/delta`           | `session.step.*`, `session.text.started/delta/ended`, `session.reasoning.*`, `session.tool.input.*`, `session.tool.called/progress/success/failed`, `session.compaction.*`          | CHANGED        |
| `message.removed`, `message.part.removed`                 | None                                                                                                                                                                                | MISSING        |
| `permission.asked/replied`                                | Same names, new shapes                                                                                                                                                              | CHANGED        |
| `question.asked/replied/rejected`                         | `form.created/replied/cancelled`                                                                                                                                                    | RENAMED        |
| `x-kilo-sse-skip-fork-sync` header                        | No fork-sync in v2                                                                                                                                                                  | MISSING (moot) |

### Messages and parts (react-opencode and the tool renderers)

- v1 `{ info, parts }` with part types text, reasoning, tool, file,
  step-start/finish, snapshot, patch, agent, subtask, compaction.
- v2 is a flat tagged union: `user` (`text`, `files`, `agents`, `skills`),
  `assistant` (`agent`, `model`, `content: (text | reasoning | tool)[]`,
  `snapshot`, `finish`, `cost`, `tokens`, `error`, `retry`), `synthetic`,
  `system`, `skill`, `shell`, `compaction`, `idle`, `agent-switched`,
  `model-switched`, `location-switched`.
- Tool content `{ id, name, executed, state: streaming | running | completed |
  error, time }`, results as `content: [{ type: text | file }]` plus
  `metadata`. Tool parts use `name`, not `tool`.
- Steps, snapshots, patches and subtasks are no longer parts: step events,
  `snapshot` on the message plus `session.diff`, subagents as child sessions.
- Text and reasoning stream as deltas keyed by `assistantMessageID` and
  `ordinal`; the `.ended` event carries the full text.

### Permissions and questions

| v1                                                         | v2                                                                                                                          | Status  |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------- |
| Request `{ permission, patterns, metadata, tool.callID }`  | `{ id, sessionID, action, resources, save?, metadata?, source: { type: "tool", messageID, id } }`                           | CHANGED |
| `permission.list`                                          | `permission.request.list({ location })` / `permission.list({ sessionID })`                                                  | CHANGED |
| `permission.reply({ requestID, reply, interactive })`      | `POST /api/session/:id/permission/:requestID/reply { decision: once \| always \| reject, message }`; no `interactive` input | CHANGED |
| Rules `{ permission, pattern, action }`                    | `{ action, resource, effect }`; per session on create/update                                                                | RENAMED |
| Flags `sandboxEscalation`, `configProtected`, `skillShell` | `sandboxEscalation` kept; the others gone; `metadata.interactive === true` means only a person may answer                   | CHANGED |
| Saved "always"                                             | Project-wide allow evaluated after session rules, so it overrides a session `ask`                                           | CHANGED |
| `question.list/reply/reject`                               | Forms: `session.form.list/reply({ formID, answer: { q0: … } })/cancel`; `metadata.kind === "question"`                      | CHANGED |
| `KILO_ENABLE_QUESTION_TOOL`                                | `question` tool always on                                                                                                   | CHANGED |

### Account, models, config (kilo.core account, models, work-style)

| v1                                                           | v2                                                                                                                      | Status  |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------- |
| `kilo.authStatus` / `kilo.profile` / `kilo.organization.set` | RPC `kilocode.gateway` `authStatus` / `profile` (new shape) / `organization.set`                                        | RENAMED |
| `provider.oauth.authorize/callback` (device sign-in)         | `integration.oauth.connect({ integrationID: "kilo", methodID: "device" })`, poll `.status`, `.complete` / `.cancel`     | CHANGED |
| `auth.set` / `auth.remove`                                   | `integration.connect.key` or `credential.create`; `credential.remove(id)`                                               | CHANGED |
| `provider.list`                                              | `provider.list` + `model.list` + `model.default`; connection state from `integration.list`                              | CHANGED |
| `global.config.get/update`                                   | `config.get` (read-only documents); writes through RPC `kilocode.settings` `write({ scope, set, unset })`, v2 keys only | CHANGED |
| `app.agents`, `command.list`, `file.read`                    | `agent.list`, `command.list`, `file.read` (raw bytes)                                                                   | CHANGED |

### Marketplace and MCP (kilo.marketplace, kilo.chat MCP apps)

| v1                                                           | v2                                                                                        | Status  |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------- |
| `/kilocode/marketplace`, `/install`, `/remove`               | RPC `kilocode.marketplace` `list`, `installed`, `preview`, `install`, `uninstall`         | RENAMED |
| `/agent`, `/skill`, `/mcp`                                   | `agent.list`, `skill.list`, `mcp.list`; RPCs `kilocode.agent` / `kilocode.skill` `remove` | RENAMED |
| `/mcp/:id/auth/authenticate`                                 | `needs_auth` + `integrationID` → `integration.oauth.connect`                              | CHANGED |
| `mcp.status`                                                 | `mcp.list` → `{ name, status, integrationID }`                                            | CHANGED |
| `/experimental/resource/read`, `/experimental/mcp/call-tool` | None (live: 404); only `GET /api/mcp/resource` catalog                                    | MISSING |

## 5. Tool and permission vocabulary

| v1 (desktop renderers, rules)                                                       | v2                                                                                                                                             | Status         |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `bash`                                                                              | `shell` (`bash` only as a model-call alias)                                                                                                    | RENAMED        |
| `apply_patch`                                                                       | `patch`                                                                                                                                        | RENAMED        |
| `task`                                                                              | `subagent` (always background)                                                                                                                 | RENAMED        |
| `list`, `todoread`                                                                  | gone (`read` lists directories)                                                                                                                | MISSING        |
| `read`, `edit`, `write` arg `filePath`                                              | `path`                                                                                                                                         | CHANGED        |
| `glob`, `grep`, `webfetch`, `todowrite`, `question`, `skill`, `plan_exit`           | same names; `plan_exit` permission action is `kilo.plan_exit`                                                                                  | SAME / CHANGED |
| MCP wire names `desktop_<plugin>_<id>`                                              | same `<server>_<tool>` formula                                                                                                                 | SAME           |
| MCP tools called directly                                                           | Code Mode by default: MCP tools run inside one `execute` call; set `codemode: false` on the desktop server so renderers and approvals see them | CHANGED        |
| Rule `bash*` (archive commands)                                                     | Not migrated (only exact `bash` → `shell`)                                                                                                     | CHANGED        |
| Agents `code`/`build`, `ask`, `debug`, `plan`, `orchestrator`, `general`, `explore` | same; Ask and Plan sealed against broad permissions                                                                                            | SAME           |
| Config `agent.<id>`, `command.<id>`, `mcp.<name>`, `provider.<id>`                  | read and migrated to `agents`, `commands`, `mcp.servers.<name>`, `providers.<id>` (legacy warnings)                                            | CHANGED        |

## 6. Server plugins (notebook tools, caller context)

- v2 modules export `{ id, setup(ctx) }` (Promise) or `{ id, effect }`;
  desktop's `{ id, server }` fails to load.
- Tools: `ctx.tool.transform(e => e.add({ name, input, execute }))`; hooks:
  `ctx.tool.hook("execute.before", …)` with mutable `input`; permissions:
  `ctx.permission.assert(…)` (plugin tools are not authorized automatically).
- External plugins come from config `plugins` or a config dir's `plugin/`
  folder, per location. A configured local path must be a directory; desktop
  passes single `file://…/index.js` files, which are dropped.
- v2 already sends `_meta["ai.opencode/sessionID"]` on MCP `tools/call` (not
  the call id), which may make the caller-context plugin partly redundant.
- Alternative for desktop tools: a client-hosted MCP server over the
  `GET /api/experimental/client-mcp?name=&location[directory]=` WebSocket
  (`@kilocode/client/mcp`); its tools live while the socket is open and are
  visible to every session at that location.

## 7. Gaps

Blocking the shared-service decision (raised as an open question):

1. No per-client config (`KILO_CONFIG_CONTENT`, config dir).
2. Client identity, machine id and API URL are per process.
3. Desktop server plugins can't be injected per client.
4. Mismatched TUI/CLI versions replace the service.
5. The production renderer origin is refused by CORS.
6. Desktop would share the user's own v2 state, not fresh state.

Missing in v2 whichever way desktop connects (raised as open questions):

7. MCP Apps (`resource/read`, `mcp/call-tool`).
8. Per-session model usage.
9. Structured one-shot generation with a system prompt
   (`kilo.core/generation`), and per-prompt system text.
10. Telemetry toggle.

Changes desktop absorbs in the v2 plugin copies (no decision needed):

- New message model and events: the v2 react-opencode copy is a new adapter
  over `session.*` events and the tagged message union.
- Renamed tools and permission vocabulary mapped onto today's payloads
  (`shell` → `bash`, `patch` → `apply_patch`, `subagent` → `task`,
  `resources` → `patterns`, `interactive` for the removed flags), or the
  renderers learn both.
- Questions through Forms; permissions with `decision`; saved "always"
  overriding session `ask` rules.
- Config writes through `kilocode.settings` in v2 keys; sign-in through
  integrations; marketplace and Kilo account through RPCs.
- `codemode: false` on the desktop MCP server.
- Plugins ported to `{ id, setup }` and shipped as directories.
