---
name: write-vitest
description: >-
  Choose the right Vitest tier and write unit, integration, browser, and
  app-level tests that boot real kernels (createTestKernelPair /
  createTestHost, renderShell). Use when adding Vitest coverage, deciding unit
  vs browser vs e2e, fixing coverage gates, or writing plugin component tests.
  For packaged Electron / Playwright, use write-e2e-test instead.
---

# Write Vitest Tests

Canonical taxonomy: [docs/TESTING.md](../../../docs/TESTING.md). This skill covers
**Vitest only**. Packaged Electron / Playwright → `.agents/skills/write-e2e-test/SKILL.md`.

## Tier selection

| Need                                      | Tier         | Pattern / location                                   |
| ----------------------------------------- | ------------ | ---------------------------------------------------- |
| Pure logic, no I/O                        | Unit         | Co-located `*.test.ts`                               |
| Real files / processes / a booted kernel  | Integration  | Co-located `*.integration.test.ts` (node, serial)    |
| One view/hook in a booted test kernel     | Component    | Co-located `*.browser.test.tsx` (Chromium)           |
| Kernel boot + bundled plugins             | App-level    | `apps/web/src/kernel/*.app.test.tsx`                 |
| Packaged Electron / IPC / custom protocol | E2E          | **Stop — use `write-e2e-test`**                       |

**Prefer Vitest over e2e** unless the assertion needs the packaged binary, IPC bridge, or custom protocol. Do not re-smoke the same CRUD journey in app-level and e2e.

## Kernel test helpers (use these — never hand-roll a kernel or sdk)

| Helper                 | Package / module                           | Use for                                                  |
| ---------------------- | ------------------------------------------ | -------------------------------------------------------- |
| `createTestKernelPair` | `@kilo-desktop/kernel/testing`             | A main + window kernel pair with the plugins under test  |
| `createTestHost`       | `@kilo-desktop/kernel/testing`             | Main host primitives; override only what the test needs  |
| `createMemoryStorage`  | `@kilo-desktop/kernel/testing`             | In-memory plugin storage / kv                            |
| `createPluginHost`     | `@kilo-desktop/kernel/testing/plugin-host` | One plugin's contributions (`renderSlot`) and domain methods (`invoke`) without the owner's UI |
| `renderShell`          | `@kilo-desktop/plugin-shell/testing`       | Boot kilo.shell around a plugin that contributes to it   |
| `renderWorkSessions`   | `@kilo-desktop/plugin-work-sessions/testing` | Boot kilo.shell + kilo.work-sessions' window (fake main) around a plugin that contributes panes or work-session UI |

Plugin-specific guidance (faking dependencies, reliability rules,
removability): [docs/plugins/testing.md](../../../docs/plugins/testing.md).

Other plugins are reached through their `./contracts` (domain object and point
definitions); fakes of another plugin provide its domain object in the test
kernel and throw `KernelError`s, whose messages survive the process boundary.

## Patterns by tier

### Unit (`*.test.ts`)

- Co-locate next to the module under test.
- Node environment; no DOM.
- Desktop services, plugin main code, contracts, pure hooks (when DOM-free).

### Integration (`*.integration.test.ts`)

- Real files, git repositories or processes; a booted test kernel when the
  behavior spans plugins.
- **Close databases and handles before deleting temp dirs** (Windows `EBUSY`):

```typescript
afterEach(() => {
	for (const db of databases.splice(0)) {
		db.close();
	}
	for (const directory of directories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});
```

- Close before reopening the same DB path on Windows.

### Component (`*.browser.test.tsx`)

- Vitest browser + Testing Library; `page.elementLocator(baseElement)`.
- Interactive elements need stable `data-qa-id` (Playwright/Vitest `testIdAttribute`).
- Prefer `getByTestId` / roles over brittle CSS.
- Boot the plugin with `createTestKernelPair` / `createPluginHost` (or `renderShell` / `renderWorkSessions` when it contributes to kilo.shell / kilo.work-sessions).
- `QueryClient` in tests: `{ defaultOptions: { queries: { retry: false } } }`.

### App-level (`*.app.test.tsx`)

- Boot the web kernel with the bundled plugins (`apps/web/src/kernel/boot.app.test.tsx`).
- Assert boot and composition only — **not** full plugin journeys.

## Coverage

- Shared gate: `vitest.coverage.shared.mjs` — **80%** lines / branches / functions / statements.
- Extend via `createCoverageConfig([...extraExclude])` only for intentional gaps (generated files, entrypoints covered by e2e, test helpers).
- Exclude `**/test-helpers.ts` when it is fixture-only.
- Run: `pnpm coverage` (or package-scoped `pnpm --filter <pkg> coverage`).

## Commands

```bash
pnpm test                 # all Vitest tiers
pnpm coverage             # Vitest + 80% gate
pnpm test:web
pnpm test:desktop
pnpm --filter @kilo-desktop/kernel test
pnpm --filter @kilo-desktop/plugin-<dir> test
```

## Plugin checklist (Vitest slice)

Every new plugin must also satisfy e2e obligations in `write-e2e-test` / `docs/TESTING.md`.

- [ ] Service / logic unit test (`*.test.ts`)
- [ ] Integration test if the plugin persists data or runs processes (`*.integration.test.ts`)
- [ ] Component browser test in a booted test kernel
- [ ] Stable `data-qa-id` on interactive elements
- [ ] Coverage still passes `pnpm coverage`
