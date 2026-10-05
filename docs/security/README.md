# Security

This directory holds Kilo Desktop's security documentation. Two skills
(`.agents/skills/`) produce and maintain it, sharing one boundary register and
one sync procedure:

| Artifact                       | Path                                             | Committed           | Produced by                         |
| ------------------------------ | ------------------------------------------------ | ------------------- | ----------------------------------- |
| Security architecture overview | `docs/security/security-architecture.md`         | yes                 | `security-architecture` skill       |
| Threat-model scan report       | `docs/security/local/threat-model-YYYY-MM-DD.md` | **no** (gitignored) | `threat-model` skill                |
| Boundary register              | `docs/security/boundary-register.md`             | yes                 | register sync (both skills) + PRs   |
| Register sync procedure        | `docs/security/register-sync.md`                 | yes                 | hand-maintained; run by both skills |

## How to refresh

Run the skills in this order:

1. **`security-architecture`** — syncs the register against the code, then
   refreshes the overview (bumps `Last reviewed` + Version history).
2. **`threat-model`** — syncs the register again (should be a no-op), reads the
   attacker model from the refreshed overview, and writes a new dated scan
   report to `docs/security/local/`.

Why this order: both skills sync the register first, so neither depends on the
other having run. The scan reads its attacker model from the overview, so
refreshing the overview first means the scan uses the current statement. If the
scan's sync does change the register, its Run notes say so — re-run
`security-architecture` afterwards.

When to run:

| Trigger                                                                                                     | Run                                     |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Quarterly review                                                                                            | both, in order                          |
| PR adds or moves a trust boundary (new plugin sidecar, network listener, credential store, custom protocol) | add a register row; then both, in order |
| Pre-release / ad-hoc security review                                                                        | `threat-model` only                     |

## Security architecture overview (durable)

The customer/due-diligence-facing description of the app's security
architecture: topology, trust boundaries, attacker model, identity model, data
flows, controls, integrations. It is deliberately free of `file:line`
references and internal operational detail so it stays valid as code moves.

## Threat-model scan (point-in-time, never committed)

The scan walks the 7-section STRIDE+Privacy template against the boundary
register and writes a dated report to `docs/security/local/` (gitignored —
the report lists open gaps in detail and must not land in the public repo).
The operator is responsible for storing or sharing reports outside the repo.

Reports are fully regenerated each run: staleness is declared in the header
(date + analyzed commit), not maintained by editing rows. There is no
"Accepted" status — risk acceptance is tracked in tickets/PRs, so an accepted
risk simply reappears as a gap on each run.

Model recommendation for scans: run the skill on a strong reasoning model —
Claude Opus 5 (`high`, or `max` for release-time passes) as primary, Claude
Opus 4.8 or GPT-5.6 (`xhigh`) as an adversarial cross-check. Avoid small/fast
models for the section walk.

## Boundary register (agent-facing index)

`boundary-register.md` maps trust boundaries → files → candidate threats. It
feeds both skills and is kept current by `register-sync.md`. Two maintenance
rules: PRs that add a trust boundary add a row, and the register cites files
only — never `file:line`.
