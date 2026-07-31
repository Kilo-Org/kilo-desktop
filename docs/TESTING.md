# Testing

## Tiers

| Tier        | Pattern                 | Runner                         | Trigger                             |
| ----------- | ----------------------- | ------------------------------ | ----------------------------------- |
| Unit        | `*.test.ts`             | Vitest node                    | Every PR (ubuntu / windows / macos) |
| Integration | `*.integration.test.ts` | Vitest node, serial            | Every PR                            |
| Component   | `*.browser.test.tsx`    | Vitest Chromium                | Every PR                            |
| App-level   | `*.app.test.tsx`        | Vitest Chromium                | Every PR (composition / routing)    |
| E2E smoke   | `@smoke` specs          | Playwright + packaged Electron | Every PR (Windows)                  |
| E2E full    | all specs               | Playwright + packaged Electron | Nightly matrix + merge queue        |

Coverage gate: **90%** lines / branches / functions / statements via the shared preset in `vitest.coverage.shared.mjs`. Call sites may add a short, intentional `extraExclude` list (generated files, vendor UI, Electron entrypoints covered by e2e).

App-level tests cover router + provider composition. Feature CRUD belongs in browser component tests and e2e (protocol / IPC / packaging).

## How to run

```bash
# All Vitest tiers (unit + integration + browser)
pnpm test

# Coverage (enforces the 90% gate)
pnpm coverage

# E2E smoke against a packaged Electron app (uses package:e2e)
pnpm test:e2e:smoke

# Full e2e suite
pnpm test:e2e

# Package once for Playwright, then reuse
pnpm --filter @anaconda-agentic-desktop/desktop run package:e2e
SKIP_BUILD=true pnpm test:e2e:smoke

# Headed e2e for debugging
pnpm --filter @anaconda-agentic-desktop/e2e run test:e2e:headed
```

`package:e2e` sets `ELECTRON_ENABLE_INSPECT=true` so the Electron fuse
`EnableNodeCliInspectArguments` stays on. Playwright's `electron.launch` waits for
Node's `Debugger listening on` line; without that fuse the suite hangs after packaging.
Never package with plain `pnpm package` for e2e — CI uses `package:e2e` via `.github/actions/run-e2e`.

Package-scoped:

```bash
pnpm test:web
pnpm test:desktop
pnpm test:contracts
pnpm --filter @anaconda-agentic-desktop/feature-sdk test
```

## Layout

```
apps/desktop/src/**/*.test.ts              # unit
apps/desktop/src/**/*.integration.test.ts  # integration (SQLite, FeatureRouter)
apps/web/src/**/*.browser.test.tsx         # component (createFakeSdk / createBrowserLocalApi)
apps/web/src/app/*.app.test.tsx            # app-level (router + providers)
e2e/                                       # Playwright/Electron harness
  fixtures/shell.ts                        # Electron + appShellPage only
  fixtures/features/<id>.ts                # per-feature page fixtures
  fixtures/electron.ts                     # worker-scoped packaged Electron
  pages/shell/                             # shell page objects
  pages/features/<id>/                     # feature page objects (move with plugin)
  specs/shell/                             # boot / protocol / preload
  specs/features/<id>/                     # feature flows
plugins/<id>/e2e/                          # after migration — self-contained e2e
```

## Debugging a failing e2e

1. Re-run headed: `pnpm --filter @anaconda-agentic-desktop/e2e run test:e2e:headed -- --grep "test title"`.
2. On failure, Playwright attaches **screenshot**, **page HTML**, and **console logs** (Electron does not get Playwright's built-in attachments).
3. Open `playwright-report/index.html` (`npx playwright show-report`).
4. Traces are retained on failure (`trace: "retain-on-failure"`).
5. CI retries twice; flaky specs must be fixed (no quarantine tag).

## Feature test obligations

Every new feature (see `.agents/skills/new-feature/SKILL.md`) must ship:

1. A service unit test
2. A component browser test using `createFakeSdk`
3. Stable `data-qa-id` attributes on interactive elements
4. At least one `@smoke` e2e spec with a page object

Agent skills: Vitest tiers → `.agents/skills/write-vitest/SKILL.md`; Playwright e2e → `.agents/skills/write-e2e-test/SKILL.md`.

When migrating to a plugin (`.agents/skills/migrate-to-plugin/SKILL.md`), move e2e pages + specs into `plugins/<id>/e2e/` and add a plugin-local `fixtures.ts`. The Playwright config already globs `plugins/*/e2e/specs/**`.
