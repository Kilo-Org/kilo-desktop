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

Project skills live under [`.agents/skills/`](./.agents/skills/).

| Skill               | Path                                        | Use when                                                                                   |
| ------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `new-feature`       | `.agents/skills/new-feature/SKILL.md`       | Creating a new feature (scaffolds main handlers, renderer, contracts, tests, registration) |
| `migrate-to-plugin` | `.agents/skills/migrate-to-plugin/SKILL.md` | Moving an existing feature into `plugins/<id>/` as a self-contained plugin                 |
| `write-vitest`      | `.agents/skills/write-vitest/SKILL.md`      | Choosing Vitest tiers and writing unit / integration / browser / app-level tests           |
| `write-e2e-test`    | `.agents/skills/write-e2e-test/SKILL.md`    | Writing Playwright/Electron e2e page objects, fixtures, and `@smoke` specs                 |

## Key rules for AI agents

1. **Read CONTEXT.md first** — it defines what imports are allowed, how features communicate, and what patterns to follow.
2. **Never add feature methods to `LocalApi`** — use `sdk.invoke` via the feature-sdk shim.
3. **Never import across features** — cross-feature = `sdk.events` / `sdk.plugins.get` / `sdk.state.get`.
4. **Every feature registers in the FEATURES array** — never hand-edit `Application.ts`.
5. **Tests use `createFakeSdk` / `createFakeFeatureSystem` / `createBrowserLocalApi`** — never hand-roll fake `LocalApi` or `FeatureSystem` objects in feature tests. See `.agents/skills/write-vitest/SKILL.md`.
6. **Every feature ships at least one `@smoke` e2e spec** — see `docs/TESTING.md` and `.agents/skills/write-e2e-test/SKILL.md`.
7. **Use oxlint + oxfmt** — not ESLint/Prettier. Run `pnpm lint` and `pnpm format`.
8. **Prefer Vitest over e2e** when Electron IPC / the packaged binary is not required — see `.agents/skills/write-vitest/SKILL.md`.
9. **Strive for self-documenting code** — clear names and small functions over comments. Add comments only for what code cannot express: non-obvious rationale, surprising edge cases, or otherwise ambiguous intent. Do not narrate what the code plainly does.
