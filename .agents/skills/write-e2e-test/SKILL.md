---
name: write-e2e-test
description: Write Playwright/Electron e2e tests using @anaconda/playwright-utils. Use when adding e2e coverage, writing smoke specs, creating page objects, or debugging e2e failures.
---

# Write E2E Tests

Electron e2e tests live in the root `e2e/` workspace package (`@kilo-desktop/e2e`), powered by Playwright and `@anaconda/playwright-utils`.

## Tier selection

| Need                               | Tier                                | Where                      |
| ---------------------------------- | ----------------------------------- | -------------------------- |
| Pure logic                         | Unit `*.test.ts`                    | Co-located                 |
| Real files / processes / kernel    | Integration `*.integration.test.ts` | Co-located                 |
| One component in a test kernel     | Component `*.browser.test.tsx`      | Co-located in the plugin   |
| Kernel boot + bundled plugins      | App-level `*.app.test.tsx`          | `apps/web/src/kernel/`     |
| Packaged Electron / IPC / protocol | E2E `@smoke` / full                 | `e2e/` or `plugins/*/e2e/` |

**If it does not need Electron IPC or the packaged binary, it belongs in a Vitest browser test — not e2e.**
Do not re-smoke the same CRUD journey in app-level and e2e.
For Vitest tiers and fakes, see `.agents/skills/write-vitest/SKILL.md`.

## Three-file POM pattern

Every e2e flow uses a **page object**, a **per-feature fixture**, and a **spec**. Specs only call page-object methods — no raw `fill` / `click` / `expect` in specs.

### Page object

```typescript
// e2e/pages/<area>/my-page.ts  (or plugins/<id>/e2e/pages/my-page.ts)
import {
	click,
	expectElementToBeVisible,
	fill,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";

export class MyPage {
	private readonly input = () => getLocatorByTestId("my-input");
	private readonly submit = () => getLocatorByTestId("my-submit");

	async submitValue(value: string): Promise<void> {
		await fill(this.input(), value);
		await click(this.submit());
	}

	async verifyLoaded(): Promise<void> {
		await expectElementToBeVisible(this.input(), "My page input should be visible");
	}
}
```

### Fixture

`e2e/fixtures/shell.ts` is Electron + `appShellPage` (kilo.shell's frame) only. Feature page objects extend it (kilo.shell's own features in `e2e/fixtures/shell/<feature>.ts`):

```typescript
// e2e/fixtures/<area>/<feature>.ts  (or plugins/<id>/e2e/fixtures.ts)
import { test as shellTest } from "../shell.js";
import { MyPage } from "../../pages/<area>/my-page.js";

export const test = shellTest.extend<{ myPage: MyPage }>({
	// Playwright requires `{}` destructuring; oxlint-disable no-empty-pattern when unused.
	myPage: async ({}, use) => {
		await use(new MyPage());
	},
});
export const { expect } = test;
```

### Spec

```typescript
import { test } from "../../fixtures/<area>/<feature>.js";

test.describe("My feature @smoke", () => {
	test("submits a value", async ({ appShellPage, myPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await myPage.submitValue("hello");
		await myPage.verifyLoaded();
	});
});
```

## Rules

- **Always use `@anaconda/playwright-utils` functions** — never raw Playwright (`page.click()`, `page.fill()`, `expect(locator)`).
- **Import `test` from the feature fixture** — never from `@playwright/test`.
- **Every assertion needs a descriptive message** as the last argument.
- **Use `getLocatorByTestId()`** for `data-qa-id` — never raw CSS `[data-qa-id="..."]`.
- **Never use `.nth()`, `.first()`, `.last()`** — disambiguate with ancestor scoping.
- **No `console.log`** — use `logger` from `@anaconda/playwright-utils` in page objects only.
- **Tag smoke specs with `@smoke`** so they run on every PR. A PR also runs the full specs of the areas it changes (`e2e/scripts/select-pr-e2e.ts`); add a `RELATED_SPECS` entry when a plugin is exercised by specs outside `plugins/<id>/e2e/`.
- **Default to the shared worker Electron app** via `shell.ts`.
- **Set a fixture's isolation key in `extend`, never with a module-level `test.use()`** — `shellTest.extend({ appIsolationKey: "my-feature", ... })`. A `test.use()` in a fixture module binds to whichever spec loads it first and causes Playwright's "inconsistent test.use() options" flake. Call `test.use({ appIsolationKey })` only in a spec, and only for a key that differs from its fixture's default (repeating the default splits the pool into a second app).
- **Go through the UI, not main's state.** `readMainSnapshot` / `waitForDomainObjectState` (`kernel:hydrate`) make main forget what the window implements; use them only for state with no UI, last, in a worker of its own. `callDomainObject` is fine for setup (resetting state a test changed).
- **Packaged e2e skips first-run onboarding** (`KILO_SKIP_ONBOARDING=1`, which also treats kilo.core's terms as accepted). A spec that walks onboarding launches with `SHOW_ONBOARDING_LAUNCH_ENV` (`e2e/testdata/onboarding.ts`) in its fixture.
- **Wait for an area's settled state, not its first element.** When a page can show a loading skeleton or an error, wait for loading to finish with a timeout above the product's own request bound, and fail with the page's error text.
- **Do not add a plugin-local `@anaconda/playwright-utils` version** that differs from `e2e/package.json` — a second copy has an unset page singleton. Global setup fails fast if a plugin resolves a different copy.
- **Keep specs off the public internet.** Launch envs point Kilo at a local gateway stub and give every profile its own XDG directories; extend `e2e/utils/kilo-gateway-stub.ts` rather than letting a spec depend on a live endpoint.

## Locator priority

1. `data-qa-id` → `getLocatorByTestId()`
2. Role / label / text (`getLocatorByRole`, `getLocatorByLabel`, `getLocatorByText`) — when no stable test id
3. Structural CSS/XPath — last resort

## Commands

```bash
pnpm test:e2e:smoke                         # @smoke only (runs package:e2e first)
pnpm test:e2e                               # full suite
pnpm --filter @kilo-desktop/desktop run package:e2e
SKIP_BUILD=true pnpm test:e2e:smoke         # reuse that package
pnpm --filter @kilo-desktop/e2e run test:e2e:headed
```

## Fixture modes

| API                     | Scope                 | Use when                 |
| ----------------------- | --------------------- | ------------------------ |
| `e2e/fixtures/shell.ts` | Shared app per worker | Default happy-path flows |
