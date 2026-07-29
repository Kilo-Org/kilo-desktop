<!-- intent-skills:start -->

## Skill Loading

Before editing files for a substantial task:

- Run `pnpm dlx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `pnpm dlx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.

<!-- intent-skills:end -->

## Context

Read [CONTEXT.md](./CONTEXT.md) for architecture, terminology, and conventions.

## Local Skills

| Skill               | Path                                | Use when                                                                                   |
| ------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `new-feature`       | `skills/new-feature/SKILL.md`       | Creating a new feature (scaffolds main handlers, renderer, contracts, tests, registration) |
| `migrate-to-plugin` | `skills/migrate-to-plugin/SKILL.md` | Moving an existing feature into `plugins/<id>/` as a self-contained plugin                 |

## Key rules for AI agents

1. **Read CONTEXT.md first** — it defines what imports are allowed, how features communicate, and what patterns to follow.
2. **Never add feature methods to `LocalApi`** — use `sdk.invoke` via the feature-sdk shim.
3. **Never import across features** — cross-feature = `sdk.events` / `sdk.plugins.get` / `sdk.state.get`.
4. **Every feature registers in the FEATURES array** — never hand-edit `Application.ts`.
5. **Tests use `createFakeSdk`** — never construct fake `LocalApi` objects in feature tests.
6. **Use oxlint + oxfmt** — not ESLint/Prettier. Run `pnpm lint` and `pnpm format`.
