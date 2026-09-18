---
name: write-vitest
description: >-
  Choose the right Vitest tier and write unit, integration, browser, and
  app-level tests with createFakeSdk / createFakeFeatureSystem /
  createBrowserLocalApi. Use when adding Vitest coverage, deciding unit vs
  browser vs e2e, fixing coverage gates, or writing feature component tests.
  For packaged Electron / Playwright, use write-e2e-test instead.
---

# Write Vitest Tests

Canonical taxonomy: [docs/TESTING.md](../../../docs/TESTING.md). This skill covers
**Vitest only**. Packaged Electron / Playwright → `.agents/skills/write-e2e-test/SKILL.md`.

## Tier selection

| Need                                      | Tier         | Pattern / location                                   |
| ----------------------------------------- | ------------ | ---------------------------------------------------- |
| Pure logic, no I/O                        | Unit         | Co-located `*.test.ts`                               |
| Real SQLite / FeatureRouter / migrations  | Integration  | Co-located `*.integration.test.ts` (desktop, serial) |
| One view/hook + fake SDK or LocalApi      | Component    | Co-located `*.browser.test.tsx` (web, Chromium)      |
| Router + providers composition            | App-level    | `apps/web/src/app/*.app.test.tsx`                    |
| Packaged Electron / IPC / custom protocol | E2E          | **Stop — use `write-e2e-test`**                       |

**Prefer Vitest over e2e** unless the assertion needs the packaged binary, IPC bridge, or custom protocol. Do not re-smoke the same CRUD journey in app-level and e2e.

## Fakes (use these — never hand-roll)

| Helper                    | Package / module                    | Use for                                     |
| ------------------------- | ----------------------------------- | ------------------------------------------- |
| `createFakeSdk`           | `@kilo-desktop/testing` | Feature renderer SDK (`sdk.client`, events) |
| `createFakeMainSdk`       | `@kilo-desktop/testing` | `mainRegister` / channel handlers           |
| `createFakeFeatureSystem` | `@kilo-desktop/testing` | Mount views under `<SdkProvider>`           |
| `createBrowserLocalApi`   | `@/platform/browserLocalApi`        | Shell LocalApi (todos/theme); optional seed |
| `createFeatureSystem`     | `@/platform/sdk`                    | App-level boots with real feature list      |

```typescript
// Component under SdkProvider — do not hand-build FeatureSystem literals
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

const sdk = createFakeSdk({ featureId: "my-feature", channels: myChannels, handlers });
const system = createFakeFeatureSystem({ sdks: { "my-feature": sdk } });
```

```typescript
// LocalApi-backed UI — override slices via seed or spread, not a full fake object
import { createBrowserLocalApi } from "@/platform/browserLocalApi";

const api = createBrowserLocalApi({
	todos: [{ id: "1", title: "seeded", completed: false }],
});
// or: { ...createBrowserLocalApi(), theme: { get: async () => "dark", ... } }
```

**Never** construct ad-hoc `LocalApi` objects in feature tests. **Never** add feature methods to `LocalApi`.

## Patterns by tier

### Unit (`*.test.ts`)

- Co-locate next to the module under test.
- Node environment; no DOM.
- Desktop services, contracts, feature-sdk modules, pure hooks (when DOM-free).

### Integration (`*.integration.test.ts`)

- Real SQLite via `createDatabase` + migrations folder.
- **Close the DB before deleting temp dirs** (Windows `EBUSY`):

```typescript
afterEach(() => {
	for (const db of databases.splice(0)) {
		db.$client.close();
	}
	for (const directory of directories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});
```

- Close before reopening the same DB path on Windows.

### Component (`*.browser.test.tsx`)

- Vitest browser + Testing Library; `page.elementLocator(baseElement)`.
- Interactive elements need stable `data-qa-id` (Playwright/Vitest `testIdAttribute`).
- Prefer `getByTestId` / roles over brittle CSS.
- Use `createFakeSdk` + `createFakeFeatureSystem` for SDK views; `createBrowserLocalApi` for shell LocalApi views.
- `QueryClient` in tests: `{ defaultOptions: { queries: { retry: false } } }`.

### App-level (`*.app.test.tsx`)

- Mount `AppProviders` with `createBrowserLocalApi` + `createFeatureSystem(localApi, WEB_FEATURES)`.
- Assert shell boot and route composition only — **not** full feature CRUD.

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
pnpm --filter @kilo-desktop/feature-sdk test
pnpm --filter @kilo-desktop/testing test
```

## Feature checklist (Vitest slice)

Every new feature must also satisfy e2e obligations in `write-e2e-test` / `docs/TESTING.md`.

- [ ] Service / logic unit test (`*.test.ts`)
- [ ] Integration test if the feature persists data (`*.integration.test.ts`)
- [ ] Component browser test with `createFakeSdk` / `createBrowserLocalApi`
- [ ] Stable `data-qa-id` on interactive elements
- [ ] Coverage still passes `pnpm coverage`
