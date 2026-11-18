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

App-level tests cover the kernel boot with the bundled plugins. Plugin journeys belong in browser component tests (in a booted test kernel) and e2e (protocol / IPC / packaging).

PR E2E runs `@smoke` on Windows plus the full specs of every area the PR
touches (`e2e/scripts/select-pr-e2e.ts`): a change under `plugins/<id>/` runs
`plugins/<id>/e2e/**`, plugins map to their specs under `e2e/specs/<area>`
(kilo.core and kilo.shell run each other's too), and changes to the e2e harness, `packages/kernel`,
`packages/bundled-plugins`, `packages/ui` or `apps/` run everything. The merge queue and nightly run
the full suite on their platform matrices; every E2E test launches an
OS-matched packaged application.

Playwright runs two workers (`E2E_WORKERS` overrides; set `1` to serialize
while debugging). Each worker owns its app and profile and stops only its own
process tree; orphaned app instances are swept once in global setup and
teardown. The macOS merge-queue leg is additionally split into two shards
(`E2E_SHARD=current/total`), and `e2e-merge-report` merges their blob reports
into one HTML report. E2E jobs do not download a Playwright browser — specs use
`_electron.launch`; Linux only installs Chromium's system libraries for Electron.

Specs that need their own app share a worker by `appIsolationKey`. A feature
fixture sets its default key in `extend` (`shellTest.extend({ appIsolationKey:
"my-feature", ... })`); only spec files call `test.use()`, and only to choose a
different key. A `test.use()` in a shared fixture module binds to whichever spec
loads it first, so pools differ between processes and Playwright fails with
"inconsistent test.use() options".

E2E builds (`package:e2e`) report a fixed signed-in Kilo account
(`e2e@kilo.dev`, kilo.core's e2e identity; the Kilo CLI itself stays
signed out), read once the Kilo server is up — page objects that show it wait
for the server's cold start. Launches skip first-run onboarding and treat the
terms as accepted (`KILO_SKIP_ONBOARDING=1`); specs that walk onboarding launch
with `SHOW_ONBOARDING_LAUNCH_ENV` (`e2e/testdata/onboarding.ts`). A spec that needs a signed-out app runs those
tests in a `describe` with `test.use({ appLaunchEnv: SIGNED_OUT_LAUNCH_ENV })`
(from `e2e/testdata/account.ts`), which gives them their own worker app.

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

# Only tests that import a file changed since origin/main (full suites of
# affected packages when a manifest, lockfile, tsconfig or test config changed)
pnpm test:changed

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
pnpm --filter @kilo-desktop/kernel test
pnpm --filter @kilo-desktop/plugin-<dir> test
```

## Layout

```
{apps,packages,plugins}/**/*.test.ts      # unit
**/*.integration.test.ts                   # integration (real files, processes, kernels)
plugins/<dir>/src/**/*.browser.test.tsx    # component (booted test kernel / renderShell)
apps/web/src/kernel/*.app.test.tsx         # app-level (kernel boot + bundled plugins)
e2e/                                       # Playwright/Electron harness
  fixtures/shell.ts                        # Electron + appShellPage only
  fixtures/features/<id>.ts                # per-area page fixtures
  fixtures/electron.ts                     # worker-scoped packaged Electron
  pages/shell/                             # shell page objects
  pages/features/<id>/                     # area page objects
  specs/kernel/, specs/shell/              # boot / protocol / preload
  specs/features/<id>/                     # plugin flows (owners in utils/registered-specs.ts)
plugins/<dir>/e2e/                         # a plugin's own e2e
```

## Debugging a failing e2e

1. Re-run headed: `pnpm --filter @kilo-desktop/e2e run test:e2e:headed -- --grep "test title"`.
2. On a failed or timed-out attempt the fixture attaches **screenshot**, **page HTML**, **console logs** (renderer), **main-process.log** (Electron main stdout/stderr for that test, including sidecar lifecycle), **kilo-cli.log** (the profile's Kilo CLI log), and **electron-trace** (a Playwright trace of the app window with DOM snapshots and a screencast). Playwright's own `trace` option only records its browser fixtures, so its trace for Electron specs holds test steps only.
3. When the worker app itself fails to start (for example the Kilo server never reports a listening URL), there is no test to attach files to yet: the error message carries the tail of the main-process output and Kilo CLI log instead, so it appears directly in the CI log.
4. Open `playwright-report/index.html` (`npx playwright show-report`). CI also uploads JUnit XML and a Playwright blob report for machine-readable diagnostics.
5. CI retries twice. PR and merge-queue checks tolerate a retry pass, while nightly sets `PLAYWRIGHT_FAIL_ON_FLAKY_TESTS=true` and fails on any flaky result. Flaky specs must still be fixed (no quarantine tag).

## Plugin test obligations

Every new plugin must ship:

1. A unit test for its main-process logic
2. A component browser test in a booted test kernel (`@kilo-desktop/kernel/testing`)
3. Stable `data-qa-id` attributes on interactive elements
4. At least one `@smoke` e2e spec with a page object

Agent skills: Vitest tiers → `.agents/skills/write-vitest/SKILL.md`; Playwright e2e → `.agents/skills/write-e2e-test/SKILL.md`.

A plugin's e2e pages and specs may live in `plugins/<dir>/e2e/` with a plugin-local `fixtures.ts`; the Playwright config globs `plugins/*/e2e/specs/**`.

Plugin e2e code must load the **same** `@anaconda/playwright-utils` and `@playwright/test` as `e2e/`: playwright-utils keeps the current page in a module singleton that only the harness fixture sets. If a plugin declares these packages, pin them to the versions in `e2e/package.json`. Global setup checks this and fails fast; a second copy otherwise makes every locator in that plugin throw `Cannot read properties of undefined (reading 'getByTestId')`.
