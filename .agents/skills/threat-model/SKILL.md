---
name: threat-model
description: Walk the Agentic Desktop codebase through the 7-section STRIDE+Privacy Threat Modeling Template, checking real trust boundaries (Electron IPC, kilo-server sidecar, MCP tool servers, auth/keyring, telemetry) and emitting a structured mitigation/gap analysis to docs/security/threat-model.md. Use when the user says "threat model", "STRIDE", "security review", or asks to update the threat model doc.
---

# Threat Model

Walk the codebase against the Security team's 7-section Threat Modeling Template and produce `docs/security/threat-model.md`.

## Model recommendation

This skill needs long-context reading plus disciplined evidence citation — run it on a strong reasoning model:

- **Primary:** Claude Opus 5 (`high` variant; `max` for release-time deep passes). In a head-to-head run it found materially more real issues than Opus 4.8 (e.g. telemetry credential reuse, keychain-not-default, the auto-update boundary). If it hits the per-response output limit, prompt it to write each section table into the output file as it completes it rather than composing one large final output.
- **Cross-check:** Claude Opus 4.8 (`high`) as the second pass — it follows the output contract most strictly. GPT-5.6 (`xhigh`) also works; model diversity catches single-model blind spots.
- **Avoid** small/fast models (e.g. Gemini Flash tiers) for the section walk; they drop format compliance and invent mitigations. They're acceptable only for the mechanical Phase 0 existence/scan steps.

## Quick start

1. Read `references/template-questions.md` — the canonical template questions (what to answer).
2. Read `references/architecture.md` — trust boundaries → files → candidate threats (where to look).
3. Run **Phase 0** (reference freshness audit) — mandatory, before any section work.
4. Work the 7 template sections in order, then write the output doc.

## Phase 0: reference freshness audit (mandatory, runs first)

`references/architecture.md` is only useful while it matches the code. Before trusting it:

- **Existence check:** glob every file anchor in the architecture table. A deleted/renamed path marks that row stale.
- **New-boundary scan:** sweep for undocumented boundary candidates — `plugins/*/plugin.json` not in the map, new `createServer` / `.listen(` / `net.fetch` / keyring / `openExternal` usages, new CLI-distribution or relay code. Anything undocumented means the map is behind the code.
- **Semantic check:** free — the section workflow reads these files anyway, so behavior changes (e.g. `ScopedFsService` stops rejecting escapes) surface during the walk.
- **Self-heal:** update `references/architecture.md` in the same run, *before* section work, and record every change in the output's Run notes section — freshness fixes land in the same commit and PR as the threat model.
- **Known limit:** structural drift is caught mechanically; a boundary that changed *meaning* with no mechanical trace is only covered by the PR maintenance-trigger rule in `references/architecture.md`.

## Scope and assessment rules

- **Attacker model:** Remote web content and MCP/tool data are untrusted. A compromised renderer is in scope (the Electron sandbox + preload exist to contain it). Same-user local processes are in scope only where the app introduces a *new* local listener (loopback servers, sockets) that widens what such a process can reach. The OS user, physical access, and a compromised OS are out of scope.
- **Severity rubric:** High = exploitable security/privacy impact without user action; Medium = requires local access or a multi-step chain; Low = hardening / defense-in-depth.
- **One row per issue:** file each issue once, in the section of its primary impact; cross-reference from other sections in Notes rather than duplicating the row.
- **Audit-only:** never fix code during a threat-model run. Findings go in the doc; fixes go in separate PRs.
- **Dev-only paths:** test files, dev-only escape hatches (e.g. `KILO_CODE_CLI_PATH`, `ANACONDA_SKIP_KEYRING`), and build tooling are in scope to *read*, but findings on them must note the dev-only context in Notes instead of auto-assigning High.

## Workflow (per template section)

For each of the 7 sections in `references/template-questions.md`:

1. For each template question, consult the architecture map: every boundary row whose **Candidate threats** column mentions this section names the files to read. Read those files.
2. Every finding must cite its template question: `<Section> <n>` (e.g. `Spoofing 1`, `Privacy 5`), where `n` is the question's number in `references/template-questions.md`. A finding that genuinely maps to several questions in the same section may cite them comma-separated (e.g. `Info Disclosure 4, 10`) — prefer the single best question when one fits. Findings not covered by any numbered question cite the section's catch-all ("You've invented a new … attack"). Catch-all numbers vary per section — currently `Spoofing 13`, `Tampering 12`, `Repudiation 13`, `Information Disclosure 13`, `Denial of Service 13`, `Elevation of Privilege 10`, `Privacy 13`; always read the number from the template file rather than assuming 13.
3. Mark each applicable threat with one of four statuses (always with emoji):
   - `✅ Mitigated` — mitigation exists; cite `file:line` evidence.
   - `⚠️ Gap` — no mitigation found; assign severity + suggested owner area.
   - `🤝 Accepted` — risk consciously accepted by the security team. **Humans only:** never assign this status; only preserve rows a human marked `Accepted`. Owner + date mandatory in Notes; not re-litigated unless the underlying evidence files changed.
   - `➖ N/A` — justify briefly.
4. **Never invent mitigations** — evidence must be a real code path read during this run.
5. The map is a seed, not exhaustive — also record threats you find that are NOT listed in the map (and add them to `references/architecture.md` per its maintenance rule). These still cite the catch-all question number.

## Output

Write `docs/security/threat-model.md` using exactly this skeleton (section names come from `references/template-questions.md` — if they ever differ from STRIDE+P, the template wins):

```markdown
# Threat Model — Anaconda Agentic Desktop
- Date: <run date>  Commit: <the commit whose code was analyzed> — `git merge-base HEAD origin/main` when the current branch has no code changes relative to main (docs-only branches); otherwise `git rev-parse HEAD`

## 1. Spoofing
| Template Ref | Threat | Boundary | Affected files | Mitigation (file:line) | Status | Severity | Notes |
|---|---|---|---|---|---|---|---|

## 2. Tampering
...same table...

## 3. Repudiation
## 4. Information Disclosure
## 5. Denial of Service
## 6. Elevation of Privilege
## 7. Privacy

## Summary
Counts by status; gaps sorted by severity; recommended follow-up tickets.

## Run notes
First line: the model + reasoning variant that produced the run (e.g. `Model: Claude Opus 5 (high)`) — explains output variance between runs.
Then four subsections, each omitted when empty:
- **Reference updates** (Phase 0 output): stale anchors fixed, new boundaries added to `references/architecture.md` — file + what changed.
- **Regenerated rows**: which evidence files changed since the last run's commit and which rows were re-evaluated as a result. Rows not listed here were carried over unchanged.
- **Severity/status changes**: any re-assessment of carried-over rows (e.g. rubric or attacker-model changes), with rationale.
- **Ambiguities**: claims that could not be verified from the repo — the reviewer's follow-up list.
```

## Where to put what (maintainers)

When a review finds the skill made a wrong or generic assumption, fix the layer that owns that kind of information:

1. **Facts about the code** (boundary moved/added, mitigation exists at `file:line`) → `references/architecture.md`. It absorbs architecture drift so this file and `template-questions.md` stay stable.
2. **Durable judgment/policy** (severity rubric, accepted platform assumptions, "don't flag X because…") → this `SKILL.md` as a workflow rule. If these grow past ~15 lines, spin out `references/conventions.md` and link it from Quick start.
3. **Verdicts on specific findings** → never in the skill. A human marks the row `🤝 Accepted` in the output doc with owner + date.

## Update semantics

On re-run:

- Preserve existing `🤝 Accepted`/`✅ Mitigated` rows whose evidence files are unchanged; regenerate rows whose evidence changed; append new findings.
- A fixed gap becomes a `✅ Mitigated` row — nothing ever moves to a separate file.
- Output must be diffable across runs — stable row ordering within each section table: alphabetical by **Boundary**, then numeric by **Template Ref**. Threat names are model-authored and may drift between runs; Template Refs come from the fixed template, so they anchor the order.

## Verification

After writing the output doc:

1. Every finding cites real `file:line` evidence read during this run — spot-check 3 `✅ Mitigated` rows against the cited code.
2. Re-run immediately and confirm idempotent output (no duplicate rows).
