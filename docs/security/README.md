# Security

## Threat model

The threat model is maintained by running the threat-model skill and committing the output:

1. Run the threat-model skill (`.agents/skills/threat-model/SKILL.md`).
2. The skill walks the 7-section STRIDE+Privacy template against the repo's trust
   boundaries and writes `docs/security/threat-model.md`.
3. The pull request review and merge act as sign-off.
   `docs/security/threat-model.md` is the source of truth.

Model recommendation: run the skill on a strong reasoning model — Claude Opus
5 (`high`, or `max` for release-time passes) as primary, Claude Opus 4.8 or
GPT-5.6 (`xhigh`) as an adversarial cross-check. Avoid small/fast models for
the section walk.

When a PR adds a trust boundary (new plugin sidecar, network listener,
credential store, file IPC), consider adding a row to
`.agents/skills/threat-model/references/architecture.md` so the next run picks
it up.
