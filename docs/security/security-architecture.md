# Kilo Desktop Security Architecture Overview

## Document metadata

| Field            | Value                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------- |
| Audience         | Customer security reviewers and technical due-diligence teams                                 |
| Document owner   | Kilo engineering                                                                              |
| Document version | 1.4                                                                                           |
| Last reviewed    | 2026-11-03, commit 733faa5fc0cfaafa2ac5d33f6ec007ee042b9c0d plus its pending fix-pass changes |
| Review cadence   | Quarterly, and before material trust-boundary, data-flow, or distribution changes             |

## Version history

| Version | Date       | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 2026-09-29 | Established the repository-backed security architecture overview: topology, trust boundaries, attacker model, data flows, and integration inventory.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 1.1     | 2026-10-02 | Added the embedded browser, interactive terminal, OS deep links, Kilo marketplace, and renderer-provided agent tools (with per-action consent) as boundaries; expanded the boundary table to every register boundary; corrected credential-storage backend selection; documented account-linked telemetry identity, the default-on data-collection setting, feature-flag identity flow (LaunchDarkly), the Windows update mirror, and the favicon lookup service. Register sync removed the retired Anaconda sign-in and Anaconda MCP boundaries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 1.2     | 2026-10-09 | Recorded the nteract notebook frame as accepted design: pinned/verified bundle, origin+CSP isolation (sandbox omitted as a no-op), origin-checked port handshake, and audited host-method surface.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 1.3     | 2026-10-28 | Recorded known limits of notebook daemon peer authentication (check is not bound per connection, readiness probe precedes it, no Windows same-user check).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 1.4     | 2026-11-03 | Updated for the plugin kernel: the preload is a generic kernel bridge, so renderer-to-main enforcement is described as main-side caller attribution (caller process from the transport, validated call payloads, window callers limited to the window kernel's narrow rights or enabled plugins with a window entry, secrets refused to windows, per-method caller checks); agent tools now come only from plugins' main-process code; the renderer reaches the CLI directly with its per-launch credential; removed opening local files and clipboard reads from the renderer's shell surface; pop-out windows can host browser guests under the same guard; the Anaconda account sign-in (loopback callback, PKCE) and API-key release to main only; the flag service no longer receives the display name; conda bridge crash reporting; added a known-limitations list. Register sync: replaced 21 stale file paths (CLI connector moved to kilo.agent; browser, files, git, terminal, notebook and agent-tool files moved or renamed), rewrote the renderer-to-main IPC, preload, OS shell, deep-link, event bus, pane window, protocol and embedded-host rows to match the code (no feature channels, last embedded-host claim wins), renamed "Renderer-registered agent tools" to "Plugin agent tools", added the Anaconda account boundary, and updated the auto-approve, agent-tool, auth, telemetry and feature-flag rows. |

## Maintainer agent update prompt

Use the following prompt when refreshing this document after repository changes. The prompt is intentionally self-contained so an agent can perform a repository-backed review without treating the current document as the sole source of truth. The `security-architecture` skill (`.agents/skills/security-architecture/SKILL.md`) implements this prompt.

```
You are a software security engineer updating docs/security/security-architecture.md for a customer security review.

Goal:
Refresh the document so it accurately describes the current Kilo Desktop repository's high-level security architecture: application topology, trust boundaries, identity and access model, data categories and persistence, core data flows, security controls, third-party integrations, privacy handling, and shared responsibility. Keep the document customer-facing: enough resolution for clarity and confidence without exposing internal operational detail.

Required workflow:
0. Sync the boundary register first: follow docs/security/register-sync.md against docs/security/boundary-register.md and fix the register itself (it is shared with the threat-model scan).
1. Read CONTEXT.md, AGENTS.md, the current document, and the synced docs/security/boundary-register.md (the boundary seed — never copy it verbatim). Read plugin docs (plugins/*/) for changed areas before editing.
2. Review repository changes since the document's Last-reviewed commit and inspect the current implementation. At minimum, examine the Electron main/renderer/preload split, the kernel transport, sender verification and domain-call caller attribution (caller process, window callers, per-method caller checks), webPreferences and content security policy, custom protocol and embedded web hosts, the embedded browser, the terminal, OS deep links, the Kilo CLI connector sidecar, MCP servers and the agent-tool endpoints, plugin-provided agent tools, the marketplace, the Anaconda account sign-in, the conda bridge, the notebook daemon, the local model runtime, auth and keyring backends, telemetry and crash reporting, and the auto-update and release paths.
3. Distinguish repository-supported facts from operational configuration. Do not claim that a provider, region, route, rollout, retention period, encryption setting, or signing configuration is active unless the evidence supports that claim. Use the labels Platform dependency, Feature-dependent, Customer-configured, Runtime-selected, or Production validation required.
4. Keep diagrams and narrative at a logical architecture level. Do not publish internal routes, hostnames, ports, URLs, environment-variable names, secret names, queue or binding names, class names, token formats, header names, machine identifiers, retry counts, or file:line references. Source file paths are acceptable in the Internal evidence baseline section only.
5. Re-check customer-sensitive areas explicitly: renderer and embedded-content isolation, loopback listener authentication, credential storage backend selection, model artifact and update integrity, telemetry consent, identity linkage and opt-out propagation, logging redaction, agent tool consent, and customer-configured integrations.
6. Update Mermaid diagrams, tables, the Last-reviewed field, Document version, and Version history. Add one concise version-history row describing the refresh (including register-sync changes). Preserve prior history rows.
7. Ensure the integration inventory reflects current repository support while making clear that live configuration requires environment-specific validation.
8. Validate the finished Markdown: run the repository formatter, inspect the diff, and statically inspect Mermaid fences and syntax.

Important constraints:
- This is not a penetration-test report, DPA, subprocessor list, or compliance attestation.
- Do not copy stale provider, residency, certification, privacy, or continuity claims from historical documentation without current evidence.
- Do not log, print, or copy credential values while researching.
- Keep legal and contractual claims in the authoritative legal or compliance documents; link or defer to them where appropriate.
```

## 1. Purpose and scope

This document provides a high-level security architecture overview of the Kilo Desktop application. It describes the logical application topology, major data flows, trust boundaries, local persistence, and external integrations represented by the current repository.

The document is intentionally more abstract than an internal engineering runbook. It does not publish internal routes, ports, resource identifiers, secret names, or low-level runtime settings. It also does not replace a penetration-test report, data processing agreement, subprocessor list, or compliance attestation. The companion threat-model scan (a dated, internal, point-in-time STRIDE+Privacy assessment) is produced separately by the `threat-model` skill and is not published.

The repository establishes architectural intent and application-level controls. Some properties depend on the build and distribution environment — signing and notarization configuration, the deployed update feed, and the active model catalog service — and require environment-specific validation (see section 13).

## 2. Executive overview

Kilo Desktop is an Electron application that combines a sandboxed user interface with a privileged main process, a plugin system, and several locally executed helper components:

- Customer work happens in a sandboxed renderer (chat, notebook, file tree, git, terminal, browser, and settings UI) whose only access to privileged operations is a single kernel transport exposed by the preload; the main process attributes every call to the window it came from and validates it before acting.
- The Electron main process hosts the plugin kernel. Plugins contribute shared objects with validated methods, commands, UI, storage, and (for some) helper processes, and are the unit of feature organization inside the app. Plugins in one window share that window's JavaScript context, so the boundary that protects privileged operations is between each window and the main process, not between plugins in a window.
- Locally executed helper components run as separate processes: the Kilo CLI connector sidecar that performs agentic coding work, a bundled conda bridge for Python environment management, a notebook execution daemon, an optional local model runtime for on-device inference, and interactive terminal shells started on the user's request.
- An embedded browser panel renders arbitrary remote web pages in isolated, sandboxed guest views that share no session with the application UI.
- MCP (Model Context Protocol) tool servers, marketplace-installed agents and skills, and user-configured integrations extend the agent's capabilities; their data and outputs are treated as untrusted input. The application UI also offers a small set of its own tools to the agent (for example opening a file or notebook, reading terminal output, managing conda environments), implemented by plugins in the main process and served over an authenticated loopback MCP endpoint; for the built-in agent, tools that change state on the user's machine require per-action user consent. The user can also pair external AI apps (for example Cursor or Claude Code) with a separate, off-by-default, token-protected endpoint; those apps' own approval settings govern their calls.
- The operating system can launch the app through a registered deep-link scheme; incoming links can only select a plugin-declared in-app page with its declared parameters (validation limits are listed in section 4).
- Outbound network access is limited to services the user interacts with explicitly: the account/identity services (Kilo, and Anaconda when the user signs in to it), LLM providers and gateways, the model catalog, telemetry and crash reporting (consent-gated), conda package channels, the update feed, web pages the user opens in the embedded browser, and user-configured MCP servers.

The architecture separates untrusted content (web content, MCP tool data, server-supplied HTML, repository content, deep links) from privileged operations through process isolation, a validated IPC boundary, sender-origin verification, main-side caller checks, per-plugin storage scoping, consent gates on mutating agent tools, and authenticated loopback channels to helper processes.

## 3. Application topology

```mermaid
flowchart LR
  subgraph machine["User Machine"]
    subgraph renderer["Sandboxed Renderer"]
      webui["Chat, notebook, terminal, and settings UI"]
      widgets["Sandboxed MCP app widgets"]
      guests["Isolated browser guest views"]
    end
    preload["Kernel transport bridge (preload)"]
    subgraph mainproc["Electron Main Process"]
      ipc["Kernel transport with caller checks"]
      pluginsys["Plugin system and per-plugin storage"]
      deeplink["Deep-link handler"]
    end
    subgraph sidecars["Local Helper Processes"]
      cli["Kilo CLI connector sidecar"]
      relay["Agent-tool endpoints (main process, loopback)"]
      conda["Conda bridge sidecar"]
      nbdaemon["Notebook execution daemon"]
      llama["Local model runtime"]
      shells["Terminal shells"]
    end
    keystore["Credential store"]
    os["Operating system"]
  end

  subgraph external["External Services"]
    identity["Account and identity service"]
    models["LLM providers and gateways"]
    catalog["Model catalog service"]
    telemetry["Telemetry and crash reporting"]
    channels["Conda package channels"]
    updates["Update distribution feed"]
    mcpservers["User-configured MCP servers"]
    websites["Websites opened by the user"]
  end

  webui --> preload --> ipc
  ipc --> pluginsys
  os --> deeplink --> pluginsys
  pluginsys --> cli
  pluginsys --> conda
  pluginsys --> nbdaemon
  pluginsys --> llama
  pluginsys --> shells
  pluginsys --> keystore
  pluginsys --> relay
  cli --> relay
  webui --> cli
  pluginsys --> identity
  cli --> identity
  cli --> models
  cli --> mcpservers
  pluginsys --> catalog
  conda --> channels
  pluginsys --> telemetry
  mainproc --> updates
  guests --> websites
```

| Layer                  | Description                                                                                                                | Security relevance                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Sandboxed renderer     | All application UI, server-supplied MCP app widget HTML in sandboxed frames, and isolated guest views for remote web pages | Untrusted-content containment; no direct OS or Node access; browser guests have no app bridge |
| Preload bridge         | Generic request, send, and subscribe bridge over the kernel transport, plus window identity and port forwarding            | Defines the entire renderer-reachable surface; enforcement happens in main, not in the bridge |
| Electron main process  | Plugin kernel, kernel transport, storage, sidecar management, deep-link handling                                           | Privileged operations; enforces validation, sender verification, and caller checks            |
| Local helper processes | CLI connector, agent-tool endpoints, conda bridge, notebook daemon, local model runtime, terminal shells                   | Separate processes; loopback or stdio channels; execution isolated from the UI                |
| Credential store       | Shared Anaconda credential file, OS keychain, or user config, per backend selection (section 6.2)                          | Protection of account and provider tokens at rest                                             |
| External services      | Identity, models, catalog, telemetry, channels, updates, user-configured MCP servers, user-browsed websites                | Explicit outbound trust boundaries over TLS                                                   |

## 4. Trust boundaries

```mermaid
flowchart TB
  subgraph untrusted["Boundary 1: Untrusted Input"]
    web["Remote web content"]
    mcpdata["MCP tool and server data"]
    repocontent["Repository and notebook content"]
    serverhtml["Server-supplied widget HTML"]
    links["OS deep links"]
  end

  subgraph rendererb["Boundary 2: Sandboxed Renderer"]
    ui["Application UI and widgets"]
    guest["Browser guest views"]
  end

  subgraph mainb["Boundary 3: Privileged Main Process"]
    handlers["Plugin IPC handlers, protocols, and storage"]
  end

  subgraph localb["Boundary 4: Local Helper Processes"]
    helper["CLI sidecar, agent-tool endpoints, conda bridge, notebook daemon, local runtime, terminal shells"]
  end

  subgraph creds["Boundary 5: Credential Storage"]
    keychain["Credential store"]
  end

  subgraph externalb["Boundary 6: External Services"]
    svc["Identity, models, catalog, telemetry, channels, update feed, MCP servers, websites"]
  end

  web --> guest
  mcpdata --> ui
  repocontent --> ui
  serverhtml --> ui
  links --> handlers
  ui --> handlers
  handlers --> helper
  handlers --> keychain
  handlers --> svc
  helper --> svc
  helper --> ui
```

| Boundary                                  | What crosses it                                                                                              | Primary controls                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer ↔ main IPC                       | Shared-object method calls, commands, state and event subscriptions, message ports                           | Only windows the app created, on the application's own origin, may use the kernel transport; main stamps each call with its window and derives the caller's process from the transport, never from the payload; call envelopes and method inputs and outputs are schema-validated and only declared methods are dispatched; a window may act only as its own window kernel (limited to window management and turning plugins on or off) or as an enabled plugin that has a window entry; secrets refuse every call from a window; methods that hand out control of the agent check their caller; unexpected errors are scrubbed; sandboxed renderer with context isolation and no Node integration         |
| Renderer preload surface                  | The only privileged API visible to the renderer                                                              | A generic request, send, and subscribe bridge over the kernel transport, plus window identity, keyboard shortcuts, dropped-file paths, and same-origin port forwarding; the bridge itself has no per-channel allowlist, so every check is enforced in the main process                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Renderer ↔ OS shell                       | Requests to open URLs, reveal files, write the clipboard, show native dialogs                                | URL scheme allowlist before any OS handoff; reveal-in-folder rejects malformed paths and never opens the file; no renderer path to open local files with their default application or to read the clipboard; available only to plugins that declare the capability; no direct renderer access to shell APIs; context-menu link actions go through the same allowlist                                                                                                                                                                                                                                                                                                                                       |
| OS deep links                             | App-scheme links from browsers, other apps, or the command line                                              | Only links with the app's scheme are forwarded; a link resolves only against plugin-declared hosts and can only select that plugin's in-app page with its declared parameters, never trigger an action directly (validation limits listed below the table)                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Event bus                                 | Fire-and-forget events and shared state between plugins and renderer windows                                 | Events and shared state originate in their providing process; payloads delivered only to the application's own windows, where shared state is visible to every plugin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Shell ↔ plugin SDK sandbox                | Per-plugin storage, configuration, and capability lookups                                                    | Per-plugin storage scoping, filesystem path-escape rejection, configuration namespace validation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Pane windows                              | Additional native windows opened by the renderer for detached panes                                          | Schema-validated window descriptors; same sandbox, context isolation, preload, and embedded-browser guest guard as the main window                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Plugin custom protocols                   | Renderer fetches to plugin-owned schemes (for example diff content)                                          | Privileged scheme registration and handlers restricted to schemes each plugin declares in its manifest; path traversal guards; origin checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Embedded web hosts                        | Plugin-served bundles (notebook UI, terminal UI) in frames with a message port                               | Dedicated content-security profile for active untrusted content; registration limited to host names each plugin declares in its manifest; the notebook frame runs a pinned, sha256-verified first-party bundle isolated by dedicated origin and CSP (frame sandbox attribute intentionally omitted as a no-op); origin-checked, versioned port handshake; audited, minimal host-method surface with dangerous methods denied or stubbed                                                                                                                                                                                                                                                                    |
| Embedded browser                          | Arbitrary remote web pages chosen by the user or agent                                                       | Separate persistent browser session; every permission request denied; guests forced to sandboxed, context-isolated, no-Node, no-preload settings; only http(s) navigation; pop-ups stay in the guest; leases bound to the trusted app window                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| MCP app widgets                           | Server-supplied HTML rendered in chat                                                                        | Sandboxed frames without same-origin access; JSON-RPC bridge with scoped tool calls; size clamping                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| MCP apps fetch                            | UI resources referenced by MCP servers                                                                       | Read through the CLI component's authenticated loopback interface (the CLI contacts the MCP server) and rendered only inside sandboxed widget frames                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Connector sidecar (Kilo CLI)              | Work requests, credentials, configuration                                                                    | Loopback-only listener with per-launch credentials, handed only to the application's own chat, account, and marketplace UI; browser origins other than the application's refused; scrubbed child-process environment; CLI artifacts resolved from a frozen lockfile with registry checksums                                                                                                                                                                                                                                                                                                                                                                                                                |
| MCP tool servers and agent-tool endpoints | Tool calls from the agent and paired external AI apps to MCP servers and to tools offered by the application | MCP outputs treated as untrusted; application tools come only from plugins' main-process code through the kernel, so no other process can add or rename them, and each call's input is validated before it runs; loopback endpoints with bearer tokens that reject browser requests; for the built-in agent, state-changing application tools (for example conda environment changes) require per-action user consent, and only the chat UI may answer consent prompts or change the auto-approve mode; external apps are off by default, paired per app with revocable tokens, and never receive chat context; remote URLs, local files, and non-named channels refused for agent-driven package installs |
| Kilo marketplace                          | Agents, skills, and MCP servers installed from a catalog                                                     | Catalog, install, and removal delegated to the CLI over its authenticated loopback interface; explicit user action per install; workspace or global scope chosen by the user                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Terminal                                  | Interactive shells started on user request                                                                   | Main-owned shell sessions; starting directory confined to the user's home or a registered workspace; application-internal environment variables removed from the shell environment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Conda bridge sidecar                      | Environment and package management requests                                                                  | Bundled helper over stdio (no listener); consent-gated agent mutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Notebook daemon                           | Notebook execution requests                                                                                  | Local socket (per-user on macOS/Linux) with peer-credential (process identity) checks, not yet bound to every connection; telemetry permission gated on consent and activity                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Local model serving                       | Model downloads and inference requests                                                                       | Model files verified by size and digest before use; runtime bound to loopback by default with a bearer credential; local-network exposure only by explicit user setting                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| External editor and git processes         | Editor launches and git commands on workspace folders                                                        | Workspace-folder confinement; executables resolved from the user's environment and run with the user's privileges                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Auth and credentials                      | Account identity, the Anaconda API key, and provider tokens                                                  | Kilo account credentials held by the CLI component, not desktop code; identity read fresh from the sidecar and degraded to anonymous on failure; the Anaconda sign-in uses authorization code with PKCE and a loopback callback that only the pending request can complete; the Anaconda API key and OS-keychain secrets are released only to permitted plugins calling from the main process, never to a window; credential values never logged                                                                                                                                                                                                                                                           |
| Network egress                            | Model requests, telemetry, downloads, update checks                                                          | TLS everywhere through the platform network stack (honoring system proxy and certificate stores); certificate validation never disabled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Telemetry and crash reporting             | Usage events and crash envelopes                                                                             | Single shared consent preference, enforced per event and at send time, propagated to the renderer and helper processes; the conda bridge receives its crash-reporting destination at start and its consent flag at every start, and enforces the flag itself                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Auto-update                               | Update metadata and packages                                                                                 | Feed location fixed at build time over TLS; size and digest checks against the feed's release list; platform signing and OS updater verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Release automation                        | Signing and publishing of release artifacts                                                                  | Release track orchestration with version checks; signing credentials confined to publishing jobs; SBOM generation with pinned tooling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### Known limitations

The following gaps are known from internal review and are not yet closed:

- **Plugin identity inside a window is advisory.** The main process knows which window a call came from, but plugins in one window share a JavaScript context, so code running in a window can claim to be any enabled plugin that runs there. The main process still refuses a window acting as the main-process kernel or a main-only plugin, and refuses every window call for secrets. Per-plugin checks on window-reachable methods (for example who may change the auto-approve mode, answer consent prompts, or obtain the CLI connection) keep well-behaved plugins apart but do not contain a compromised renderer.
- **Plugin-to-plugin access relies on per-method checks.** A shared object's declared permission can only name a host capability, so access between plugins depends on each method checking its caller. Commands forwarded from a window run in the main process without a caller identity.
- **Deep-link validation is renderer-side and looser than before.** The main process forwards any link with the app's scheme; the in-app resolver does not reject duplicate or reserved hosts and does not bound or safely decode the path parameter.
- **Plugin protocol schemes and embedded host names are not reserved.** Registration is limited to names the plugin declares, but there is no check against reserved schemes or between plugins: for embedded hosts the last registration wins and the first registrant's cleanup removes the second's.
- **Git branch names are not guarded against option injection.** A branch name beginning with a dash is passed to git checkout where git can read it as an option.

## 5. Attacker model and out-of-scope categories

### Attacker model

Remote web content, MCP/tool data, and OS deep links are untrusted. A compromised renderer is in scope — the Electron sandbox and the main process's transport validation and caller checks exist to contain it. Because plugins in one window share its JavaScript context, a compromised renderer is assumed able to act as any enabled plugin that runs in that window, but not as the main-process kernel or a main-only plugin, and not to obtain secrets reserved for main-process callers. Agent behavior influenced by untrusted content (prompt injection) is in scope where it can reach application-provided tools or install integrations without user consent. Same-user local processes are in scope only where the app introduces a new local listener (loopback servers, sockets, the agent-tool endpoints) that widens what such a process can reach. The OS user, physical access, and a compromised operating system are out of scope.

### Out of scope

| Category                          | Rationale                                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| OS user and physical access       | The app runs with the user's own privileges by design                                                          |
| Compromised operating system      | No application-level control can defend against a compromised OS                                               |
| LLM provider data handling        | Data sent to a configured model provider is governed by that provider's policies                               |
| External MCP server behavior      | User-configured MCP servers are outside the app's trust boundary; their outputs are treated as untrusted input |
| User-modified local configuration | Users control their own configuration; modifying one's own config is not an attack vector                      |
| Commands the user runs            | Terminal sessions and notebook code execute as the user by design                                              |

## 6. Identity and access model

### 6.1 Customer authentication

Sign-in uses the OAuth 2.0 device authorization grant against the Kilo account service, driven by the embedded Kilo CLI component. The desktop UI displays a short-lived user code and verification URL; the user completes authorization in their browser, and the CLI polls for completion. The desktop application never handles the user's account credentials or token material directly: the main process derives session state (signed-in status, profile email, current organization) by querying the CLI sidecar over its authenticated loopback interface, reads fresh on each resolution, and degrades to anonymous on any failure rather than serving a stale identity. Kilo sign-in uses no local callback listener.

Separately, the user can sign in to an Anaconda account to obtain the API key used by Anaconda services such as the model catalog (`Feature-dependent`: the account row is behind a feature flag). This sign-in uses the OAuth 2.0 authorization code grant with PKCE and a state parameter in the system browser, returning to a short-lived loopback callback listener on the single port registered for the OAuth client. Only a response on the expected path carrying the pending request's state value completes the flow; a busy port fails the sign-in with a clear error rather than falling back to another port. The Anaconda account is a credential source only; the app's identity remains the Kilo account.

### 6.2 Credential storage

Kilo account credentials, and the model-provider API keys the user enters, are managed by the embedded CLI component (shared with other Kilo clients) in its own credential storage. Desktop code does not inspect the account credentials; the provider settings UI can read back a stored provider key for display.

The Anaconda API key is kept in the Anaconda keyring shared with the Anaconda CLI and conda, so a sign-in in one tool carries over to the others. Its backend follows the shared Anaconda client configuration:

- an API key set in the user's own configuration is used directly and treated as read-only;
- otherwise the shared Anaconda credential file in the user's home directory and the OS keychain are tried in priority order, and new keys are written to the highest-priority usable backend.

The key is released only to the plugins permitted to use it (the account plugin itself and local inference) and only when they call from the main process; it never reaches a renderer window. Entries in the file-based backends are encoded, not encrypted, and rely on OS file permissions. Credentials are never written to logs. (`Production validation required`: which backend is in effect on a given machine depends on that machine's configuration.)

The host also offers plugins an OS-keychain store, namespaced per plugin and refused to every call from a renderer window.

### 6.3 Local service authentication

Loopback helper processes are authenticated rather than assumed safe by address: the CLI connector sidecar uses a per-launch credential, which the main process hands only to the application's own chat, account, and marketplace UI (so it is present in renderer windows), and the application verifies the notebook daemon's peer credentials (process identity) before trusting it with notebook execution. That check is made when the daemon connection is established rather than on every connection, a readiness probe precedes it, and on Windows it does not include a same-user check; these are known limitations tracked for follow-up. The local model runtime requires a bearer credential on requests and binds to the loopback interface by default; a user-facing setting can deliberately expose it on the local network. The conda bridge communicates over stdio and opens no listener. The agent-tool endpoints run inside the main process and bind to loopback: the built-in agent's endpoint uses a random port and a per-launch bearer credential passed only to the CLI sidecar, and the external AI apps endpoint is off by default and accepts only per-app bearer tokens (stored as hashes, revocable) with a matching `Host` and no browser `Origin`. The tool list itself comes only from plugins' main-process tool contributions through the kernel. The Anaconda sign-in's loopback callback listener exists only while a sign-in is pending, binds the loopback interface, and accepts only the authorization response for the pending request; the authorization code it receives is useless without the PKCE verifier held in the main process.

### 6.4 Renderer-to-main verification

Every IPC invocation, message, and port request is checked against the sender's origin; only the application's own privileged scheme and host, in a window the application created, are accepted, and main stamps each request with that window. The preload bridge is generic — request, send, and subscribe over the kernel's transport — so enforcement lives in the main process:

- The caller's process comes from the transport, never from the request. Call envelopes, method inputs, and method outputs are schema-validated, and only methods a shared object declares can be dispatched.
- A window may act only as its own window kernel, which is limited to window management and turning plugins on or off, or as a plugin the main process knows, that is enabled, and that ships a window entry. It can never act as the main-process kernel or a main-only plugin.
- Within a window, the claimed plugin is advisory, because a window's plugins share one JavaScript context. Secrets therefore refuse every call from a window (the OS-keychain store, the Anaconda API key), and methods that hand out control of the agent check their caller individually (obtaining the CLI connection, answering consent prompts and questions, changing the auto-approve mode).
- A shared object's declared permission can name only a host capability, such as the shell or the clipboard; access between plugins relies on per-method caller checks (see the known limitations in section 4).

Browser guest views carry no preload and cannot reach the IPC surface; their controllers are bound to the specific guest and the trusted window embedding it.

## 7. Data categories and persistence

### 7.1 Data categories

| Data category             | Examples                                                                        | Typical processing context                              |
| ------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Identity and account data | Account tokens, profile email and organization                                  | Sign-in, account features, authenticated service calls  |
| Workspace content         | Repository files, notebooks, chat transcripts, task metadata, terminal output   | Agentic coding sessions, notebook execution, UI display |
| Configuration             | User preferences, per-plugin settings, enabled integrations, installed skills   | Application and feature configuration                   |
| Provider credentials      | API keys for model providers or tools the user configures; the Anaconda API key | Authenticating user-selected external services          |
| Browsing data             | Cookies and site storage in the embedded browser session                        | Pages the user opens in the browser panel               |
| Usage and diagnostic data | Feature usage events, error reports, installation identifier, account email     | Consent-gated telemetry and crash reporting             |
| Downloaded artifacts      | CLI builds, model files, notebook UI bundle, conda packages, update packages    | Feature installation, local execution, and updates      |

### 7.2 Persistence surfaces

| Persistence surface                   | Primary role                                | Notes for security review                                                                                |
| ------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Credential store                      | Anaconda API key and plugin secrets         | Backend selection described in section 6.2; released only to permitted main-process callers              |
| Local configuration stores            | Preferences and per-plugin state            | Stored in the application data directory under the user's account; per-plugin isolation enforced in code |
| Terminal history                      | Scrollback restored across restarts         | Stored in the terminal plugin's private storage; may contain anything printed in a shell                 |
| Embedded browser session              | Cookies and site data for the browser panel | Persistent and separate from the application UI session                                                  |
| Downloaded model files                | On-device inference                         | Integrity-verified (size and digest) against the authenticated catalog before use                        |
| Conda environments and package caches | Python environment management               | Managed through the bundled conda bridge; packages fetched from configured channels                      |
| Notebook workspaces                   | Notebook content and execution state        | User-selected directories; execution is a feature, performed as the user                                 |
| Update staging (Windows)              | Downloaded update package awaiting install  | Disposable directory; package kept only after size and digest match the feed's release list              |

### 7.3 What leaves the machine

Outbound data flows are limited to: account/identity traffic, including the Anaconda sign-in when the user chooses it; feature-flag evaluation, which carries the signed-in account's email and organization; model requests to the providers or gateways the user configures; model catalog queries; consent-gated telemetry and crash reports; conda channel package fetches; marketplace catalog and install traffic (performed by the CLI); update checks and downloads; web pages the user opens in the embedded browser, plus a site-icon lookup for each visited site's host name through a third-party icon service; and any user-configured MCP servers. All outbound traffic uses TLS where the destination supports it; the application does not disable certificate validation anywhere.

## 8. Core data flows

### 8.1 Sign-in flow

```mermaid
sequenceDiagram
  participant UI as Renderer
  participant Main as Main Process
  participant CLI as Kilo CLI Sidecar
  participant Kilo as Kilo Account Service
  participant Browser as User Browser

  UI->>CLI: Start device authorization (via authenticated loopback)
  CLI->>Kilo: Request device code
  Kilo-->>CLI: User code and verification URL
  CLI-->>UI: Display code and verification URL
  UI->>Browser: User opens verification URL
  Browser->>Kilo: User authorizes and enters code
  CLI->>Kilo: Poll for completion
  Kilo-->>CLI: Credentials issued (managed by the CLI component)
  Main->>CLI: Read auth status and profile (fresh per resolution)
  CLI-->>Main: Session identity (email, current organization)
  Main-->>UI: Signed-in state (no token material)
```

### 8.2 Agentic coding session and MCP tool flow

```mermaid
sequenceDiagram
  participant UI as Renderer
  participant Main as Main Process
  participant CLI as CLI Connector Sidecar
  participant Model as LLM Provider or Gateway
  participant MCP as MCP Tool Servers

  UI->>Main: Request the CLI connection (caller-checked)
  Main-->>UI: Loopback address and per-launch credential
  UI->>CLI: Submit task (loopback, per-launch credential)
  CLI->>Model: Model requests with configured credentials
  CLI->>MCP: Tool calls to user-configured servers
  MCP-->>CLI: Tool results (treated as untrusted data)
  Model-->>CLI: Responses
  CLI-->>UI: Streamed events, rendered as progress
```

### 8.3 Application-provided agent tool flow

```mermaid
sequenceDiagram
  participant CLI as CLI Connector Sidecar
  participant UI as Renderer
  participant User as User
  participant Gateway as Agent-Tool Endpoint (Main Process)
  participant Plugin as Plugin Tool (Main Process)

  alt State-changing tool (for example conda environment change)
    CLI->>UI: Permission request for the exact operation
    UI->>User: Per-action consent card
    User-->>UI: Approve or reject
    UI->>CLI: Reply through the main process (caller-checked)
  end
  CLI->>Gateway: Call application tool (loopback, per-launch bearer credential)
  Gateway->>Gateway: Check sign-in requirement and validate input
  Gateway->>Plugin: Run the plugin's main-process implementation
  Plugin-->>Gateway: Tool result
  Gateway-->>CLI: Tool result
```

When the user has turned on auto-approve, the chat UI answers permission requests on the user's behalf; only the chat UI (or the main-process kernel) can change that mode.

### 8.4 Model download and local inference flow

```mermaid
sequenceDiagram
  participant UI as Renderer
  participant Main as Main Process
  participant Cat as Model Catalog Service
  participant RT as Local Model Runtime

  UI->>Main: Request model download
  Main->>Cat: Fetch catalog entry (authenticated)
  Cat-->>Main: Download location and expected digest
  Main->>Cat: Download artifact
  Main->>Main: Verify size and digest before install
  Main->>RT: Load model (loopback, bearer credential)
  UI->>Main: Chat request
  Main->>RT: Inference request
  RT-->>Main: Response
```

### 8.5 Auto-update flow

```mermaid
sequenceDiagram
  participant Main as Main Process
  participant Feed as Update Distribution Feed
  participant OS as Operating System

  Main->>Feed: Check for updates (TLS, fixed feed location set at build time)
  Feed-->>Main: Update metadata and release list
  Main->>Feed: Download update package
  Main->>Main: Windows: verify size and digest against the release list, stage locally
  Main->>OS: Install via platform updater (signed package verification by OS/updater)
```

Update authenticity relies on platform code signing and the OS updater's verification of signed packages. The digest check on Windows protects integrity in transit; it comes from the same feed as the package and is not a separate signature. The feed location is fixed at build time and served over TLS. Production signing configuration requires environment-specific validation (section 13).

### 8.6 Telemetry flow with consent gating

```mermaid
sequenceDiagram
  participant UI as Renderer
  participant Main as Main Process
  participant Pref as Preference Store
  participant PH as Telemetry Service
  participant SE as Crash Reporting Service

  UI->>Main: Change data-collection preference
  Main->>Pref: Persist preference
  Main->>Main: Propagate setting to renderer and embedded helper processes
  Note over Main,SE: While collection is off, analytics events are blocked and crash envelopes are dropped at send time
  Main->>PH: Usage events (only while consented, attributed to the account once signed in)
  Main->>SE: Crash envelopes (only while consented, scrubbed)
```

## 9. Security controls summary

| Control area          | Architecture-level control                                                                                                                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer containment  | Sandboxing, context isolation, no Node integration in the renderer, restrictive content security policy, dedicated untrusted-content profile for embedded web content                                                                                                                                                           |
| Browser isolation     | Separate browser session for remote pages; all web permissions denied; guest settings forced secure with no preload; http(s)-only navigation; guest controllers bound to the trusted window                                                                                                                                     |
| IPC hardening         | Per-call sender-origin verification; caller process derived from the transport; schema validation of envelopes and method inputs and outputs; window callers limited to the window kernel's narrow rights or enabled plugins with a window entry; secrets refused to windows; per-method caller checks on agent-control methods |
| Deep-link validation  | App scheme required; host matched against plugin-declared entries; links only select an in-app page with its declared parameters and never trigger actions (limits in section 4)                                                                                                                                                |
| Agent tool consent    | State-changing application tools require per-action user approval showing the exact operation; agent-driven package installs refuse remote URLs, local files, and non-named channels                                                                                                                                            |
| Secret handling       | Account credentials kept in the CLI component; no credential values in logs; credentials passed to helper processes over authenticated loopback channels with scrubbed environments                                                                                                                                             |
| Download integrity    | CLI artifacts resolved from a frozen dependency lockfile with registry checksums; model files verified by size and digest before install; notebook UI bundle pinned and digest-verified                                                                                                                                         |
| Execution containment | Helper processes are separate OS processes with loopback-only, authenticated, or stdio interfaces; terminal working directory confined to home or registered workspaces; server-supplied widget HTML sandboxed                                                                                                                  |
| Update integrity      | Fixed build-time feed location over TLS; Windows packages size- and digest-checked against the release list; platform signing and OS updater verification                                                                                                                                                                       |
| Privacy controls      | Shared consent preference with per-event enforcement and propagation to renderer and embedded helper processes; crash envelopes scrubbed and dropped at send time while collection is off                                                                                                                                       |
| Browser hardening     | External URL opening restricted to allowed schemes; no renderer path to open local files or read the clipboard; new-window and navigation attempts from the application UI denied by default and handed to the system browser; embedded-browser guest guard applied to every application window                                 |

## 10. Third-party integration topology

### Integration status legend

| Status                         | Meaning                                                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Platform dependency            | Required for the application to function as distributed                                                                 |
| Feature-dependent              | Invoked when the relevant capability is used or enabled                                                                 |
| Customer-configured            | Opt-in integration selected and configured by the user                                                                  |
| Runtime-selected               | Supported by the repository, but the active provider or route is determined by configuration outside static source code |
| Production validation required | Referenced by code or configuration, but live details must be confirmed before making an external claim                 |

### Integration inventory

| Provider or service                         | Status                                   | Security-relevant role                                                                                                                                                   |
| ------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Kilo account and identity service           | Platform dependency                      | Device-authorization sign-in, profile and organization state, authenticated service calls                                                                                |
| Anaconda account service                    | Feature-dependent                        | Optional browser sign-in (authorization code with PKCE) that stores the Anaconda API key used by the model catalog                                                       |
| LLM providers and gateways                  | Customer-configured or runtime-selected  | Process prompts, workspace context, and tool data per the user's provider configuration; data handling governed by provider policies                                     |
| Model catalog service                       | Feature-dependent                        | Supplies local-model metadata, download locations, and expected digests over an authenticated channel                                                                    |
| Kilo marketplace catalog                    | Feature-dependent                        | Lists installable agents, skills, and MCP servers; accessed by the CLI component                                                                                         |
| PostHog                                     | Feature-dependent                        | Product analytics; consent-gated; events attributed to the account email once signed in                                                                                  |
| Sentry                                      | Feature-dependent                        | Crash and error reporting for the application (scrubbed and consent-gated at send time) and the conda bridge (gated by the bridge on the stamped consent flag)           |
| LaunchDarkly                                | Platform dependency                      | Feature-flag evaluation; receives account identity (email and current organization; not the display name) once signed in; not governed by the data-collection preference |
| Site-icon lookup service (Google)           | Feature-dependent                        | Receives the host name of each site opened in the embedded browser to return its icon                                                                                    |
| Update distribution feed                    | Platform dependency                      | Update metadata and packages over TLS; hosting details are production-validated                                                                                          |
| Conda package channels                      | Feature-dependent or customer-configured | Package downloads for environment management; default channels with user-configurable additions                                                                          |
| Notebook UI bundle source                   | Platform dependency                      | Pinned, digest-verified UI artifact fetched at build/staging time                                                                                                        |
| User-configured MCP servers                 | Customer-configured                      | Extend agent capabilities; outputs treated as untrusted input; behavior outside the app's trust boundary                                                                 |
| Websites opened in the embedded browser     | Customer-configured                      | Arbitrary remote content rendered in isolated guest views                                                                                                                |
| External editors and local tools (e.g. git) | Customer-configured                      | Launched on the user's behalf with user privileges; binaries resolved from the user's environment                                                                        |

## 11. Privacy, logging, and retention considerations

### Privacy handling

Content and configuration persist locally on the user's machine by default. Data leaves the machine only through the flows listed in section 7.3. Telemetry and crash reporting are governed by a single data-collection preference; changes propagate to the renderer and to embedded helper processes without requiring an application restart. Before sign-in, usage events are attributed to an anonymous installation identifier. After sign-in they are attributed to the account email, and the earlier anonymous identifier is linked to it. The same installation identifier is shared with the embedded CLI and conda bridge so their telemetry correlates with the desktop's. Notebook-runtime telemetry is permitted only while consent is granted and a notebook is active. The conda bridge receives its own crash-reporting destination at start and reports only while the consent flag it is started with is on; the bridge enforces that flag itself. Data collection is on by default, and the user can turn it off in Privacy settings. Feature-flag evaluation is separate from telemetry: it sends the signed-in account's email and current organization (not the display name) to the flag service whatever the data-collection setting.

### Logging safety

Repository policy prohibits logging tokens, credentials, and authentication material, and telemetry diagnostics mask email addresses. Local logs remain on the user's machine and are not automatically redacted. Diagnostic uploads occur only through consent-gated crash reporting, which applies a scrubbing pass before sending.

### Retention

Local data (chats, notebooks, terminal history, browser session data, models, environments, configuration) is retained until the user deletes it or uninstalls the application. Retention on external services is governed by the applicable provider's terms and the user's own configuration, and requires validation against the live service inventory.

## 12. Shared responsibility

Kilo Desktop provides application-level controls for renderer and browser containment, validated IPC, deep-link validation, credential handling, authenticated local helper channels, download integrity, per-action consent for state-changing agent tools, and consent-gated telemetry. Users remain responsible for decisions that expand their own trust boundary, including:

- Which LLM providers, gateways, and API credentials they configure, and those providers' data policies.
- Which MCP servers, marketplace agents and skills, and third-party tools they install or connect, and the trustworthiness of those servers' outputs.
- Which repositories, notebooks, and packages they allow the agent to work with, since agentic task execution runs with the user's own privileges.
- Reviewing the operation shown on each consent card before approving agent-requested changes.
- Commands they run in the terminal and sites they visit in the embedded browser.
- Whether to enable local-network exposure of the local model runtime (off by default).
- Securing their own machine and operating system.
- How they review generated changes before applying or merging them.

## 13. Environment-specific validation checklist

Before external publication or use as contractual evidence, validate the following against the live build and distribution environment:

1. Code-signing and notarization configuration for each shipped platform, and updater signing verification behavior (including signature verification of Windows update packages staged locally).
2. The deployed update feed location, transport security, and release publishing controls.
3. Credential-store backend in effect per platform and configuration (shared credential file vs OS keychain).
4. The active model catalog service and the integrity metadata it returns.
5. Telemetry and crash-reporting endpoint configuration, data dictionaries (including account-linked identity), and effective consent enforcement in shipped builds.
6. Default conda channel configuration and any organization-specific channel overrides.
7. Marketplace catalog source and the CLI's integrity checks on installed items.
8. Anaconda account OAuth client configuration (the registered loopback redirect) and the feature flag that exposes the sign-in.
9. Current DPA, subprocessor list, and vendor assurance documentation for the external services in section 10.

## 14. Internal evidence baseline

This document was compiled from repository sources, including the following internal references (paths only; the companion threat-model scan holds code-level evidence):

- `AGENTS.md`, `CONTEXT.md`
- `apps/desktop/src/main/kernel/` (kernel host: transport, host primitives and services) and `apps/desktop/src/main/platform/` (Electron security, window and webview hardening, shell, context menu, protocol, deep links, browser host, updater and Windows update feed, HTTP client, scoped storage, crash-report scrubbing)
- `apps/desktop/src/preload/preload.ts` and `apps/desktop/src/preload/window-arguments.ts`
- `packages/kernel/src/` (domain registry and caller checks, host permissions, commands, transport, errors), `packages/bundled-plugins/` (plugin list, window-entry and protocol-scheme lists), `docs/plugins/domains.md`, `docs/agent-tools.md`
- `plugins/account/` (Kilo-backed identity, device sign-in, terms)
- `plugins/anaconda-account/` (Anaconda sign-in, loopback callback, shared keyring, API-key release)
- `plugins/shell/` (deep-link resolution) and `plugins/workspaces/` (workspace path authorization)
- `plugins/telemetry/`, `plugins/flags/` and `apps/desktop/src/main/platform/sentry.ts`
- `apps/desktop/forge.config.ts` and `apps/desktop/config/` (signing, publishers, update feed)
- `plugins/chat/` (tool consent cards, Auto-approve, agent HTML pages, MCP app widgets, MCP app resource reads)
- `plugins/agent/` (CLI connector sidecar, CLI distribution, MCP configuration, agent-tool gateway and endpoints, caller checks, external AI apps settings)
- `plugins/kilo-marketplace/` (marketplace delegation to the CLI)
- `plugins/browser/` (embedded browser)
- `plugins/terminal/` (terminal sessions, working-directory confinement, environment scrubbing)
- `plugins/local-inference/` (model catalog, download manager, local runtime, deep link)
- `plugins/notebook/` (daemon manager, peer authentication, telemetry permission, bundle staging)
- `plugins/environments/` (conda bridge and its crash-reporting configuration, conda agent tools, consent cards)
- `plugins/files/` and `plugins/git/` (external editors, git execution, worktrees)
- `.github/workflows/` and `.github/actions/` (release, publishing, code signing, SBOM)
- `docs/security/boundary-register.md`, `docs/security/register-sync.md`, and `.agents/skills/threat-model/references/template-questions.md`
