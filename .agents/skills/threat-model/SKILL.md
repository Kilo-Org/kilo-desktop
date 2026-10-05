---
name: threat-model
description: Run a dated STRIDE+Privacy threat-model scan of the Kilo Desktop codebase against the boundary register, writing a point-in-time report to docs/security/local/ (gitignored, never committed). Use when the user says "threat model", "STRIDE", "security review", or asks to run or refresh the threat-model scan.
---

# Threat-model scan

Walk the codebase against the Security team's 7-section STRIDE+Privacy template and produce a **point-in-time scan report** at `docs/security/local/threat-model-YYYY-MM-DD.md`.

The report is a dated, fully regenerated snapshot of the code at one commit — not a living document. Staleness is declared in the header (date + analyzed commit), never "maintained" by editing rows. Re-running on newer code produces a new report. For the durable, architecture-level view see `docs/security/security-architecture.md` (produced by the `security-architecture` skill).

The report is **never committed**: `docs/security/local/` is gitignored because the report lists open gaps in detail. The operator is responsible for storing or sharing it outside the repo.

## Model recommendation

This skill needs long-context reading plus disciplined evidence citation — run it on a strong reasoning model:

- **Primary:** Claude Opus 5 (`high` variant; `max` for release-time deep passes). In a head-to-head run it found materially more real issues than Opus 4.8 (e.g. telemetry credential reuse, keychain-not-default, the auto-update boundary). If it hits the per-response output limit, prompt it to write each section table into the output file as it completes it rather than composing one large final output.
- **Cross-check:** Claude Opus 4.8 (`high`) as the second pass — it follows the output contract most strictly. GPT-5.6 (`xhigh`) also works; model diversity catches single-model blind spots.
- **Avoid** small/fast models (e.g. Gemini Flash tiers) for the section walk; they drop format compliance and invent mitigations. They're acceptable only for the mechanical register-sync steps.

## Where this fits

Recommended refresh order is `security-architecture` → `threat-model` (see `docs/security/README.md` "How to refresh"). Both skills start with the same register sync, so if the overview was refreshed first, step 1 below should be a no-op.

## Quick start

1. **Register sync (mandatory, before any section work)** — follow `docs/security/register-sync.md` against `docs/security/boundary-register.md`. Record its change list for the report's Run notes.
2. **Overview staleness check** — if `docs/security/security-architecture.md` is missing, or the sync changed register rows, or register rows changed since the overview's `Last reviewed` commit, note it in Run notes and tell the operator to re-run the `security-architecture` skill. Do not edit the overview from this skill.
3. Read `references/template-questions.md` — the canonical template questions (what to answer).
4. Read `docs/security/boundary-register.md` — trust boundaries → files → candidate threats (where to look).
5. Read the attacker model in `docs/security/security-architecture.md` if present.
6. Work the 7 template sections in order, then write the report.

## Scope and assessment rules

- **Attacker model:** the canonical statement lives in `docs/security/security-architecture.md`. If that file is absent, use: remote web content and MCP/tool data are untrusted; a compromised renderer is in scope (the Electron sandbox + preload exist to contain it); same-user local processes are in scope only where the app introduces a *new* local listener (loopback servers, sockets) that widens what such a process can reach; the OS user, physical access, and a compromised OS are out of scope.
- **Severity rubric:** High = exploitable security/privacy impact without user action; Medium = requires local access or a multi-step chain; Low = hardening / defense-in-depth.
- **One row per issue:** file each issue once, in the section of its primary impact; cross-reference from other sections in Notes rather than duplicating the row.
- **Audit-only:** never fix code during a scan. Findings go in the report; fixes go in separate PRs.
- **Dev-only paths:** test files, dev-only escape hatches (e.g. `KILO_CODE_CLI_PATH`, `ANACONDA_SKIP_KEYRING`), and build tooling are in scope to *read*, but findings on them must note the dev-only context in Notes instead of auto-assigning High.

## Workflow (per template section)

For each of the 7 sections in `references/template-questions.md`:

1. For each template question, consult the register: every boundary row whose **Candidate threats** column mentions this section names the files to read. Read those files.
2. Every finding must cite its template question: `<Section> <n>` (e.g. `Spoofing 1`), where `n` is the question's number in `references/template-questions.md`. A finding that genuinely maps to several questions in the same section may cite them comma-separated (e.g. `Info Disclosure 4, 10`) — prefer the single best question when one fits. Findings not covered by any numbered question cite the section's catch-all ("You've invented a new … attack"). Catch-all numbers vary per section — currently `Spoofing 13`, `Tampering 12`, `Repudiation 13`, `Information Disclosure 13`, `Denial of Service 13`, `Elevation of Privilege 10`, `Privacy 13`; always read the number from the template file rather than assuming.
3. Mark each applicable threat with one of three statuses (always with emoji):
   - `✅ Mitigated` — mitigation exists; cite `file:line` evidence.
   - `⚠️ Gap` — no mitigation found; assign severity + suggested owner area.
   - `➖ N/A` — justify briefly.

   There is deliberately **no "Accepted" status**. Accepting a risk is a human decision tracked in tickets/PRs outside the repo — the report stays fully regenerable, so an accepted risk simply reappears as a `⚠️ Gap` on every run. Notes may record known context (e.g. "previously accepted, see PR #123").
4. **Never invent mitigations** — evidence must be a real code path read during this run.
5. The register is a seed, not exhaustive — also record threats you find that are NOT listed in the register (and add them to `docs/security/boundary-register.md` per its maintenance rule). These still cite the catch-all question number.

## Output

Create `docs/security/local/` if needed and write `docs/security/local/threat-model-YYYY-MM-DD.md` using exactly this skeleton (section names come from `references/template-questions.md` — if they ever differ from STRIDE+P, the template wins):

```markdown
# Threat Model Scan — Kilo Desktop
- Date: <run date>  Commit: <the commit whose code was analyzed> — `git merge-base HEAD origin/main` when the current branch has no code changes relative to main (docs-only branches); otherwise `git rev-parse HEAD`
- Point-in-time snapshot. Regenerate on demand; do not hand-edit rows.

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
Then subsections, each omitted when empty:
- **Register updates** (register-sync output): stale anchors fixed, new boundaries added to `docs/security/boundary-register.md` — file + what changed.
- **Overview staleness**: whether `docs/security/security-architecture.md` is missing or older than register changes.
- **Ambiguities**: claims that could not be verified from the repo — the reviewer's follow-up list.
```

## Where to put what (maintainers)

When a review finds the skill made a wrong or generic assumption, fix the layer that owns that kind of information:

1. **Facts about the code** (boundary moved/added) → `docs/security/boundary-register.md` (procedure: `docs/security/register-sync.md`). It absorbs architecture drift so this file and `template-questions.md` stay stable.
2. **Durable judgment/policy** (severity rubric, accepted platform assumptions, "don't flag X because…") → this `SKILL.md` as a workflow rule. If these grow past ~15 lines, spin out `references/conventions.md` and link it from Quick start.
3. **Architecture-level statements** (attacker model, boundary→control mapping) → `docs/security/security-architecture.md` via the `security-architecture` skill.
4. **Risk acceptance** → never in the report or the skill. Accept or fix via tickets/PRs.

## Re-runs

- Regenerate the whole report every run — no carry-over, no row preservation, no diffability requirements. The filename's date disambiguates runs; the header's commit anchors the analyzed code.
- A gap fixed since the last run simply appears as `✅ Mitigated` (or disappears) in the new report.

## Verification

After writing the report:

1. Every finding cites real `file:line` evidence read during this run — spot-check 3 `✅ Mitigated` rows against the cited code.
2. Re-run immediately and confirm idempotent output (same findings, modulo the new date/filename).
3. Confirm the report is gitignored: `git check-ignore docs/security/local/<file>` must succeed, and `git status` must not list it.
