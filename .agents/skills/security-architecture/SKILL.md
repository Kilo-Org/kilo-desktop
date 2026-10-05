---
name: security-architecture
description: Produce or refresh docs/security/security-architecture.md, the durable customer/due-diligence-facing security architecture overview for Kilo Desktop (topology, trust boundaries, identity model, data flows, controls, integrations). Use when the user asks for a security architecture overview, trust-boundary overview, or to refresh the security architecture doc.
---

# Security architecture overview

Produce or refresh `docs/security/security-architecture.md` — the durable, customer/due-diligence-facing description of the app's security architecture. Unlike the threat-model scan (a dated, gitignored, point-in-time artifact produced by the `threat-model` skill), this doc is **committed** and **maintained**: it changes when the architecture changes, not on every run.

## Model recommendation

Use a strong reasoning model (Claude Opus 5 `high` or better). The doc must distinguish repo-supported fact from plausible-sounding assumption; small models blur that line.

## Where this fits

Recommended refresh order is `security-architecture` → `threat-model` (see `docs/security/README.md` "How to refresh"). This skill runs first because the scan reads its attacker model from this doc.

## Quick start

1. **Register sync (mandatory, first)** — follow `docs/security/register-sync.md` against `docs/security/boundary-register.md`. Fix the register itself (it is shared with the `threat-model` skill); summarize its changes in this run's Version history row.
2. Read `CONTEXT.md` and `AGENTS.md` for the repo's architecture and conventions.
3. Read the current `docs/security/security-architecture.md` if it exists.
4. Read the synced `docs/security/boundary-register.md` as the seed for the trust-boundary section — but never copy it verbatim (see Publication constraints).
5. Write the doc per the output contract below. The same instructions are embedded in the doc as a "Maintainer agent update prompt" so future runs can start from the doc alone.

## Publication constraints (hard rules)

This doc may be shared with customer security reviewers. It must not disclose internal operational detail:

- **No `file:line` references.** Source file *paths* are acceptable (they orient reviewers who have repo access); line numbers are not — they rot and add no review value.
- **No hostnames, ports, URLs, env-var names, secret names, queue/binding names, machine identifiers, or retry counts** in narrative, tables, or diagrams. Describe roles ("update feed host", "loopback sidecar port") instead.
- **Distinguish repo-supported fact from operational configuration** using status labels: `Platform dependency`, `Feature-dependent`, `Customer-configured`, `Runtime-selected`, `Production validation required`. Never claim a provider, region, retention period, encryption setting, or rollout is active unless repository evidence supports the claim.
- Never log, print, or copy credential values while researching.
- Keep legal/contractual claims (SLAs, certifications, DPAs) out; link or defer to legal documents.

## Content requirements

The doc is the home of the **high-level threat model**: attacker model, out-of-scope categories, and the boundary → primary-controls mapping. Keep it at logical architecture level; detail that answers "where exactly in code" belongs to the threat-model scan report, not here.

Staleness contract: the metadata block carries `Last reviewed` commit + date. A PR that adds or moves a trust boundary must refresh the affected sections (recorded as a maintenance rule in `docs/security/README.md`). The `threat-model` skill flags this doc as stale when the boundary register has moved past it — treat that flag as a refresh trigger.

## Output contract

Write `docs/security/security-architecture.md` with exactly this section skeleton:

```markdown
# Kilo Desktop Security Architecture Overview

## Document metadata
Table: Audience | Document owner | Document version | Last reviewed (date + commit) | Review cadence (quarterly and before material trust-boundary, data-flow, or distribution changes)

## Version history
Table: Version | Date | Summary — one concise row per refresh; preserve prior rows.

## Maintainer agent update prompt
A fenced, self-contained prompt an agent can use to refresh this doc (mirror of this skill's workflow + publication constraints).

## 1. Purpose and scope
What the doc is; what it is not (not a pen-test report, DPA, compliance attestation).

## 2. Executive overview
Component inventory at logical level: Electron shell (main/renderer/preload), plugin system, local sidecars (Kilo CLI connector, conda bridge, notebook daemon), local model runtime, external services.

## 3. Application topology
Mermaid flowchart + component summary table (Layer | Description | Security relevance).

## 4. Trust boundaries
Mermaid diagram + boundary table: Boundary | What crosses it | Primary controls. Boundary names and control descriptions only — no file:line. Include: renderer↔main IPC, renderer↔OS shell, event bus, plugin SDK sandbox, connector sidecar, MCP tool servers / webmcp relay, auth & credentials, network egress, telemetry, local model serving, preload surface, pane windows, conda bridge, notebook daemon, external editor/git processes, custom protocols, embedded web hosts, MCP apps/widgets, auto-update, release automation.

## 5. Attacker model and out-of-scope categories
The canonical attacker model statement (the threat-model skill links here): remote web content and MCP/tool data untrusted; compromised renderer in scope; same-user local processes in scope only where the app introduces a new local listener; OS user / physical access / compromised OS out of scope. Out-of-scope table: Category | Rationale.

## 6. Identity and access model
Customer authentication (device-authorization sign-in driven by the embedded Kilo CLI; main process derives session state from the sidecar), credential storage backends (OS keychain vs config-file fallback), loopback/sidecar authentication (per-launch credentials, socket peer credentials), renderer↔main sender verification.

## 7. Data categories and persistence
Data-category table (category | examples | processing context); local persistence surfaces (keychain, preferences, per-plugin stores, model files, conda envs, notebooks); what leaves the machine (model API calls, telemetry/crash reports, catalog requests, update checks).

## 8. Core data flows
Mermaid sequence diagrams: device-authorization sign-in; model request (remote + local inference path); MCP tool invocation; model download & local inference; auto-update; telemetry with consent gating.

## 9. Security controls summary
Table: Control area | Architecture-level control (authentication, IPC hardening, secret handling, download integrity, execution containment, update integrity, privacy controls, browser/renderer hardening).

## 10. Third-party integration topology
Integrations table with status labels: identity provider, LLM providers/gateways, model catalog, telemetry (PostHog), crash reporting (Sentry), update distribution, conda channels, notebook UI artifact source, user-configured MCP servers, external editors.

## 11. Privacy, logging, and retention considerations
Consent model (shared opt-out preference and its propagation to renderer and embedded CLI), what telemetry/crash data exists, local retention (data stays on the user's machine unless listed above).

## 12. Shared responsibility
What the app provides vs what users remain responsible for (configured MCP servers, model provider policies, LAN mode for local inference, securing their own machine).

## 13. Environment-specific validation checklist
Items a reviewer must validate outside source control: signing/notarization configuration, update feed configuration, keyring backend behavior per platform, distribution channel integrity.

## 14. Internal evidence baseline
Bulleted list of source paths consulted (paths only, no line numbers) so the next refresh knows where the claims came from.
```

## Verification

1. Confirm no `file:line` references, env-var names, hostnames, ports, or secret names in the output (`rg ':[0-9]+' docs/security/security-architecture.md` should only match prose like version numbers — review matches).
2. Confirm every diagram is valid Mermaid (fences closed, IDs alphanumeric).
3. Confirm every factual claim traces to code read during this run; anything not verifiable gets a status label instead of an assertion.
