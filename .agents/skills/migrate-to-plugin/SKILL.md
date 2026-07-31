---
name: migrate-to-plugin
description: Migrate an existing feature from apps/ into a self-contained plugin under plugins/. Handles file moves, import rewrites, manifest creation, FEATURES removal, and test migration. Use when migrating a feature to a plugin, extracting a feature, or when user says "migrate to plugin", "extract plugin", or "make this a plugin".
---

# Migrate Feature to Plugin

Move a feature from `apps/` into a self-contained plugin under `plugins/<id>/`.

## Prerequisites

- The feature follows the SDK pattern (`useSdk`, `mainRegister`, `FEATURES` array)
- The migration checklist from CONTEXT.md passes (no shell-internal imports, no cross-feature imports)

## Quick start

1. Create the plugin directory structure
2. Move files from their three locations into the plugin
3. Update imports (contracts path, package references)
4. Create `manifest.json` and `package.json`
5. Remove feature from shell (FEATURES array, contracts export, route file)
6. Add to `BUNDLED_PLUGINS` in shell
7. Verify with `pnpm check && pnpm test`

## Workflow

### Step 1: Create plugin directory

```bash
mkdir -p plugins/<id>/src/{contracts,main,web}
```

### Step 2: Move files

```bash
# Contracts (Zod schemas)
git mv packages/contracts/src/features/<id>.ts plugins/<id>/src/contracts/schemas.ts

# Main-process code
git mv apps/desktop/src/main/features/<id>/* plugins/<id>/src/main/

# Renderer code
git mv apps/web/src/features/<id>/* plugins/<id>/src/web/
```

### Step 3: Create manifest.json

**File:** `plugins/<id>/manifest.json`

```json
{
	"id": "<id>",
	"name": "<Human Name>",
	"version": "1.0.0",
	"entry": "src/web/index.tsx",
	"mainEntry": "src/main/index.ts",
	"icon": "<lucide-icon-name>",
	"group": "<sidebar-group>",
	"intents": [{ "name": "view", "type": "navigation", "params": {} }]
}
```

Omit `icon`, `group`, and navigation intents if the plugin is headless (no sidebar entry).

### Step 4: Create package.json

**File:** `plugins/<id>/package.json`

```json
{
	"name": "@anaconda-agentic-desktop/plugin-<id>",
	"version": "1.0.0",
	"private": true,
	"type": "module",
	"exports": {
		"./manifest": "./manifest.json",
		"./web": "./src/web/index.tsx",
		"./main": "./src/main/index.ts"
	},
	"dependencies": {
		"@anaconda-agentic-desktop/feature-sdk": "workspace:*",
		"react": "^19.2.8",
		"react-dom": "^19.2.8",
		"zod": "catalog:"
	},
	"devDependencies": {
		"@anaconda-agentic-desktop/testing": "workspace:*",
		"@types/react": "^19.2.17",
		"@types/react-dom": "^19.2.3",
		"typescript": "catalog:",
		"vitest": "catalog:"
	}
}
```

Add main-process deps (better-sqlite3, drizzle-orm, etc.) if the feature persists data.

### Step 5: Fix imports in moved files

| Old import                                                         | New import                                     |
| ------------------------------------------------------------------ | ---------------------------------------------- |
| `from "@anaconda-agentic-desktop/contracts"` (for feature schemas) | `from "../contracts/schemas.js"`               |
| `from "@/features/<id>/..."`                                       | Relative within `src/web/`                     |
| `from "@/platform/sdk"`                                            | `from "@anaconda-agentic-desktop/feature-sdk"` |

Imports from `@anaconda-agentic-desktop/feature-sdk`, `@anaconda-agentic-desktop/testing`, and `zod` stay unchanged.

### Step 6: Create renderer entry (if needed)

If the plugin has a UI (navigation intent), add `plugins/<id>/src/web/index.tsx`:

```tsx
import { createRoot, type Root } from "react-dom/client";
import { StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";
import { MyView } from "./MyView.js";

let root: Root | null = null;
const qc = new QueryClient();

export function register(_sdk: SDK) {
	// Register tools, state, capabilities, contributions here if needed
}

export function mount(sdk: SDK, container: HTMLElement) {
	root = createRoot(container);
	root.render(
		<StrictMode>
			<QueryClientProvider client={qc}>
				<MyView sdk={sdk} />
			</QueryClientProvider>
		</StrictMode>,
	);
	sdk.onDispose(() => root?.unmount());
}
```

### Step 7: Remove from shell

1. Delete the feature's entry from `apps/desktop/src/main/features/registry/features.ts`
2. Remove the re-export from `packages/contracts/src/index.ts`
3. Delete `packages/contracts/src/features/<id>.ts` (already moved)
4. Delete the route file `apps/web/src/routes/features/<id>.tsx`
5. Remove the main-process feature directory (already moved)
6. Remove the renderer feature directory (already moved)

### Step 8: Register as bundled plugin

**File:** `apps/web/src/features/plugin-system/bundled-plugins.ts` (or equivalent):

```typescript
import * as myPluginWeb from "@anaconda-agentic-desktop/plugin-<id>/web";
import myPluginManifest from "@anaconda-agentic-desktop/plugin-<id>/manifest";

export const BUNDLED_PLUGINS = {
	"<id>": { manifest: myPluginManifest, module: myPluginWeb },
};
```

### Step 9: Update pnpm-workspace.yaml (once)

If `plugins/*` isn't already in the workspace:

```yaml
packages:
  - apps/*
  - packages/*
  - plugins/*
```

### Step 10: Verify

```bash
pnpm install
pnpm check
pnpm test
```

## Test migration

| Before (in apps / e2e)                                  | After (in plugin)                              |
| ------------------------------------------------------- | ---------------------------------------------- |
| `apps/desktop/src/main/features/<id>/MyService.test.ts` | `plugins/<id>/src/main/MyService.test.ts`      |
| `apps/web/src/features/<id>/MyView.browser.test.tsx`    | `plugins/<id>/src/web/MyView.browser.test.tsx` |
| `e2e/pages/features/<id>/`                              | `plugins/<id>/e2e/pages/`                      |
| `e2e/specs/features/<id>/`                              | `plugins/<id>/e2e/specs/`                      |

### Step 10b: Move e2e assets

```bash
mkdir -p plugins/<id>/e2e/{pages,specs}
git mv e2e/pages/features/<id>/* plugins/<id>/e2e/pages/
git mv e2e/specs/features/<id>/* plugins/<id>/e2e/specs/
```

Create a plugin-local fixture so the page objects stay self-contained (no central registry edit — Playwright already globs `plugins/*/e2e/specs/**/*.spec.ts`):

**File:** `plugins/<id>/e2e/fixtures.ts`

```typescript
import { test as base } from "@anaconda-agentic-desktop/e2e/fixtures";
import { MyPage } from "./pages/my-page.js";

export const test = base.extend<{ myPage: MyPage }>({
	// Playwright requires `{}` destructuring; oxlint-disable no-empty-pattern when unused.
	myPage: async ({}, use) => {
		await use(new MyPage());
	},
});
export const { expect } = test;
```

Update specs to `import { test } from "../fixtures.js"` instead of the first-party feature fixture. Delete `e2e/fixtures/features/<id>.ts` after the move.

Test changes for unit/browser:

- Replace `LocalApiProvider` + fake `LocalApi` → `createFakeSdk({ featureId: "<id>", channels: myFeatureChannels, handlers: { ... } })`
- Replace `import { ... } from "@/..."` → relative imports within plugin
- Service tests move verbatim (they don't depend on shell infra)

## Checklist

- [ ] `plugins/<id>/manifest.json` created
- [ ] `plugins/<id>/package.json` created
- [ ] All source files moved from apps → plugin
- [ ] Imports fixed (contracts → relative, @/ → relative or sdk)
- [ ] Feature removed from FEATURES array
- [ ] Feature removed from contracts re-exports
- [ ] Route file deleted from `apps/web/src/routes/features/`
- [ ] Registered in `BUNDLED_PLUGINS`
- [ ] E2E pages + specs moved to `plugins/<id>/e2e/`
- [ ] Plugin-local `e2e/fixtures.ts` created; shell fixture cleaned up
- [ ] `pnpm install` succeeds
- [ ] `pnpm check` passes
- [ ] `pnpm test` passes
- [ ] App still works end-to-end (`pnpm test:e2e:smoke`)
