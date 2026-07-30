---
name: write-e2e-test
description: Write Playwright/Electron e2e tests using @anaconda/playwright-utils. Use when adding e2e coverage, writing smoke specs, creating page objects, or debugging e2e failures.
---

# Write E2E Tests

Electron e2e tests live in the root `e2e/` workspace package (`@anaconda-agentic-desktop/e2e`), powered by Playwright and `@anaconda/playwright-utils`.

## Tier selection

| Need                               | Tier                                | Where                      |
| ---------------------------------- | ----------------------------------- | -------------------------- |
| Pure logic                         | Unit `*.test.ts`                    | Co-located                 |
| Real SQLite / FeatureRouter        | Integration `*.integration.test.ts` | Co-located in desktop      |
| One component + `createFakeSdk`    | Component `*.browser.test.tsx`      | Co-located in web          |
| Router + providers                 | App-level `*.app.test.tsx`          | `apps/web/src/app/`        |
| Packaged Electron / IPC / protocol | E2E `@smoke` / full                 | `e2e/` or `plugins/*/e2e/` |

**If it does not need Electron IPC or the packaged binary, it belongs in a Vitest browser test — not e2e.**
Do not re-smoke the same CRUD journey in app-level and e2e.

## Three-file POM pattern

Every e2e flow uses a **page object**, a **per-feature fixture**, and a **spec**. Specs only call page-object methods — no raw `fill` / `click` / `expect` in specs.

### Page object

```typescript
// e2e/pages/features/<id>/my-page.ts
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

`e2e/fixtures/shell.ts` is Electron + `appShellPage` only. Feature page objects extend it:

```typescript
// e2e/fixtures/features/<id>.ts  (or plugins/<id>/e2e/fixtures.ts)
import { test as shellTest } from "../shell.js";
import { MyPage } from "../../pages/features/<id>/my-page.js";

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
import { test } from "../../../fixtures/features/<id>.js";

test.describe("My feature @smoke", () => {
	test("submits a value", async ({ appShellPage, myPage }) => {
		await appShellPage.navigateToFeature("my-feature");
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
- **Tag smoke specs with `@smoke`** so they run on every PR.
- **Default to the shared worker Electron app** via `shell.ts`.

## Locator priority

1. `data-qa-id` → `getLocatorByTestId()`
2. Role / label / text (`getLocatorByRole`, `getLocatorByLabel`, `getLocatorByText`) — when no stable test id
3. Structural CSS/XPath — last resort

## Commands

```bash
pnpm test:e2e:smoke                         # @smoke only (runs package:e2e first)
pnpm test:e2e                               # full suite
pnpm --filter @anaconda-agentic-desktop/desktop run package:e2e
SKIP_BUILD=true pnpm test:e2e:smoke         # reuse that package
pnpm --filter @anaconda-agentic-desktop/e2e run test:e2e:headed
```

## Fixture modes

| API                     | Scope                 | Use when                 |
| ----------------------- | --------------------- | ------------------------ |
| `e2e/fixtures/shell.ts` | Shared app per worker | Default happy-path flows |
