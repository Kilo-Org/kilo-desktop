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

Read [CONTEXT.md](./CONTEXT.md) for architecture, terminology, and conventions. Keep CONTEXT.md high-level when editing it: one line per package/plugin (purpose, not feature enumeration); feature detail lives in code comments and plugin docs.

## Running the app

Start the desktop app in dev with `pnpm dev` (→ `dev:desktop`)
from the workspace root. It boots the Vite web dev server on port 5173 first,
then launches Electron pointed at it via `KILO_WEB_DEV_SERVER_URL`. Do **not**
run `electron-forge start` (or the desktop package's `start` script) directly —
without the web dev server the renderer window loads empty.

## Local Skills

Project skills live under [`.agents/skills/`](./.agents/skills/).

| Skill            | Path                                     | Use when                                                                                                   |
| ---------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `write-plugin`   | `.agents/skills/write-plugin/SKILL.md`   | Building or extending a kernel plugin: manifest, contracts, entries, points, domains, tests (docs/plugins) |
| `write-vitest`   | `.agents/skills/write-vitest/SKILL.md`   | Choosing Vitest tiers and writing unit / integration / browser / app-level tests                           |
| `write-e2e-test` | `.agents/skills/write-e2e-test/SKILL.md` | Writing Playwright/Electron e2e page objects, fixtures, and `@smoke` specs                                 |
| `tdd`            | `.agents/skills/tdd/SKILL.md`            | New features, logic-heavy bug fixes, and refactors (not minor UI/cosmetic changes)                         |

## Key rules for AI agents

1. **Read CONTEXT.md first** — it defines what imports are allowed, how plugins communicate, and what patterns to follow; the design is [docs/plugin-architecture.md](./docs/plugin-architecture.md).
2. **Plugins talk through the kernel** — commands, domain objects and extension points declared in `plugin.json`; the host only provides `kernel/*` primitives. Never add product features to the host (`apps/*`).
3. **Never import across plugins** — another plugin is reached through the kernel only; its `./contracts` export (types, domain and point definitions) is the one allowed import (`pnpm lint` checks this).
4. **Every bundled plugin registers in `packages/bundled-plugins`** and the entry maps (`apps/desktop/src/main/kernel/plugins.ts`, `apps/web/src/kernel/plugins.ts`).
5. **Tests boot real kernels** — `@kilo-desktop/kernel/testing` (`createTestKernelPair`, `createTestHost`) and a host plugin's `./testing` fixture (e.g. `renderShell` from `@kilo-desktop/plugin-shell/testing`); never hand-roll fake kernels or sdks. See `.agents/skills/write-vitest/SKILL.md`.
6. **Every plugin ships at least one `@smoke` e2e spec** — see `docs/TESTING.md` and `.agents/skills/write-e2e-test/SKILL.md`.
7. **Use oxlint + oxfmt** — not ESLint/Prettier. Run `pnpm lint` and `pnpm format`.
8. **Prefer Vitest over e2e** when Electron IPC / the packaged binary is not required — see `.agents/skills/write-vitest/SKILL.md`.
9. **Strive for self-documenting code** — clear names and small functions over comments. Add comments only for what code cannot express: non-obvious rationale, surprising edge cases, or otherwise ambiguous intent. Do not narrate what the code plainly does.
10. **Stateful services carry a module-level design comment** — a class that owns a lifecycle or state machine (reconcilers, managers, stores) gets one block comment at the top explaining ownership, invariants, and the "why" of its design (see `LocalInferenceService.ts` in kilo.local-inference for the shape). Keep it current when behavior changes; it substitutes for the narration rule 9 forbids inline.
11. **Use TDD for substantial logic changes** — follow the `tdd` skill (`.agents/skills/tdd/SKILL.md`) for new features, logic-heavy bug fixes, and refactors. TDD is not required for minor/cosmetic UI changes (copy edits, class names, spacing, style tweaks) that introduce no new logic. Always fix broken tests regardless of change size. UI tests should verify behaviors, not cosmetic details. Coverage target is 80% — do not add tests solely to inflate coverage.
12. **Internal workspace deps always use `workspace:*`** — never `link:` relative paths in package.json manifests. `link:` is reserved for the `overrides` section of `pnpm-workspace.yaml` (where `workspace:` is not supported). Never re-enable `injectWorkspacePackages` — packaging uses `pnpm deploy`, which no longer requires it, and injection silently replaces symlinks with stale hard-linked copies.
13. **Always think about extensibility** — every plugin is a potential host. When building or changing a plugin surface (composer, pane, session list, toolbar, settings…), ask what other plugins would naturally contribute to it and record candidate extension points in the extensibility map in [docs/plugin-architecture.md](./docs/plugin-architecture.md). Ship a plugin's own built-ins through its own extension points.
14. **Keep the security overview true** — a change that adds or moves a trust boundary (new sidecar or child process, local listener, credential store, custom scheme or embedded host, outbound service, update or signing change) refreshes the affected sections of [docs/security-architecture-overview.md](./docs/security-architecture-overview.md) by following the Maintainer agent update prompt embedded in that doc.
15. **Keep the plugin plan current** — while rebuilding on [docs/plugin-plan-v2.md](./docs/plugin-plan-v2.md), update its Progress table, the step's "What building step N settled" notes, Deferred decisions and Follow-ups in the same change as the work.
