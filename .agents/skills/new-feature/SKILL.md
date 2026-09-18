---
name: new-feature
description: Scaffold a new migration-ready feature using the SDK pattern. Creates main-side handlers, renderer components, contracts, test setup, and FEATURES array registration. Use when building a new feature, adding a new capability, or when user says "new feature", "add feature", or "create feature".
---

# New Feature (Plugin-Ready)

Scaffold a feature that programs against the SDK and is ready to migrate to a plugin later.

## Quick start

1. Pick a feature ID (kebab-case, e.g., `environments`)
2. Run through the checklist below to create all required files
3. Register in the FEATURES array
4. Verify with `pnpm check && pnpm test`

## Workflow

### Step 1: Create contracts (Zod schemas + channel map)

**File:** `packages/contracts/src/features/<id>.ts`

```typescript
import { z } from "zod";

import { defineMethod } from "../contract.js";

// Define your domain schemas
export const myEntitySchema = z.object({
	id: z.string(),
	name: z.string(),
	// ...
});
export type MyEntity = z.infer<typeof myEntitySchema>;

// Channel map — single source of truth for sdk.invoke / mainSdk.channels().handle.
// Built with defineMethod from contracts while the file lives here (same
// {input,output} shape). On plugin migration, move this file and switch to
// defineMethod from `@kilo-desktop/feature-sdk`.
export const myFeatureChannels = {
	list: defineMethod(z.undefined(), z.array(myEntitySchema)),
	create: defineMethod(z.object({ name: z.string().min(1).max(100) }), myEntitySchema),
} as const;
```

Export from `packages/contracts/src/index.ts`:

```typescript
export * from "./features/<id>.js";
```

### Step 2: Create main-side handlers

**File:** `apps/desktop/src/main/features/<id>/index.ts`

```typescript
import type { MainSdk } from "@kilo-desktop/feature-sdk/main";
import { FeatureError } from "@kilo-desktop/feature-sdk/main";
import { myFeatureChannels } from "@kilo-desktop/contracts";
import { MyService } from "./MyService.js";

export function mainRegister(mainSdk: MainSdk) {
	const service = new MyService(/* deps */);

	// Bind the channel map once; input + output validated at the routing boundary.
	// handleAll is exhaustive — every channel in the map must get a handler.
	mainSdk.channels(myFeatureChannels).handleAll({
		list: () => service.list(),
		create: (input) => service.create(input.name),

		// Expected failures: throw FeatureError so the message survives IPC.
		// get: (input) => {
		// 	const item = service.get(input.id);
		// 	if (!item) throw new FeatureError("Item not found.", "NOT_FOUND");
		// 	return item;
		// },
	});

	mainSdk.onDispose(() => {
		// Close DB connections, cleanup resources
	});
}
```

If the feature must also run in standalone browser mode, add a `browserRegister` and register the feature in `apps/web/src/features/features.ts`. Browser mode boots ONLY `browserRegister` (features without one are skipped): Node-free features reuse the same function (`browserRegister: mainRegister`); features using Node APIs (SQLite, fs) provide in-memory fakes.

**File:** `apps/desktop/src/main/features/<id>/MyService.ts` — business logic.

### Step 3: Register in FEATURES array

**File:** `apps/desktop/src/main/features/registry/features.ts`

```typescript
import type { FeatureRegistration } from "@kilo-desktop/feature-sdk";
import { mainRegister } from "../<id>/index.js";

export const FEATURES: readonly FeatureRegistration[] = [
	{ id: "<id>", mainRegister },
	// ...existing features
];
```

### Step 4: Create renderer code

**File:** `apps/web/src/features/<id>/use<Name>.ts` — query hooks

```typescript
import { queryOptions, mutationOptions, type QueryClient } from "@tanstack/react-query";
import type { TypedSDK } from "@kilo-desktop/feature-sdk";
import { myFeatureChannels } from "@kilo-desktop/contracts";

type MySdk = TypedSDK<typeof myFeatureChannels>;

export function listQueryOptions(sdk: MySdk) {
	return queryOptions({
		queryKey: ["<id>", "list"],
		queryFn: () => sdk.invoke("list"),
	});
}

export function createMutationOptions(sdk: MySdk, qc: QueryClient) {
	return mutationOptions({
		mutationFn: (name: string) => sdk.invoke("create", { name }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["<id>", "list"] }),
	});
}
```

**File:** `apps/web/src/features/<id>/<Name>View.tsx` — main component

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MyFeatureService } from "@kilo-desktop/contracts";
import { useSdk } from "@/platform/sdk";
import { listQueryOptions, createMutationOptions } from "./use<Name>";

export function <Name>View() {
  const { client } = useSdk<MyFeatureService>("<id>");
  const qc = useQueryClient();
  const items = useQuery(listQueryOptions(client));
  const create = useMutation(createMutationOptions(client, qc));
  // ...render
}
```

### Step 5: Create route

**File:** `apps/web/src/routes/features/<id>.tsx`

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { <Name>View } from "@/features/<id>/<Name>View";

export const Route = createFileRoute("/features/<id>")({
  component: <Name>View,
});
```

### Step 6: Write tests

Every feature ships tests at four tiers. Prefer the cheapest tier that can catch the bug.
See `.agents/skills/write-vitest/SKILL.md` (Vitest) and `.agents/skills/write-e2e-test/SKILL.md` (Playwright).

**1. Unit — service logic** (`apps/desktop/src/main/features/<id>/MyService.test.ts`)

- Test business logic directly (no IPC, no SDK)

**2. Integration (optional)** (`apps/desktop/src/main/features/<id>/MyService.integration.test.ts`)

- Real SQLite / drizzle / `FeatureRouter` against a temp dir. Use when the feature persists data.

**3. Component — browser** (`apps/web/src/features/<id>/<Name>View.browser.test.tsx`)

```tsx
import { createFakeSdk } from "@kilo-desktop/testing";
// Use createFakeSdk({
//   featureId: "<id>",
//   channels: myFeatureChannels,
//   handlers: { list: () => [...] },
// })
// to serve sdk.invoke calls through the fake's real in-memory router.
```

Interactive elements must carry stable `data-qa-id` attributes (queried by both Vitest browser tests and Playwright e2e via `testIdAttribute: "data-qa-id"`).

**4. E2E smoke** — page object + `@smoke` spec under `e2e/`

```
e2e/pages/features/<id>/<name>-page.ts
e2e/specs/features/<id>/<name>.spec.ts
```

Register the page object in `e2e/fixtures/features/<id>.ts` (extends shell). Tag the describe block with `@smoke` so it runs on every PR. See `.agents/skills/write-e2e-test/SKILL.md`.

### Step 7: Verify

```bash
pnpm check       # Types pass
pnpm test        # Unit + integration + browser tests
pnpm test:e2e:smoke  # Packaged Electron smoke (optional locally)
pnpm lint        # No warnings
```

## Checklist

- [ ] `packages/contracts/src/features/<id>.ts` — Zod schemas
- [ ] `packages/contracts/src/index.ts` — re-export added
- [ ] `apps/desktop/src/main/features/<id>/index.ts` — mainRegister
- [ ] `apps/desktop/src/main/features/<id>/MyService.ts` — service
- [ ] `apps/desktop/src/main/features/<id>/MyService.test.ts` — service unit test
- [ ] `apps/desktop/src/main/features/<id>/MyService.integration.test.ts` — if the feature persists data
- [ ] `apps/desktop/src/main/features/registry/features.ts` — array entry added
- [ ] `apps/web/src/features/<id>/use<Name>.ts` — query/mutation hooks
- [ ] `apps/web/src/features/<id>/<Name>View.tsx` — main component with `data-qa-id`s
- [ ] `apps/web/src/features/<id>/<Name>View.browser.test.tsx` — UI test
- [ ] `apps/web/src/routes/features/<id>.tsx` — route file
- [ ] `e2e/fixtures/features/<id>.ts` — page fixture
  - [ ] `e2e/pages/features/<id>/` — page object
  - [ ] `e2e/specs/features/<id>/` — `@smoke` spec
- [ ] `pnpm check && pnpm test && pnpm lint` passes

## Rules

- Import from `@kilo-desktop/feature-sdk` for SDK types and `defineMethod`; use `useSdk<ServiceType>` in the renderer
- Import from `@kilo-desktop/contracts` for Zod schemas, `defineContract`, and `InferContract`
- Import from `@kilo-desktop/testing` for test fakes
- Never add methods to `LocalApi`
- Never import from another feature
- Namespace events with feature ID: `sdk.events.emit("eventName", payload)` (auto-prefixed)
- Own your own SQLite file if you persist data: `${userData}/features/<id>/data.db`
- For cross-feature communication: `sdk.events`, `sdk.plugins.get`, `sdk.state.get`
- Every feature ships at least one `@smoke` e2e spec
- Prefer Vitest browser tests over e2e when Electron IPC / the packaged binary is not required
