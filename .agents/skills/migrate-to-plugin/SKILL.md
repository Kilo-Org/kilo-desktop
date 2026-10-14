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
4. Create `plugin.json` and `package.json`
5. Remove feature from shell (FEATURES array, contracts export, route file)
6. Add to `BUNDLED_PLUGINS` in both shell registries
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

### Step 3: Create plugin.json

**File:** `plugins/<id>/plugin.json` — validated by `pluginManifestSchema` from `@kilo-desktop/feature-sdk` during discovery. Unknown keys are rejected (strict schema). The schema (`packages/feature-sdk/src/plugin/manifest.ts`) is the source of truth — if this template disagrees with it, trust the schema and update this skill.

```json
{
	"id": "<id>",
	"displayName": "<Human Name>",
	"version": "1.0.0",
	"main": "./src/main/index.ts",
	"web": "./src/web/index.ts",
	"protocols": [],
	"zones": [],
	"contributes": {
		"providers": [],
		"routes": [{ "path": "/<id>", "component": "<WebEntryExportName>", "title": "<Human Name>" }],
		"nav": [{ "to": "/<id>", "label": "<Human Name>", "icon": "<lucide-icon-name>" }],
		"zones": [],
		"settings": [],
		"deepLinks": []
	}
}
```

- `main` — main-process entry; the module must export `mainRegister(mainSdk)`. Omit for renderer-only plugins.
- `web` — renderer entry; may export `browserRegister(mainSdk)` for standalone browser mode (omit the export for Electron-only plugins — browser mode then skips the plugin with a warning). Omit the field for headless plugins.
- `protocols` — URL schemes the plugin handles via `mainSdk.protocol.handle(scheme, handler)` (e.g. `["my-plugin"]` for `my-plugin://…`). Schemes must be lowercase RFC 3986 (`^[a-z][a-z0-9+.-]*$`); the shell registers them as privileged before app-ready and rejects `handle` calls for undeclared schemes. Requires `main`.
- `zones` — plugin-owned UI outlets, declared as stable `{ "id": "..." }` entries. Other plugins target them as `"<plugin-id>/<zone-id>"`; the owning plugin renders the outlet and owns its component context contract. Requires `web`.
- `contributes` — everything the plugin adds to the shell, declared statically (VS Code–style):
  - `providers` — app-lifetime React providers (`component` export name plus optional `priority`). The shell composes them inside `SdkProvider` and `QueryClientProvider`, so plugin capabilities, state, dialogs, and event listeners can remain active independently of the current route. Higher priority wraps lower priority. Requires `web`.
  - `routes` — full pages (`path` → `component` export). The shell mounts the component on its catch-all route and passes it `PluginPageProps` (`path`, `search`); optional `title` supplies the shell-owned page heading, optional `surface` selects the page surface, and optional `header.leading` / `header.actions` name route-scoped component exports rendered in the shell header. Routes require `web`.
  - `nav` — sidebar entries (pure data): `to` (any path), `label`, optional `icon` (kebab-case lucide name), `priority` (higher first), and `featureFlag`. Decoupled from routes — a route can have no nav entry, and a nav entry can point anywhere.
  - `zones` — plugin-lifetime zone registrations. Target canonical shell zones by bare id or plugin-owned zones by `"<plugin-id>/<zone-id>"`. Each entry provides `zone` and `component`, plus optional stable `id`, `label`, `description`, `icon` export, `priority`, and `requiresSignIn` / `signInHint` (hosts with a picker, such as the chat "+" menu, disable a sign-in contribution while the user is signed out and show the hint). The zone owner decides whether to render components directly or interpret them as richer definitions. Use `providers` for lifecycle work that must remain mounted across routes, and imperative `sdk.contribute` for conditional UI. Requires `web`; undeclared targets are reported and skipped.
  - `settings` — settings-page sections (`id`, `title`, and `component`, plus optional `category`, `icon`, `priority`, and `featureFlag`). The shell owns `/settings`, groups uncategorized sections under `General`, and mounts one section at a time. Requires `web`.
  - `deepLinks` — OS deep links on the app scheme (`kilo-desktop://{host}/{id}`). Pure data: kebab-case `host` (unique across plugins; `app` is reserved), in-app `to` (`/settings/…` or `/plugins/…`), and `searchParam` for the path segment. The shell registers the scheme and navigates; no `web` required.
- At least one of `main` / `web` is required.

### Step 4: Create package.json

**File:** `plugins/<id>/package.json`

```json
{
	"name": "@kilo-desktop/plugin-<id>",
	"version": "1.0.0",
	"private": true,
	"type": "module",
	"exports": {
		"./plugin.json": "./plugin.json",
		"./web": "./src/web/index.ts",
		"./main": "./src/main/index.ts"
	},
	"dependencies": {
		"@kilo-desktop/feature-sdk": "workspace:*",
		"react": "^19.2.8",
		"react-dom": "^19.2.8",
		"zod": "catalog:"
	},
	"devDependencies": {
		"@kilo-desktop/testing": "workspace:*",
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
| `from "@kilo-desktop/contracts"` (for feature schemas) | `from "../contracts/schemas.js"`               |
| `from "@/features/<id>/..."`                                       | Relative within `src/web/`                     |
| `from "@/platform/sdk"`                                            | `from "@kilo-desktop/sdk-react"`   |
| `from "@/components/ui/..."` / `from "@/lib/utils"`                | `from "@kilo-desktop/ui/components/..."` / `from "@kilo-desktop/ui/lib/utils"` — the shared design-system package; NEVER copy shadcn components into a plugin |

Imports from `@kilo-desktop/feature-sdk`, `@kilo-desktop/sdk-react`, `@kilo-desktop/ui`, `@kilo-desktop/testing`, and `zod` stay unchanged. Contract helpers (`defineContract`, `defineMethod`, `InferContract`) come from `@kilo-desktop/feature-sdk` — never from the shell-internal contracts package. Tailwind classes in plugin components keep working: `apps/web/src/globals.css` already has `@source` entries for `packages/ui` and `plugins` (one-time, done); plugin browser tests import their own `src/test/globals.css` (`@import "tailwindcss"` + `@source` for `packages/ui`).

### Step 6: Create renderer entry (if needed)

If the plugin has a UI, add `plugins/<id>/src/web/index.ts` re-exporting the page/components. If the plugin should also work in standalone browser mode (no Electron main process), export a `browserRegister` with browser-safe handlers; Electron-only plugins (SQLite, fs) omit it and are skipped in browser mode with a warning:

```ts
export { MyView } from "./MyView.js";

// Optional — only for browser-mode support (no Node APIs):
import type { MainSdk } from "@kilo-desktop/feature-sdk";
import { myContract } from "../contracts/schemas.js";

export function browserRegister(mainSdk: MainSdk) {
	mainSdk.channels(myContract).handleAll({
		/* in-memory fakes */
	});
}
```

### Step 7: Remove from shell

1. Delete the feature's entry from `apps/desktop/src/main/features/registry/features.ts`
2. Remove the re-export from `packages/contracts/src/index.ts`
3. Delete `packages/contracts/src/features/<id>.ts` (already moved)
4. Delete the feature's route file under `apps/web/src/routes/` — the manifest `contributes.routes` entry replaces it (the shell's catch-all `routes/$.tsx` mounts the page and `contributes.nav` supplies the sidebar entry automatically; no shell route or `AppSidebarLayout.tsx` edits)
5. Remove the main-process feature directory (already moved)
6. Remove the renderer feature directory (already moved)

### Step 8: Register as bundled plugin

`BUNDLED_PLUGINS` is one registry per process (each side imports only the entry it can run). Add the plugin to both when it ships both entries:

**File:** `apps/desktop/src/main/features/registry/bundled-plugins.ts`

```typescript
import myPluginManifest from "@kilo-desktop/plugin-<id>/plugin.json" with { type: "json" };
import * as myPluginMain from "@kilo-desktop/plugin-<id>/main";

export const BUNDLED_PLUGINS: readonly BundledPlugin[] = [
	{ manifest: myPluginManifest, module: myPluginMain },
];
```

**File:** `apps/web/src/features/bundled-plugins.ts`

```typescript
import myPluginManifest from "@kilo-desktop/plugin-<id>/plugin.json" with { type: "json" };
import * as myPluginWeb from "@kilo-desktop/plugin-<id>/web";

export const BUNDLED_PLUGINS: readonly BundledPlugin[] = [
	{ manifest: myPluginManifest, module: myPluginWeb },
];
```

The loader (`discoverPlugins` in `@kilo-desktop/feature-sdk`) validates the manifest at boot and feeds the registrations into the existing `FEATURES` / `WEB_FEATURES` boot paths. Also add the workspace dep to `apps/desktop/package.json` and (for UI plugins) `apps/web/package.json`:

```json
"@kilo-desktop/plugin-<id>": "workspace:*"
```

### Step 9: pnpm-workspace.yaml

The `plugins/*` glob is already in `pnpm-workspace.yaml` — no edit needed. Run `pnpm install` so the new workspace package links.

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
import { test as base } from "@kilo-desktop/e2e/fixtures";
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

- [ ] `plugins/<id>/plugin.json` created (validates against `pluginManifestSchema`)
- [ ] `plugins/<id>/package.json` created
- [ ] All source files moved from apps → plugin
- [ ] Imports fixed (contracts → relative, @/ → relative or sdk)
- [ ] Feature removed from FEATURES array
- [ ] Feature removed from contracts re-exports
- [ ] Shell route file deleted (manifest `contributes.routes` + `nav` and the catch-all replace it; no `AppSidebarLayout.tsx` edits)
- [ ] Registered in `BUNDLED_PLUGINS` (both desktop and web registries)
- [ ] E2E pages + specs moved to `plugins/<id>/e2e/`
- [ ] Plugin-local `e2e/fixtures.ts` created; shell fixture cleaned up
- [ ] `pnpm install` succeeds
- [ ] `pnpm check` passes
- [ ] `pnpm test` passes
- [ ] App still works end-to-end (`pnpm test:e2e:smoke`)
