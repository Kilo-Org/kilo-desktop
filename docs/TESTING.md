# Testing

## Tiers

| Tier        | Pattern                  | Runner                         | Trigger                             |
| ----------- | ------------------------ | ------------------------------ | ----------------------------------- |
| Unit        | `*.test.ts`              | Vitest node                    | Every PR (ubuntu / windows / macos) |
| Integration | `*.integration.test.ts`  | Vitest node, serial            | Every PR                            |
| Component   | `*.browser.test.tsx`     | Vitest Chromium                | Every PR                            |
| App-level   | `*.app.test.tsx`         | Vitest Chromium                | Every PR (composition / routing)    |
| E2E smoke   | `@smoke` + changed areas | Playwright + packaged Electron | Every PR (Windows)                  |
| E2E full    | all specs                | Playwright + packaged Electron | Nightly matrix + merge queue        |

Coverage gate: **80%** lines / branches / functions / statements via the shared preset in `vitest.coverage.shared.mjs`. Call sites may add a short, intentional `extraExclude` list (generated files, vendor UI, Electron entrypoints covered by e2e).

App-level tests cover router + provider composition. Feature CRUD belongs in browser component tests and e2e (protocol / IPC / packaging).

PR E2E runs `@smoke` on Windows plus the full specs of every area the PR
touches (`e2e/scripts/select-pr-e2e.ts`): a change under `plugins/<id>/` runs
`plugins/<id>/e2e/**`, a few plugins map to specs elsewhere (Kilo server →
kilo-ui), and harness changes run everything. The merge queue and nightly run
the full suite on their platform matrices; every E2E test launches an
OS-matched packaged application.

Playwright runs two workers (`E2E_WORKERS` overrides; set `1` to serialize
while debugging). Each worker owns its app and profile and stops only its own
process tree; orphaned app instances are swept once in global setup and
teardown. The macOS merge-queue leg is additionally split into two shards
(`E2E_SHARD=current/total`), and `e2e-merge-report` merges their blob reports
into one HTML report. E2E jobs do not download a Playwright browser — specs use
`_electron.launch`; Linux only installs Chromium's system libraries for Electron.

E2E apps are hermetic. Each worker's profile owns its own XDG data, cache,
config, and state directories, so Kilo CLI sessions, databases, and cache locks
never cross workers (or reach a developer's real Kilo data). Provider loading
does not touch the public internet: models.dev fetches are disabled, and
`KILO_API_URL` points at a local Kilo Gateway stub that global setup starts
with a one-time snapshot of the gateway model catalog. npm runs offline with an
empty per-profile cache, so the CLI's first-start install of `@kilocode/plugin`
into Desktop's config directory (62 MB, blocking instance bootstrap) fails fast;
Desktop's managed plugins are dependency-free. `KILO_TEST_HOME` isolates the
CLI's `~/.kilo` / `~/.kilocode` lookups, and `KILO_LOG_LEVEL=DEBUG` makes the
attached `kilo-cli.log` record bootstrap steps. Global setup also pre-warms the
packaged Kilo CLI once so first-execution costs stay outside the sidecar's
startup window.

## How to run

```bash
# All Vitest tiers (unit + integration + browser)
pnpm test

# Coverage (enforces the 80% gate)
pnpm coverage

# E2E smoke against a packaged Electron app (uses package:e2e)
pnpm test:e2e:smoke

# Full e2e suite
pnpm test:e2e

# Package once for Playwright, then reuse
pnpm --filter @kilo-desktop/desktop run package:e2e
SKIP_BUILD=true pnpm test:e2e:smoke

# Headed e2e for debugging
pnpm --filter @kilo-desktop/e2e run test:e2e:headed
```

`package:e2e` sets `ELECTRON_ENABLE_INSPECT=true` so the Electron fuse
`EnableNodeCliInspectArguments` stays on. Playwright's `electron.launch` waits for
Node's `Debugger listening on` line; without that fuse the suite hangs after packaging.
Never package with plain `pnpm package` for e2e. CI packages with `package:e2e`
and then runs Playwright as separately named steps in the same OS-specific job.

Package-scoped:

```bash
pnpm test:web
pnpm test:desktop
pnpm test:contracts
pnpm --filter @kilo-desktop/feature-sdk test
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

1. Re-run headed: `pnpm --filter @kilo-desktop/e2e run test:e2e:headed -- --grep "test title"`.
2. On a failed or timed-out attempt the fixture attaches **screenshot**, **page HTML**, **console logs** (renderer), **main-process.log** (Electron main stdout/stderr for that test, including sidecar lifecycle), **kilo-cli.log** (the profile's Kilo CLI log), and **electron-trace** (a Playwright trace of the app window with DOM snapshots and a screencast). Playwright's own `trace` option only records its browser fixtures, so its trace for Electron specs holds test steps only.
3. When the worker app itself fails to start (for example the Kilo server never reports a listening URL), there is no test to attach files to yet: the error message carries the tail of the main-process output and Kilo CLI log instead, so it appears directly in the CI log.
4. Open `playwright-report/index.html` (`npx playwright show-report`). CI also uploads JUnit XML and a Playwright blob report for machine-readable diagnostics.
5. CI retries twice. PR and merge-queue checks tolerate a retry pass, while nightly sets `PLAYWRIGHT_FAIL_ON_FLAKY_TESTS=true` and fails on any flaky result. Flaky specs must still be fixed (no quarantine tag).

## Feature test obligations

Every new feature (see `.agents/skills/new-feature/SKILL.md`) must ship:

1. A service unit test
2. A component browser test using `createFakeSdk`
3. Stable `data-qa-id` attributes on interactive elements
4. At least one `@smoke` e2e spec with a page object

Agent skills: Vitest tiers → `.agents/skills/write-vitest/SKILL.md`; Playwright e2e → `.agents/skills/write-e2e-test/SKILL.md`.

When migrating to a plugin (`.agents/skills/migrate-to-plugin/SKILL.md`), move e2e pages + specs into `plugins/<id>/e2e/` and add a plugin-local `fixtures.ts`. The Playwright config already globs `plugins/*/e2e/specs/**`.

Plugin e2e code must load the **same** `@anaconda/playwright-utils` and `@playwright/test` as `e2e/`: playwright-utils keeps the current page in a module singleton that only the harness fixture sets. If a plugin declares these packages, pin them to the versions in `e2e/package.json`. Global setup checks this and fails fast; a second copy otherwise makes every locator in that plugin throw `Cannot read properties of undefined (reading 'getByTestId')`.
