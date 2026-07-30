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
// defineMethod from `@anaconda-agentic-desktop/feature-sdk`.
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
import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";
import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk/main";
import { myFeatureChannels } from "@anaconda-agentic-desktop/contracts";
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
import type { FeatureRegistration } from "@anaconda-agentic-desktop/feature-sdk";
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
import type { TypedSDK } from "@anaconda-agentic-desktop/feature-sdk";
import { myFeatureChannels } from "@anaconda-agentic-desktop/contracts";

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
import { withChannels } from "@anaconda-agentic-desktop/feature-sdk";
import { myFeatureChannels } from "@anaconda-agentic-desktop/contracts";
import { useSdk } from "@/platform/sdk";
import { listQueryOptions, createMutationOptions } from "./use<Name>";

export function <Name>View() {
  const sdk = withChannels(useSdk("<id>"), myFeatureChannels);
  const qc = useQueryClient();
  const items = useQuery(listQueryOptions(sdk));
  const create = useMutation(createMutationOptions(sdk, qc));
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

**Main service test:** `apps/desktop/src/main/features/<id>/MyService.test.ts`

- Test business logic directly (no IPC, no SDK)

**Renderer test:** `apps/web/src/features/<id>/<Name>View.browser.test.tsx`

```tsx
import { createFakeSdk } from "@anaconda-agentic-desktop/testing";
// Use createFakeSdk({
//   featureId: "<id>",
//   channels: myFeatureChannels,
//   handlers: { list: () => [...] },
// })
// to serve sdk.invoke calls through the fake's real in-memory router.
```

### Step 7: Verify

```bash
pnpm check    # Types pass
pnpm test     # Tests pass
pnpm lint     # No warnings
```

## Checklist

- [ ] `packages/contracts/src/features/<id>.ts` — Zod schemas
- [ ] `packages/contracts/src/index.ts` — re-export added
- [ ] `apps/desktop/src/main/features/<id>/index.ts` — mainRegister
- [ ] `apps/desktop/src/main/features/<id>/MyService.ts` — service
- [ ] `apps/desktop/src/main/features/<id>/MyService.test.ts` — service test
- [ ] `apps/desktop/src/main/features/registry/features.ts` — array entry added
- [ ] `apps/web/src/features/<id>/use<Name>.ts` — query/mutation hooks
- [ ] `apps/web/src/features/<id>/<Name>View.tsx` — main component
- [ ] `apps/web/src/features/<id>/<Name>View.browser.test.tsx` — UI test
- [ ] `apps/web/src/routes/features/<id>.tsx` — route file
- [ ] `pnpm check && pnpm test && pnpm lint` passes

## Rules

- Import from `@anaconda-agentic-desktop/feature-sdk` for SDK types, `withChannels`, and `defineMethod` (after plugin migration); use `useSdk` + `withChannels` in the renderer
- Import from `@anaconda-agentic-desktop/contracts` for Zod schemas
- Import from `@anaconda-agentic-desktop/testing` for test fakes
- Never add methods to `LocalApi`
- Never import from another feature
- Namespace events with feature ID: `sdk.events.emit("eventName", payload)` (auto-prefixed)
- Own your own SQLite file if you persist data: `${userData}/features/<id>/data.db`
- For cross-feature communication: `sdk.events`, `sdk.plugins.get`, `sdk.state.get`
