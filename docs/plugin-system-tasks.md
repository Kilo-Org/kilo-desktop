# Plugin System — Implementation Tasks (Vertical Slices)

This document breaks the plugin system (documented in `docs/transfer/`) into ordered vertical slices. Each slice is self-contained, testable, and has a single concern. An AI agent can pick up any slice — provided its dependencies are complete — and implement it without ambiguity.

---

## Prerequisites

The React migration is **already complete** on `main`. The codebase is ready for plugin-system implementation.

1. **Anaconda shadcn theme** — `@anaconda/shadcn-theme` (v0.0.1-alpha.3) is imported in `apps/web/src/globals.css` via `@import "@anaconda/shadcn-theme/styles"`. Access to the `@anaconda` GitHub Packages registry is configured in `pnpm-workspace.yaml`.

## Codebase starting point

**Monorepo layout** (post-migration):

```
apps/
├── desktop/                        # @anaconda-agentic-desktop/desktop (Electron main + preload)
│   ├── src/main/                   # ElectronApp, IpcServer, feature handlers, db/, platform/
│   ├── src/preload/preload.ts      # Exposes `window.desktopApi` (contract-validated bridge)
│   └── package.json
└── web/                            # @anaconda-agentic-desktop/web (React renderer)
    ├── src/
    │   ├── main.tsx                # createRoot() entry: <StrictMode><LocalApiProvider><QueryClientProvider><RouterProvider>
    │   ├── App.tsx                 # Root component: <ThemeSync /><Outlet />
    │   ├── globals.css             # Imports tailwindcss + @anaconda/shadcn-theme/styles
    │   ├── router.tsx              # createRouter({ routeTree, history: createHashHistory() })
    │   ├── routeTree.gen.ts        # TanStack Router codegen (auto-generated)
    │   ├── routes/                 # File-based routes: __root.tsx, index.tsx, ...
    │   ├── components/ui/          # shadcn/ui components (base-nova, @base-ui/react primitives)
    │   ├── features/               # Feature folders (theme/ThemeSync.tsx, todos/TodoList.tsx)
    │   ├── platform/               # LocalApiProvider, electron/browser LocalApi adapters
    │   └── lib/                    # utils.ts (cn), query/client.ts, hooks/ (to be created)
    ├── vite.config.ts              # Vite + @vitejs/plugin-react + tanstackRouter plugin + tailwindcss
    ├── vitest.config.ts            # Two projects: "unit" (node) + "browser" (Playwright/Chromium)
    ├── components.json             # shadcn CLI config (style: base-nova, alias: @/components, @/lib, @/hooks)
    └── package.json

packages/
├── contracts/                      # @anaconda-agentic-desktop/contracts (Zod IPC contracts)
│   └── src/                        # contract.ts, desktop-api.ts, local-api.ts, registry.ts, features/*
├── core/                           # @anaconda-agentic-desktop/core   (TO CREATE — plugin runtime)
└── sdk/                            # @anaconda-agentic-desktop/sdk    (TO CREATE — plugin-facing API)
```

**Toolchain:**

- React 19.2, TypeScript 7.0.2 (catalog), Vite 8, Vitest 5-beta (catalog)
- Zod 4.4.3 (catalog)
- TanStack Router (file-based, hash history) + TanStack Query
- shadcn CLI (`base-nova` style, neutral base, `lucide-react` icons, `@base-ui/react` primitives)
- `react-use` for utility hooks (available)
- `oxlint` + `oxfmt` (not ESLint/Prettier)
- Testing: `@testing-library/react` + `@testing-library/dom`, Vitest browser mode via Playwright/Chromium

**Existing systems to integrate with:**

- **`LocalApi`** (`packages/contracts/src/local-api.ts`) — high-level typed facade exposed via `useLocalApi()` hook. Electron adapter (`apps/web/src/platform/electronLocalApi.ts`) wraps `window.desktopApi.invoke()`; browser adapter (`browserLocalApi.ts`) provides in-memory fallbacks. Plugin-scoped IPC (Slice 8) will use the raw `desktopApi` bridge, NOT `LocalApi` (which is for the app's own high-level features).
- **`ipcMethods` / `ipcEvents`** in `packages/contracts/` — extended via `mergeChannelMaps()`. New plugin channels (Slice 15 filesystem, Slice 19 MCP Apps token validation) add feature contracts here.
- **`ThemeSync`** (`apps/web/src/features/theme/ThemeSync.tsx`) — already applies `.dark` class based on `api.theme.onChanged()`. Slice 14 wraps this system as an SDK-facing service without duplicating it.

## Conventions

- All new packages use `"type": "module"` (ESM)
- Package naming: `@anaconda-agentic-desktop/core`, `@anaconda-agentic-desktop/sdk` (matches existing `@anaconda-agentic-desktop/{desktop,web,contracts}`)
- Strict TypeScript (extends `tsconfig.base.json`)
- Tests colocated with source:
  - `*.test.ts` — node/unit tests (default Vitest environment)
  - `*.browser.test.tsx` — browser tests (Vitest browser mode via Playwright/Chromium, runs in `apps/web/vitest.config.ts` "browser" project)
- Zod 4 for schemas (workspace catalog `^4.4.3`)
- `.js` extensions on relative imports in `.ts` files (Node ESM resolution). `.tsx` files use bundler resolution.
- **Path alias:** `@/` → `src/` (configured per-package in `vite.config.ts` and `tsconfig.json`). Cross-package imports use full package names (e.g., `@anaconda-agentic-desktop/contracts`).
- **UI convention:** All React components use shadcn/ui `base-nova` (via `pnpm dlx shadcn@latest add <name>` inside `apps/web/`) + Tailwind token classes from `@anaconda/shadcn-theme`. No hardcoded colors. Use `cn()` from `@/lib/utils`. Icons from `lucide-react`. Dark mode via `.dark` class on `<html>` (managed by existing `ThemeSync`).
- **Component style:** Function components + hooks. `PascalCase.tsx` for components; `use*.ts` for hooks. Props typed via `interface Props { ... }` with `readonly` fields for props destructured from parent.
- **Error philosophy:** Services return result envelopes (`{ ok: true/false }`) for expected failures. Only throw for programmer errors (invalid zone name, path traversal).
- **SDK factory wiring convention:** Each service slice that adds a new SDK method also updates `packages/core/src/sdk/create-sdk.ts` to wire that method. No stubs.
- **Observable store contract:** All reactive state from the SDK exposes `subscribe(fn: (v: T) => void): () => void` + `peek(): T`. React consumers wrap them with `useSyncExternalStore(store.subscribe, store.peek)`. A shared hook `useStore(store)` is provided in `apps/web/src/lib/hooks/use-store.ts` (see Slice 3.3).
- **Linting/formatting:** Do not add ESLint / Prettier config. The workspace uses `oxlint` and `oxfmt` — configured at the repo root.

---

## Slice map (20 slices, 6 waves)

```
Wave 1 (foundation, 1 slice):
  1. Package Scaffolding + Manifest Types + SDK Interface

Wave 2 (independent services, up to 8 parallel):
  2. Event Bus                                    3. State Broker
  4. Tool Registry + ModelContext Polyfill        5. Capability Registry
  6. Contribution Registry                        7. Intent Dispatcher + Command Registry
  8. IPC Router                                  10. Plugin Loader + Version Check

Wave 3 (integration, sequential):
  9. SDK Factory (wires all Wave 2 services except Loader)
 11. Shell Orchestrator (uses SDK Factory + Loader)

Wave 4 (UI + peripheral services, up to 6 parallel):
 12. Canvas Manager + PluginErrorBoundary       13. NotificationService + Toast UI
 14. ThemeService                                15. SdkFs (Sandboxed Filesystem)
 17. Command Palette UI                          18. WebMCP External Relay
 19. MCP Apps (Serializer + Token Manager)

Wave 5 (shell composition):
 16. Shell Layout (Sidebar + Contribution Zones + Root layout wiring)

Wave 6 (validation):
 20. Demo Plugin + End-to-End Integration Tests
```

Full dependency graph is at the end of this document.

---

## Slice 1: Package Scaffolding + Manifest Types + SDK Interface

**Goal:** Create `packages/core` and `packages/sdk`. Define `PluginManifest` types and validator. Define the complete `SDK` interface as the shared contract everything downstream implements against.

**Dependencies:** None.

### 1.1 Create `packages/core`

```
packages/core/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── index.ts                    # Barrel exports
    └── manifest/
        ├── types.ts
        ├── validator.ts
        └── validator.test.ts
```

**`packages/core/package.json`:**

```json
{
	"name": "@anaconda-agentic-desktop/core",
	"version": "0.1.0",
	"type": "module",
	"main": "./src/index.ts",
	"types": "./src/index.ts",
	"scripts": {
		"test": "vitest run",
		"test:watch": "vitest",
		"check": "tsc --noEmit"
	},
	"dependencies": {
		"@anaconda-agentic-desktop/sdk": "workspace:*",
		"@mcp-b/webmcp-polyfill": "^latest",
		"@mcp-b/webmcp-types": "^latest",
		"zod": "catalog:"
	},
	"devDependencies": {
		"@vitest/browser": "5.0.0-beta.7",
		"@vitest/browser-playwright": "5.0.0-beta.7",
		"playwright": "^1.61.1",
		"typescript": "catalog:",
		"vitest": "catalog:"
	}
}
```

**`packages/core/vitest.config.ts`:** two projects, matching the pattern in `apps/web/vitest.config.ts`:

```typescript
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: [
			{
				test: { name: "unit", include: ["src/**/*.test.ts"], environment: "node" },
			},
			{
				test: {
					name: "browser",
					include: ["src/**/*.browser.test.ts"],
					browser: {
						enabled: true,
						headless: true,
						provider: playwright(),
						instances: [{ browser: "chromium" }],
					},
				},
			},
		],
	},
});
```

**`packages/core/tsconfig.json`:**

```json
{
	"extends": "../../tsconfig.base.json",
	"compilerOptions": { "rootDir": "src", "outDir": "dist" },
	"include": ["src"]
}
```

### 1.2 Manifest types

**File:** `packages/core/src/manifest/types.ts`

```typescript
export interface IntentDeclaration {
	name: string;
	type: "navigation" | "action";
	params: Record<string, string>;
	risk?: "read" | "write" | "destructive";
}

export interface PluginManifest {
	id: string; // kebab-case unique identifier
	name: string; // Human-readable display name
	version: string; // Semver string
	entry: string; // ESM entry point relative to plugin root
	mainEntry?: string;
	keepAlive?: boolean;
	sharedDeps?: string[];
	permissions?: string[];
	capabilities?: string[];
	intents?: IntentDeclaration[];
	minDesktopVersion?: string;
	brandAccentColor?: string;
	icon?: string; // Lucide icon name — used only when the plugin appears in the sidebar
	group?: string; // Sidebar grouping — used only when the plugin appears in the sidebar
}
```

**Plugin visibility rules (informational — no separate field required):**

| Plugin shape                                                               | Manifest signal                                                                                                                                | Where it appears                                                                               |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **UI plugin** (canvas + tools)                                             | Declares at least one `type: 'navigation'` intent (typically `{ name: 'view', type: 'navigation' }`). Exports both `register()` and `mount()`. | Sidebar entry (uses `icon`, `group`, `brandAccentColor`); its canvas mounts at `/plugins/<id>` |
| **Contribution-only plugin** (widgets in shell zones, no dedicated canvas) | No navigation intent. Exports `register()` only. Registers via `sdk.contribute(zone, ...)`.                                                    | Contribution zones (statusbar, dashboard, etc.); NOT in sidebar                                |
| **Headless / backend plugin** (tools + capabilities only)                  | No intents (or only `type: 'action'` intents). Exports `register()` only.                                                                      | Nowhere visually — tools/capabilities discoverable via SDK + WebMCP                            |

The `icon`, `group`, and `brandAccentColor` fields are ignored for plugins without a navigation intent. Slice 16.5's `ShellProvider` filters `plugins` passed to `PluginNav` to only those with `intents?.some(i => i.type === 'navigation')`.

### 1.3 Manifest validator

**File:** `packages/core/src/manifest/validator.ts`

Implement using Zod 4:

- `id` must match `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/` (kebab-case)
- `version` and `minDesktopVersion` must be valid semver (regex or minimal parser)
- `entry` must be a non-empty string ending in `.js`, `.mjs`, or `.ts`
- `intents[].type` must be `'navigation' | 'action'`
- `intents[].risk` must be `'read' | 'write' | 'destructive'` if present
- Unknown fields silently stripped (lenient runtime per `docs/transfer/01-plugin-system.md`)

Return type:

```typescript
export type ValidationResult =
	{ ok: true; manifest: PluginManifest } | { ok: false; errors: string[] };

export function validateManifest(raw: unknown): ValidationResult;
```

### 1.4 Create `packages/sdk`

```
packages/sdk/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts        # Re-exports types + zod
    └── types.ts        # Complete SDK interface
```

**`packages/sdk/package.json`:**

```json
{
	"name": "@anaconda-agentic-desktop/sdk",
	"version": "0.1.0",
	"type": "module",
	"main": "./src/index.ts",
	"types": "./src/index.ts",
	"dependencies": { "zod": "catalog:" },
	"devDependencies": { "typescript": "catalog:" }
}
```

### 1.5 SDK interface (types only)

**File:** `packages/sdk/src/types.ts`

Define the complete `SDK` interface. This is the contract that all downstream code implements against — plugins depend only on this package.

```typescript
import type { ZodType } from "zod";

export interface ToolDefinition {
	name: string;
	description: string;
	input: ZodType;
	output?: ZodType;
	handler: (args: any) => unknown | Promise<unknown>;
	expose?: "all" | "plugins" | "ai";
	app?: unknown;
	mutating?: boolean;
}

export type ToolResult =
	| { ok: true; value: unknown }
	| { ok: false; reason: "not_found" | "unavailable" | "error"; message: string };

export interface ToolInfo {
	pluginId: string;
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	mutating?: boolean;
}

export interface SdkTools {
	register(definition: ToolDefinition): void;
	invoke(pluginId: string, toolName: string, args: unknown): Promise<ToolResult>;
	from(...pluginIds: string[]): ToolInfo[];
	all(): ToolInfo[];
	getApp(pluginId: string, toolName: string): unknown | null;
}

export interface SdkEvents {
	emit(event: string, payload?: unknown): void;
	on(namespacedEvent: string, handler: (payload: any) => void): () => void;
	off(namespacedEvent: string, handler: (payload: any) => void): void;
}

export interface StoreHandle<T = unknown> {
	set(value: T): void;
}
export interface ReadableStore<T = unknown> {
	/** Subscribe to value changes. Fires immediately with current value. Returns unsubscribe fn. */
	subscribe(fn: (value: T) => void): () => void;
	/** Read current value without subscribing. */
	peek(): T;
}

export interface SdkState {
	register<T>(storeName: string, initialValue: T, options?: { schema?: ZodType }): StoreHandle<T>;
	get<T = unknown>(namespacedKey: string): ReadableStore<T>;
	peek(namespacedKey: string): unknown;
	schema(namespacedKey: string): ZodType | null;
}

export interface SdkIpc {
	handle(channel: string, handler: (...args: any[]) => unknown | Promise<unknown>): void;
	invoke(channel: string, ...args: any[]): Promise<unknown>;
}

export interface SdkPlugins {
	expose(capabilityName: string, implementation: Record<string, unknown>): void;
	get(pluginId: string): Record<string, any> | null;
}

export interface ContributionOptions {
	component: unknown;
	label: string;
	size?: string;
	priority?: number;
}

export interface NavigateIntent {
	plugin: string;
	intent: string;
	params?: Record<string, unknown>;
}
export interface DispatchIntent {
	plugin: string;
	action: string;
	params?: Record<string, unknown>;
}
export interface CommandDefinition {
	id: string;
	label: string;
	handler: () => void | Promise<void>;
}

export interface SdkNotifications {
	show(opts: {
		title: string;
		message: string;
		type: "info" | "success" | "warning" | "error";
	}): void;
	setBadge(count: number): void;
}

export interface SdkTheme extends ReadableStore<"dark" | "light"> {
	getEffective(): "dark" | "light";
	getTokens(): Record<string, string>;
}

export interface SdkFs {
	readFile(relativePath: string): Promise<string>;
	writeFile(relativePath: string, content: string): Promise<void>;
	exists(relativePath: string): Promise<boolean>;
	mkdir(relativePath: string): Promise<void>;
	readdir(relativePath: string): Promise<string[]>;
	remove(relativePath: string): Promise<void>;
}

export interface SdkCommands {
	register(definition: CommandDefinition): void;
}
export interface SdkIntents {
	list(): Array<{
		plugin: string;
		name: string;
		type: "navigation" | "action";
		params: Record<string, string>;
	}>;
}

export interface SDK {
	readonly pluginId: string;
	readonly tools: SdkTools;
	readonly events: SdkEvents;
	readonly state: SdkState;
	readonly ipc: SdkIpc;
	readonly plugins: SdkPlugins;
	readonly notifications: SdkNotifications;
	readonly theme: SdkTheme;
	readonly fs: SdkFs;
	readonly commands: SdkCommands;
	readonly intents: SdkIntents;
	contribute(zone: string, options: ContributionOptions): void;
	navigate(intent: NavigateIntent): void;
	dispatch(intent: DispatchIntent): void;
	onDispose(fn: () => void): void;
	destroy(): void;
}
```

**Also export from `packages/sdk/src/index.ts`:**

```typescript
export * from "./types.js";
export { z } from "zod"; // Convenience re-export
```

### 1.6 Workspace check

Run `pnpm install` — `packages/core` and `packages/sdk` should link. Both should type-check via `pnpm -r check`.

**Acceptance criteria:**

- [ ] Both packages exist with valid `package.json` and `tsconfig.json`
- [ ] `PluginManifest`, `IntentDeclaration`, `ValidationResult` exported from `@anaconda-agentic-desktop/core`
- [ ] `SDK` interface fully specified in `@anaconda-agentic-desktop/sdk`
- [ ] `validateManifest()` tests pass (valid manifest → ok, invalid → descriptive errors)
- [ ] `pnpm -r check` succeeds

---

## Slice 2: Event Bus

**Goal:** Namespaced fire-and-forget pub/sub service.

**Dependencies:** Slice 1.

**File:** `packages/core/src/services/event-bus.ts`

```typescript
export class EventBus {
	private handlers = new Map<string, Set<(payload: any) => void>>();

	on(event: string, handler: (payload: any) => void): () => void;
	off(event: string, handler: (payload: any) => void): void;
	emit(event: string, payload?: unknown): void;
	removeByPrefix(prefix: string): void;
}
```

**Behavior:**

- `emit()` calls each handler synchronously in `try/catch`. On throw, log `console.warn('[EventBus] Handler for "${event}" threw:', error)` and continue.
- `on()` returns an unsubscribe function.
- `removeByPrefix(prefix)` removes handlers where the event key starts with `prefix` (used for plugin teardown: `removeByPrefix('pluginId.')`).

**Tests (`packages/core/src/services/event-bus.test.ts`):**

1. `on` + `emit` — handler receives payload
2. Multiple handlers — all invoked
3. Handler throws — other handlers still called, no propagation
4. `off()` — handler no longer called
5. Unsubscribe fn from `on()` — handler removed
6. `removeByPrefix` — matching handlers removed, others kept
7. `emit` with no handlers — no error

**Acceptance criteria:**

- [ ] All 7 tests pass
- [ ] Handler failures do not affect siblings
- [ ] `removeByPrefix` correctly scopes to prefix

---

## Slice 3: Reactive State Broker

**Goal:** Observable reactive stores compatible with React's `useSyncExternalStore`, with lazy resolution.

**Dependencies:** Slice 1.

### 3.1 StateBroker

**File:** `packages/core/src/services/state-broker.ts`

```typescript
import type { ZodType } from 'zod';
import type { StoreHandle, ReadableStore } from '@anaconda-agentic-desktop/sdk';

export class StateBroker {
  constructor(private devMode = false);

  register<T>(pluginId: string, storeName: string, initialValue: T, options?: { schema?: ZodType }): StoreHandle<T>;
  get<T = unknown>(namespacedKey: string): ReadableStore<T>;
  peek(namespacedKey: string): unknown;
  schema(namespacedKey: string): ZodType | null;
  removeByPlugin(pluginId: string): void;
  getUnresolvedKeys(): string[];
}
```

**Behavior:**

- Internal key: `${pluginId}.${storeName}`.
- `subscribe(fn)`: calls `fn` immediately with current value, returns unsubscribe. This matches the contract expected by `useSyncExternalStore`.
- `set()` notifies all subscribers synchronously.
- **Lazy resolution:** `get()` on non-existent key creates a placeholder (value = `null`, `hydrated = false`). When `register()` is later called for that key, the placeholder is hydrated: value set, all subscribers notified.
- **Schema validation:** if `options.schema` provided AND `devMode` is true, `set()` calls `schema.safeParse(value)` — throws on failure. In production, skipped.
- `removeByPlugin(pluginId)` notifies subscribers with `null` before deletion.
- `getUnresolvedKeys()` returns keys that were `get()`'d but never `register()`'d (used for dev-mode warnings).

### 3.2 Tests

Same 9 test cases as before (`register` + `get`, `set` propagation, multiple subscribers, `peek`, lazy resolution, `removeByPlugin`, schema validation, unsubscribe, `getUnresolvedKeys`).

### 3.3 React hook

**File:** `apps/web/src/lib/hooks/use-store.ts`

```typescript
import { useSyncExternalStore } from "react";
import type { ReadableStore } from "@anaconda-agentic-desktop/sdk";

/** Subscribe a React component to a ReadableStore. */
export function useStore<T>(store: ReadableStore<T>): T {
	return useSyncExternalStore(
		(onChange) => store.subscribe(onChange),
		() => store.peek(),
		() => store.peek(), // getServerSnapshot — same as client since Electron has no SSR
	);
}
```

**Tests (`use-store.browser.test.tsx`, Vitest browser mode + `@testing-library/react`, 3 cases):**

1. Component re-renders when store value changes
2. Unmount unsubscribes from store
3. `useStore` on lazy-resolved store initially returns `null`, then hydrates

**Acceptance criteria:**

- [ ] Observable subscribe contract works
- [ ] Lazy resolution works
- [ ] Dev-mode validation works
- [ ] `useStore` hook works with React 19
- [ ] All 9 broker tests + 3 hook tests pass

---

## Slice 4: Tool Registry + ModelContext Polyfill (`@mcp-b/webmcp-polyfill`)

**Goal:** Set up `document.modelContext` using the battle-tested `@mcp-b/webmcp-polyfill` package, and implement the ToolRegistry that auto-publishes plugin tools to it. **Critical slice — enables AI tool discovery.**

**Dependencies:** Slice 1.

**Reference:** https://docs.mcp-b.ai/packages/webmcp-polyfill/reference

### 4.1 Polyfill wrapper

**File:** `packages/core/src/services/model-context.ts`

```typescript
import { initializeWebMCPPolyfill, cleanupWebMCPPolyfill } from "@mcp-b/webmcp-polyfill";

export function installModelContext(): void {
	initializeWebMCPPolyfill({ installTestingShim: true });
}

export function getModelContext(): typeof document.modelContext {
	const mc = (document as any).modelContext;
	if (!mc) throw new Error("modelContext not initialized. Call installModelContext() first.");
	return mc;
}

export { cleanupWebMCPPolyfill as cleanupModelContext };
```

**Why the testing shim:** `navigator.modelContextTesting` provides `listTools()` (sync), `executeTool()`, and `registerToolsChangedCallback()` — exactly what `@mcp-b/webmcp-local-relay` embed.js needs.

**Why Zod schemas pass through:** `@mcp-b/webmcp-polyfill` detects the Standard Schema interface (Zod 4 implements `~standard.jsonSchema`), so Zod schemas can be passed directly as `inputSchema` without manual `z.toJSONSchema()` conversion.

### 4.2 ToolRegistry

**File:** `packages/core/src/services/tool-registry.ts`

```typescript
import type { ZodType } from 'zod';

export interface InternalToolDefinition {
  name: string;
  description: string;
  input: ZodType;
  output?: ZodType;
  handler: (args: any) => unknown | Promise<unknown>;
  expose?: 'all' | 'plugins' | 'ai';
  app?: unknown;
  mutating?: boolean;
}

export type ToolResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'not_found' | 'unavailable' | 'error'; message: string };

export interface ToolInfo {
  pluginId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  mutating?: boolean;
}

export class ToolRegistry {
  constructor(private modelContext: { registerTool: Function; unregisterTool: Function });

  register(pluginId: string, definition: InternalToolDefinition): void;
  invoke(pluginId: string, toolName: string, args: unknown): Promise<ToolResult>;
  from(...pluginIds: string[]): ToolInfo[];
  all(): ToolInfo[];
  getApp(pluginId: string, toolName: string): unknown | null;
  unregisterPlugin(pluginId: string): void;
  disablePlugin(pluginId: string): void;
  enablePlugin(pluginId: string): void;
}
```

**Behavior:**

- Internal key: `${pluginId}:${toolName}` (colon).
- ModelContext name: `${pluginId}_${toolName}` (underscore — MCP tool names cannot contain colons).
- On `register()`:
  - Compute JSON Schema once via `z.toJSONSchema(definition.input)` and cache it in the internal entry for `ToolInfo.inputSchema`.
  - If `expose !== 'plugins'`, create an `AbortController`, then call `modelContext.registerTool({ name, description, inputSchema: definition.input, execute, annotations }, { signal: controller.signal })`. Pass the **Zod schema directly** as `inputSchema` — polyfill converts via Standard Schema.
  - `execute` wraps handler: `async (args) => JSON.stringify(await handler(args))`.
  - `annotations.readOnlyHint = definition.mutating !== true`.
- `invoke()` never throws — always returns a `ToolResult`:
  1. Not found → `{ ok: false, reason: 'not_found' }`
  2. Plugin disabled → `{ ok: false, reason: 'unavailable' }`
  3. Zod `safeParse` fails → `{ ok: false, reason: 'error', message }`
  4. Handler throws → `{ ok: false, reason: 'error', message: error.message }`
  5. Success → `{ ok: true, value }`
- `from()`: filters tools with `expose !== 'ai'` visibility.
- `unregisterPlugin(pluginId)` aborts all AbortControllers for that plugin → polyfill auto-removes tools from modelContext.

**Tests (`packages/core/src/services/tool-registry.browser.test.ts`, Vitest browser mode):**

`beforeEach: installModelContext()`, `afterEach: cleanupModelContext()`.

1. `register` + `invoke` — successful invocation with valid args
2. `invoke` with invalid args — `{ ok: false, reason: 'error' }` with validation message
3. `invoke` on non-existent tool — `{ ok: false, reason: 'not_found' }`
4. `invoke` on disabled plugin — `{ ok: false, reason: 'unavailable' }`
5. `register` with `expose: 'all'` — tool appears on `document.modelContext.getTools()`
6. `register` with `expose: 'plugins'` — tool does NOT appear on modelContext
7. `unregisterPlugin` — tools removed from registry AND from modelContext
8. `from(pluginId)` — returns metadata for specified plugins with correct JSON Schema
9. `all()` — returns all exposed tool metadata
10. Handler throws — `{ ok: false, reason: 'error' }`
11. `readOnlyHint` set correctly based on `mutating` flag
12. Zod schema accepted by polyfill (Standard Schema compat)

**Acceptance criteria:**

- [ ] Polyfill installed with testing shim enabled
- [ ] Tools auto-published to modelContext via polyfill API
- [ ] Zod schemas pass through polyfill (no manual JSON Schema conversion in this path)
- [ ] Own Zod validation on `invoke()` returns clean errors
- [ ] Disabled plugin gating works
- [ ] AbortSignal cleanup works
- [ ] All 12 tests pass

---

## Slice 5: Capability Registry

**Goal:** Named service exposure between plugins (`sdk.plugins.expose` / `sdk.plugins.get`).

**Dependencies:** Slice 1.

**File:** `packages/core/src/services/capability-registry.ts`

```typescript
export class CapabilityRegistry {
	private capabilities = new Map<string, Map<string, Record<string, unknown>>>();

	expose(pluginId: string, capabilityName: string, implementation: Record<string, unknown>): void;
	get(pluginId: string): Record<string, any> | null;
	removePlugin(pluginId: string): void;
}
```

**Behavior:**

- `get(pluginId)` returns a flat object merging all capability implementations for the plugin, or `null` if none.
- Re-exposing the same capability name replaces the previous implementation.

**Tests:**

1. `expose` + `get` — returns exposed capabilities
2. `get` for unknown plugin — returns `null`
3. `removePlugin` — capabilities no longer accessible
4. Multiple capabilities from same plugin — all returned as a merged object

**Acceptance criteria:**

- [ ] All 4 tests pass

---

## Slice 6: Contribution Registry

**Goal:** Zone-based UI extension registry with error-strike isolation.

**Dependencies:** Slice 1.

**File:** `packages/core/src/services/contribution-registry.ts`

```typescript
export const KNOWN_ZONES = [
	"dashboard.widget",
	"statusBar.right",
	"statusBar.left",
	"profile.menu",
	"settings.section",
] as const;
export type Zone = (typeof KNOWN_ZONES)[number];

export interface Contribution {
	pluginId: string;
	component: unknown;
	label: string;
	size?: string;
	priority: number;
}

export class ContributionRegistry {
	private readonly STRIKE_THRESHOLD = 3;

	register(
		pluginId: string,
		zone: string,
		options: {
			component: unknown;
			label: string;
			size?: string;
			priority?: number;
		},
	): void;

	getForZone(zone: Zone): Contribution[];
	strike(pluginId: string): void;
	isDisabled(pluginId: string): boolean;
	removePlugin(pluginId: string): void;
	resetStrikes(pluginId: string): void;

	/** Subscribe to registry mutations. Fires after register / removePlugin / strike / resetStrikes.
	 *  Used by React consumers via useSyncExternalStore in Slice 16.4. */
	onChange(handler: () => void): () => void;
}
```

**Behavior:**

- Registering to an unknown zone throws: `Error('Unknown contribution zone: "${zone}". Valid: ...')`.
- `priority` defaults to 0.
- `getForZone` filters out contributions from struck-out plugins (`isDisabled`), sorted by priority descending.
- Strike count session-scoped (memory only, resets on restart).
- `removePlugin` removes contributions AND resets strikes.
- `onChange` handlers are invoked synchronously after any mutation. Errors in handlers are caught + logged (do not affect other subscribers).

**Tests:**

1. `register` + `getForZone` — contribution appears
2. Unknown zone — throws descriptive error
3. Priority sorting (descending)
4. 3 strikes → plugin disabled, contributions excluded
5. 2 strikes → still enabled
6. `removePlugin` — contributions removed
7. `resetStrikes` — plugin re-enabled
8. Multiple plugins in same zone — struck-out ones excluded
9. `onChange` fires after `register`, `removePlugin`, `strike`, and `resetStrikes`; unsubscribe fn stops firing

**Acceptance criteria:**

- [ ] All 9 tests pass

---

## Slice 7: Intent Dispatcher + Command Registry

**Goal:** Declarative navigation, action routing, and command palette registrations.

**Dependencies:** Slice 1.

### 7.1 IntentDispatcher

**File:** `packages/core/src/services/intent-dispatcher.ts`

```typescript
import type { IntentDeclaration } from "../manifest/types.js";

export interface IntentCatalogEntry {
	plugin: string;
	name: string;
	type: "navigation" | "action";
	params: Record<string, string>;
	risk?: "read" | "write" | "destructive";
}

export class IntentDispatcher {
	private navigationHandler:
		((pluginId: string, intent: string, params: Record<string, unknown>) => void) | null = null;

	registerIntents(pluginId: string, intents: IntentDeclaration[]): void;
	removePlugin(pluginId: string): void;
	list(): IntentCatalogEntry[];

	setNavigationHandler(
		handler: (pluginId: string, intent: string, params: Record<string, unknown>) => void,
	): void;
	registerActionHandler(
		pluginId: string,
		action: string,
		handler: (params: Record<string, unknown>) => Promise<unknown>,
	): void;

	navigate(targetPlugin: string, intent: string, params?: Record<string, unknown>): void;
	dispatch(
		targetPlugin: string,
		action: string,
		params?: Record<string, unknown>,
	): Promise<unknown>;
}
```

**Behavior:**

- `navigate` and `dispatch` throw with descriptive errors if the target plugin hasn't declared the intent/action, or if no handler is registered (for dispatch).
- Removing a plugin removes both catalog entries AND action handlers.

### 7.2 CommandRegistry

**File:** `packages/core/src/services/command-registry.ts`

```typescript
export interface Command {
	id: string; // Full: `${pluginId}.${commandId}`
	pluginId: string;
	label: string;
	handler: () => void | Promise<void>;
}

export class CommandRegistry {
	register(
		pluginId: string,
		definition: { id: string; label: string; handler: () => void | Promise<void> },
	): void;
	all(): Command[];
	execute(fullId: string): Promise<void>;
	removePlugin(pluginId: string): void;
}
```

**Tests:**

IntentDispatcher tests (7 cases):

1. `registerIntents` + `list` — intents in catalog
2. `navigate` valid intent — handler called with params
3. `navigate` undeclared intent — throws
4. `dispatch` valid action — handler called, result returned
5. `dispatch` undeclared action — throws
6. `dispatch` declared but no handler — throws
7. `removePlugin` — intents removed

CommandRegistry tests (3 cases):

1. `register` + `all` — command with namespaced ID
2. `execute` — handler called
3. `removePlugin` — commands removed

**Acceptance criteria:**

- [ ] All 10 tests pass

---

## Slice 8: IPC Router

**Goal:** `sdk.ipc` implementation — plugin ↔ Electron main process, with local handler shortcut.

**Dependencies:** Slice 1.

**File:** `packages/core/src/services/ipc-router.ts`

```typescript
export interface IpcBridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

export class IpcRouter {
  constructor(private bridge: IpcBridge);

  handle(pluginId: string, channel: string, handler: (...args: any[]) => unknown | Promise<unknown>): void;
  removeHandler(pluginId: string, channel: string): void;
  removePlugin(pluginId: string): void;
  invoke(pluginId: string, channel: string, ...args: unknown[]): Promise<unknown>;
}
```

**Behavior (per `docs/transfer/05-lessons-and-decisions.md` §4):**

- Two routing paths only: local handler → main-process bridge fallback. **No cross-plugin routing via IPC.**
- If `${pluginId}:${channel}` is registered, invoke locally.
- Otherwise, forward to `bridge.invoke(prefixedChannel, ...args)` where `prefixedChannel = ${pluginId}:${channel}` (so main process knows the origin).
- Handler errors propagate to the caller (unlike EventBus which swallows).

**Tests:**

1. `handle` + `invoke` — local handler called, result returned
2. `invoke` with no local handler — forwards to bridge
3. `removeHandler` — subsequent invoke forwards to bridge
4. `removePlugin` — all handlers removed
5. Handler throws — error propagated to caller
6. Async handler awaited correctly

**Acceptance criteria:**

- [ ] All 6 tests pass
- [ ] No cross-plugin routing via IPC (would be an architectural violation)

---

## Slice 9: SDK Factory + Dispose Tracking

**Goal:** Implement `createSdk(pluginId, services)` — creates a scoped, plugin-specific SDK instance that wires all Wave 2 services and tracks registrations for automatic cleanup.

**Dependencies:** Slices 2, 3, 4, 5, 6, 7, 8. (All Wave 2 services except Loader.)

### 9.1 CoreServices interface

**File:** `packages/core/src/services/types.ts`

```typescript
import type { EventBus } from "./event-bus.js";
import type { StateBroker } from "./state-broker.js";
import type { ToolRegistry } from "./tool-registry.js";
import type { CapabilityRegistry } from "./capability-registry.js";
import type { ContributionRegistry } from "./contribution-registry.js";
import type { IntentDispatcher } from "./intent-dispatcher.js";
import type { CommandRegistry } from "./command-registry.js";
import type { IpcRouter } from "./ipc-router.js";

export interface CoreServices {
	eventBus: EventBus;
	stateBroker: StateBroker;
	toolRegistry: ToolRegistry;
	capabilityRegistry: CapabilityRegistry;
	contributionRegistry: ContributionRegistry;
	intentDispatcher: IntentDispatcher;
	commandRegistry: CommandRegistry;
	ipcRouter: IpcRouter;
}
```

### 9.2 `createSdk()` factory

**File:** `packages/core/src/sdk/create-sdk.ts`

```typescript
import type { SDK } from "@anaconda-agentic-desktop/sdk";
import type { CoreServices } from "../services/types.js";

export function createSdk(pluginId: string, services: CoreServices): SDK;
```

**Wiring rules:**

| SDK method                            | Wires to                                                                          | Cleanup registered?                         |
| ------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------- |
| `sdk.tools.register(def)`             | `services.toolRegistry.register(pluginId, def)`                                   | Yes — `unregisterPlugin(pluginId)`          |
| `sdk.tools.invoke/from/all/getApp`    | Direct pass-through to `toolRegistry`                                             | —                                           |
| `sdk.events.emit(event, payload)`     | `services.eventBus.emit('${pluginId}.${event}', payload)` (auto-prefix)           | —                                           |
| `sdk.events.on(event, handler)`       | `services.eventBus.on(event, handler)`                                            | Yes — unsubscribe fn                        |
| `sdk.events.off`                      | Direct pass-through                                                               | —                                           |
| `sdk.state.register(name, val, opts)` | `services.stateBroker.register(pluginId, name, val, opts)`                        | Yes — `removeByPlugin(pluginId)` on destroy |
| `sdk.state.get/peek/schema`           | Direct pass-through                                                               | —                                           |
| `sdk.plugins.expose(cap, impl)`       | `services.capabilityRegistry.expose(pluginId, cap, impl)`                         | Yes — `removePlugin(pluginId)`              |
| `sdk.plugins.get(pid)`                | Direct pass-through                                                               | —                                           |
| `sdk.contribute(zone, opts)`          | `services.contributionRegistry.register(pluginId, zone, opts)`                    | Yes — `removePlugin(pluginId)`              |
| `sdk.navigate(intent)`                | `services.intentDispatcher.navigate(intent.plugin, intent.intent, intent.params)` | —                                           |
| `sdk.dispatch(intent)`                | `services.intentDispatcher.dispatch(intent.plugin, intent.action, intent.params)` | —                                           |
| `sdk.commands.register(def)`          | `services.commandRegistry.register(pluginId, def)`                                | Yes — `removePlugin(pluginId)`              |
| `sdk.intents.list()`                  | `services.intentDispatcher.list()`                                                | —                                           |
| `sdk.ipc.handle(ch, h)`               | `services.ipcRouter.handle(pluginId, ch, h)`                                      | Yes — `removePlugin(pluginId)`              |
| `sdk.ipc.invoke(ch, ...args)`         | `services.ipcRouter.invoke(pluginId, ch, ...args)`                                | —                                           |
| `sdk.onDispose(fn)`                   | Push `fn` to disposables stack                                                    | —                                           |
| `sdk.destroy()`                       | Pop & invoke all disposables in reverse; mark SDK inert                           | —                                           |

**Services added by later slices** (`sdk.notifications`, `sdk.theme`, `sdk.fs`): initially throw `Error('sdk.notifications requires NotificationService — enable Slice 13')`. Each later slice updates `createSdk` to wire its own service and extends `CoreServices`.

**Post-destroy:** all SDK methods throw `Error('SDK for plugin "${pluginId}" has been destroyed')`.

**Tests (`packages/core/src/sdk/create-sdk.test.ts`):**

1. `sdk.pluginId` returns correct ID
2. `sdk.tools.register` → registered in ToolRegistry under correct namespace
3. `sdk.events.emit('foo', data)` → emitted as `'pluginId.foo'`
4. `sdk.events.on('other.event', h)` → h called when event emitted
5. `sdk.state.register` → store created with correct namespace
6. `sdk.plugins.expose` + `get` — capability accessible
7. `sdk.contribute` + `services.contributionRegistry.getForZone` — contribution present
8. `sdk.commands.register` → in command registry with namespaced ID
9. `sdk.ipc.handle` + `invoke` — local handler wins
10. `sdk.onDispose(fn)` + `destroy` — fn called
11. `destroy` — all auto-registrations reversed (tools, events, state, contributions, commands, IPC handlers, capabilities)
12. `destroy` — disposables invoked in reverse order
13. Post-destroy method call throws
14. `sdk.notifications.show` before Slice 13 — throws "requires NotificationService"

**Acceptance criteria:**

- [ ] All 14 tests pass
- [ ] Every implemented service wired, unimplemented services throw with clear error
- [ ] Full cleanup on destroy verifiable
- [ ] SDK inert after destroy

---

## Slice 10: Plugin Loader + Version Check

**Goal:** Plugin discovery (bundled + dynamic) and version compatibility checking.

**Dependencies:** Slice 1.

### 10.1 PluginSource abstraction

**File:** `packages/core/src/loader/plugin-loader.ts`

```typescript
import type { PluginManifest } from '../manifest/types.js';

export interface PluginModule {
  register: (sdk: any) => void;
  mount?: (sdk: any, container: HTMLElement) => void;
}

export interface PluginSource {
  discoverManifests(): Promise<PluginManifest[]>;
  loadModule(manifest: PluginManifest): Promise<PluginModule>;
}

export class BundledPluginSource implements PluginSource {
  constructor(private plugins: Record<string, { manifest: PluginManifest; module: PluginModule }>);
  discoverManifests(): Promise<PluginManifest[]>;
  loadModule(manifest: PluginManifest): Promise<PluginModule>;
}

export class DynamicPluginSource implements PluginSource {
  constructor(private baseUrl: string);
  discoverManifests(): Promise<PluginManifest[]>;
  loadModule(manifest: PluginManifest): Promise<PluginModule>;
}
```

**Behavior:**

- `BundledPluginSource`: manifests/modules passed at construction (build-time known).
- `DynamicPluginSource`: `fetch` for manifests, `import(url)` for modules.
- Both validate that loaded module exports `register: Function`. Reject with descriptive error otherwise.
- Both reject if `module.register()` returns a Promise (async register is prohibited per lessons doc §2).

### 10.2 Version check

**File:** `packages/core/src/loader/version-check.ts`

```typescript
export interface VersionCheckInput {
	pluginVersion: string;
	shellVersion: string;
	pluginMinShellVersion?: string;
	shellMinPluginVersion?: string;
}

export interface VersionCheckResult {
	compatible: boolean;
	errors: string[];
}

export function checkVersionCompatibility(input: VersionCheckInput): VersionCheckResult;
```

Implements minimal semver comparison (parse `major.minor.patch`, compare tuples). Rules:

- If `pluginMinShellVersion` set: `shellVersion >= pluginMinShellVersion` required.
- If `shellMinPluginVersion` set: `pluginVersion >= shellMinPluginVersion` required.
- Invalid semver → incompatible with parse error.

**Tests:**

Plugin loader tests (4 cases):

1. `BundledPluginSource.discoverManifests` — returns registered manifests
2. `BundledPluginSource.loadModule` — returns module for valid ID
3. Module without `register` — rejected with clear error
4. `register()` returns Promise — rejected

Version check tests (5 cases):

1. Compatible versions
2. Plugin requires higher shell version — incompatible
3. Shell requires higher plugin version — incompatible
4. No constraints — always compatible
5. Invalid semver — incompatible with parse error

**Acceptance criteria:**

- [ ] All 9 tests pass

---

## Slice 11: Shell Orchestrator + Boot Sequence

**Goal:** The orchestrator that ties services + SDK factory + loader + manifest validation into a boot pipeline.

**Dependencies:** Slices 9, 10.

**File:** `packages/core/src/shell/orchestrator.ts`

```typescript
import type { PluginManifest } from "../manifest/types.js";
import type { SDK } from "@anaconda-agentic-desktop/sdk";
import type { PluginSource } from "../loader/plugin-loader.js";
import type { CoreServices } from "../services/types.js";

export interface BootResult {
	registered: string[];
	rejected: Array<{ id: string; reason: string }>;
	failed: Array<{ id: string; error: string }>;
}

export interface OrchestratorOptions {
	shellVersion: string;
	shellMinPluginVersion?: string;
	devMode?: boolean;
	services?: Partial<CoreServices>; // For testing / injection
	ipcBridge?: IpcBridge; // For IpcRouter
	themeSource?: ThemeSource; // For ThemeService (Slice 14); if omitted, sdk.theme methods throw
}

export class ShellOrchestrator {
	constructor(options: OrchestratorOptions);

	boot(sources: PluginSource[]): Promise<BootResult>;
	getSdk(pluginId: string): SDK | undefined;
	getServices(): CoreServices;
	mount(pluginId: string, container: HTMLElement): void;
	destroyPlugin(pluginId: string): void;
	dispose(): void;

	/** Attach a CanvasManager for plugin UI mounting. Called by the shell after construction (see Slice 12). */
	attachCanvasManager(canvasManager: CanvasManager): void;
	/** Get the attached CanvasManager, or null if not yet attached. */
	getCanvasManager(): CanvasManager | null;
}
```

**Boot sequence** (per `docs/transfer/00-architecture-overview.md`):

1. Call `installModelContext()` (from Slice 4).
2. Construct all `CoreServices` if not injected.
3. For each source, `discoverManifests()`.
4. For each manifest sequentially:
   a. `validateManifest(raw)` → if fails, add to `rejected`
   b. `checkVersionCompatibility(...)` → if fails, add to `rejected`
   c. `services.intentDispatcher.registerIntents(id, intents)`
   d. `source.loadModule(manifest)` → if fails, add to `failed`
   e. Create `sdk = createSdk(id, services)`, store in map
   f. Try `module.register(sdk)` in try/catch → if throws, add to `failed`
   g. If synchronous `.then` detected on return → reject as async register
5. In dev mode, after all plugins registered, log `console.warn` for each key in `services.stateBroker.getUnresolvedKeys()`.
6. Return `BootResult`.

**Mount phase:**

- `mount(pluginId, container)` looks up the loaded module. If `module.mount` exists, calls `module.mount(sdk, container)`. Headless plugins are no-ops.

**Destroy:**

- `destroyPlugin(id)` → calls `sdk.destroy()`, removes from all services (`toolRegistry.unregisterPlugin`, `intentDispatcher.removePlugin`, etc.).
- `dispose()` → destroys all plugins, calls `cleanupModelContext()`.

**Tests (`packages/core/src/shell/orchestrator.browser.test.ts`, Vitest browser mode):**

1. Boot with one valid plugin → in `registered`, SDK created
2. Boot with invalid manifest → in `rejected`
3. Boot with plugin that throws in `register()` → in `failed`, others unaffected
4. Boot with incompatible version → in `rejected`
5. `destroyPlugin` — SDK destroyed, tools unregistered, events cleaned
6. `dispose` — all plugins destroyed, modelContext cleaned
7. **Integration:** Plugin A registers a tool, Plugin B invokes it via `sdk.tools.invoke` → success
8. **Integration:** Plugin registers state, another `sdk.state.get`s it before/after → lazy resolution works

**Acceptance criteria:**

- [ ] Full boot lifecycle works end-to-end
- [ ] Errors isolated per plugin (one failure doesn't cascade)
- [ ] All 8 tests pass

---

## Slice 12: Canvas Manager + PluginErrorBoundary UI

**Goal:** DOM container management for plugin UIs (lazy mount, CSS show/hide) + themed error boundary component.

**Dependencies:** Slice 11.

### 12.1 CanvasManager

**File:** `packages/core/src/ui/canvas-manager.ts`

```typescript
export interface CanvasManagerOptions {
  root: HTMLElement;
  onMount: (pluginId: string, container: HTMLElement) => void;
  onError: (pluginId: string, error: Error) => void;
}

export class CanvasManager {
  constructor(private options: CanvasManagerOptions);

  show(pluginId: string): void;
  hideAll(): void;
  getContainer(pluginId: string): HTMLElement | null;
  remove(pluginId: string): void;
  getActive(): string | null;
}
```

**Behavior:**

- Containers: `<div class="plugin-container" data-plugin-id="${id}" style="width:100%;height:100%">`.
- CSS navigation via `style.display = 'none' | 'block'` (never remount).
- `show()` on first call creates the container, appends to `root`, calls `onMount(pluginId, container)`.
- Subsequent `show()` for the same plugin only toggles display.

### 12.2 PluginErrorBoundary React component

Install `react-error-boundary` in `apps/web/package.json` if not already present:

```bash
pnpm --filter @anaconda-agentic-desktop/web add react-error-boundary
```

**File:** `apps/web/src/lib/components/plugin-error-boundary.tsx`

```tsx
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
	pluginId: string;
	pluginName?: string;
	onError?: (error: Error) => void;
	fallback?: (props: FallbackProps) => ReactNode;
	children: ReactNode;
}

function DefaultFallback({
	pluginId,
	pluginName,
	resetErrorBoundary,
}: FallbackProps & { pluginId: string; pluginName?: string }) {
	return (
		<div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card p-6 text-card-foreground">
			<AlertTriangle className="h-8 w-8 text-destructive" />
			<h3 className="text-sm font-medium">Plugin crashed</h3>
			<p className="text-xs text-muted-foreground">
				"{pluginName ?? pluginId}" encountered an error and has been stopped.
			</p>
			<Button variant="outline" size="sm" onClick={resetErrorBoundary}>
				Retry
			</Button>
		</div>
	);
}

export function PluginErrorBoundary({ pluginId, pluginName, onError, fallback, children }: Props) {
	return (
		<ErrorBoundary
			onError={(error) => onError?.(error)}
			fallbackRender={
				fallback ??
				((fp) => <DefaultFallback {...fp} pluginId={pluginId} pluginName={pluginName} />)
			}
		>
			{children}
		</ErrorBoundary>
	);
}
```

**Note:** React error boundaries catch errors in the render/lifecycle phase only — not in event handlers or async code. For those, plugins must catch errors themselves and either surface via `sdk.notifications` or throw during render to trigger the boundary.

### 12.3 Wire CanvasManager into ShellOrchestrator

Slice 11's `ShellOrchestrator` already declares `attachCanvasManager(cm: CanvasManager): void` and `getCanvasManager(): CanvasManager | null`. Implement them in this slice:

- **State:** private `canvasManager: CanvasManager | null = null`.
- **`attachCanvasManager(cm)`:** stores the reference. Also connects `IntentDispatcher.setNavigationHandler` to call `cm.show(pluginId)` on navigation intents.
- **`getCanvasManager()`:** returns the stored reference (or null).
- **`mount(pluginId, container)`:** unchanged — looks up the loaded module and calls `module.mount(sdk, container)` if defined. The CanvasManager's `onMount` callback (supplied by the shell) delegates to this method.
- **`dispose()`:** if a `canvasManager` is attached, remove all its containers before disposing services.

Attachment happens post-construction because the shell must build the CanvasManager with a `root: HTMLElement` that only exists after React renders the plugin-root `<main>`. See Slice 16.5 for the wiring.

**Tests:**

CanvasManager (`packages/core/src/ui/canvas-manager.browser.test.ts`, Vitest browser mode, 7 cases):

1. `show` first time — creates container, calls `onMount`
2. `show` second time (same plugin) — does not call `onMount`
3. `show` different plugin — hides previous, shows new
4. `hideAll` — all hidden
5. `remove` — container removed from DOM
6. Container has `data-plugin-id` attribute
7. `getActive` — returns currently shown plugin

PluginErrorBoundary (`plugin-error-boundary.browser.test.tsx`, Vitest browser mode + `@testing-library/react`, 2 cases):

1. Renders children when no error
2. Renders themed fallback + calls `onError` when a child component throws during render

**Acceptance criteria:**

- [ ] Containers created lazily
- [ ] CSS-based show/hide (no remounts)
- [ ] Error boundary uses `@anaconda/shadcn-theme` tokens
- [ ] All 9 tests pass

---

## Slice 13: NotificationService + Toast UI

**Goal:** Implement `sdk.notifications` (backend service + toast component).

**Dependencies:** Slice 9 (SDK Factory).

### 13.1 NotificationService

**File:** `packages/core/src/services/notification-service.ts`

```typescript
export interface Notification {
	pluginId: string;
	title: string;
	message: string;
	type: "info" | "success" | "warning" | "error";
	timestamp: number;
}

export class NotificationService {
	show(
		pluginId: string,
		opts: { title: string; message: string; type: Notification["type"] },
	): void;
	setBadge(pluginId: string, count: number): void;
	getBadge(pluginId: string): number;
	onNotification(handler: (notification: Notification) => void): () => void;
	onBadgeChange(handler: (pluginId: string, count: number) => void): () => void;
}
```

### 13.2 Wire into SDK factory

Extend `CoreServices` with `notificationService`. In `createSdk`, wire:

- `sdk.notifications.show(opts)` → `services.notificationService.show(pluginId, opts)`
- `sdk.notifications.setBadge(count)` → `services.notificationService.setBadge(pluginId, count)`

### 13.3 Toast UI

**File:** `apps/web/src/lib/components/toast-notifications.tsx`

Renders toasts fixed bottom-right. Subscribes to `NotificationService.onNotification` (via `useEffect`). Auto-dismiss after 5s (or 8s for errors).

```tsx
import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import type { Notification, NotificationService } from "@anaconda-agentic-desktop/core";
import { cn } from "@/utils";

interface ToastItem extends Notification {
	id: string;
}

interface Props {
	service: NotificationService;
}

const ICONS = {
	info: Info,
	success: CheckCircle2,
	warning: AlertTriangle,
	error: AlertCircle,
} as const;

export function ToastNotifications({ service }: Props) {
	const [toasts, setToasts] = useState<ToastItem[]>([]);

	useEffect(() => {
		const unsub = service.onNotification((n) => {
			const id = crypto.randomUUID();
			setToasts((prev) => [...prev, { ...n, id }]);
			const ttl = n.type === "error" ? 8000 : 5000;
			setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), ttl);
		});
		return unsub;
	}, [service]);

	const dismiss = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

	return (
		<div className="pointer-events-none fixed bottom-4 right-4 flex flex-col gap-2 z-50">
			{toasts.map((toast) => {
				const Icon = ICONS[toast.type];
				return (
					<div
						key={toast.id}
						className={cn(
							"pointer-events-auto flex items-start gap-3 rounded-lg border border-border bg-card p-4 shadow-lg animate-in slide-in-from-right",
							toast.type === "error" && "border-destructive/50",
							toast.type === "success" && "border-green-500/50",
							toast.type === "warning" && "border-yellow-500/50",
						)}
					>
						<Icon className="h-4 w-4 mt-0.5 shrink-0" />
						<div className="flex-1 min-w-0">
							<p className="text-sm font-medium text-card-foreground">{toast.title}</p>
							{toast.message && <p className="text-xs text-muted-foreground">{toast.message}</p>}
						</div>
						<button
							className="text-muted-foreground hover:text-foreground"
							onClick={() => dismiss(toast.id)}
							aria-label="Dismiss"
						>
							<X className="h-4 w-4" />
						</button>
					</div>
				);
			})}
		</div>
	);
}
```

**Tests:**

NotificationService (3 cases): same as before.

Toast UI (`toast-notifications.browser.test.tsx`, Vitest browser mode + `@testing-library/react`, 2 cases):

1. Toast appears when `service.show()` is called
2. Toast auto-dismisses after timeout (use `vi.useFakeTimers()`)

**Acceptance criteria:**

- [ ] All 5 tests pass
- [ ] Toast uses theme tokens
- [ ] Fixed to viewport, stacks correctly

---

## Slice 14: ThemeService

**Goal:** Implement `sdk.theme` — an observable theme subscription over the existing `LocalApi` theme system. Reuses `apps/web/src/features/theme/ThemeSync.tsx` and its `applyTheme(state)` helper — do NOT duplicate the `.dark`-class toggling.

**Dependencies:** Slice 9.

### 14.1 ThemeService

**File:** `packages/core/src/services/theme-service.ts`

```typescript
import type { SdkTheme } from '@anaconda-agentic-desktop/sdk';

export interface ThemeSource {
  peek(): 'dark' | 'light';
  subscribe(fn: (theme: 'dark' | 'light') => void): () => void;
  getTokens(): Record<string, string>;
  /** Tear down any upstream subscriptions (e.g., LocalApi listeners). Called by ThemeService.dispose(). */
  dispose(): void;
}

export class ThemeService implements SdkTheme {
  constructor(private source: ThemeSource);

  peek(): 'dark' | 'light';
  subscribe(fn: (theme: 'dark' | 'light') => void): () => void;
  getEffective(): 'dark' | 'light';
  getTokens(): Record<string, string>;

  /** Called by ShellOrchestrator.dispose(). Cascades to source.dispose(). */
  dispose(): void;
}
```

### 14.2 App-layer adapter over LocalApi

**File:** `apps/web/src/features/theme/theme-source.ts`

Bridges the existing `LocalApi.theme` subscription to the `ThemeSource` interface. **Does not toggle `.dark`** — `ThemeSync` (already rendered in `App.tsx`) handles that. This source is a read/subscribe observable over the same events.

```typescript
import type { LocalApi, ThemeState } from "@anaconda-agentic-desktop/contracts";
import type { ThemeSource } from "@anaconda-agentic-desktop/core";

export function createThemeSource(api: LocalApi): ThemeSource {
	let current: "dark" | "light" = "light";
	let disposed = false;
	const listeners = new Set<(t: "dark" | "light") => void>();

	const apply = (state: ThemeState) => {
		if (disposed) return;
		current = state.shouldUseDarkColors ? "dark" : "light";
		for (const fn of listeners) fn(current);
	};

	// Initial value + subscribe to changes via LocalApi
	void api.theme.get().then(apply);
	const unsubscribeFromApi = api.theme.onChanged(apply);

	return {
		peek: () => current,
		subscribe: (fn) => {
			fn(current); // Emit initial value immediately (observable contract)
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		getTokens: () => {
			const style = getComputedStyle(document.documentElement);
			const keys = [
				"background",
				"foreground",
				"primary",
				"primary-foreground",
				"secondary",
				"secondary-foreground",
				"muted",
				"muted-foreground",
				"accent",
				"accent-foreground",
				"destructive",
				"border",
				"input",
				"ring",
				"card",
				"card-foreground",
				"popover",
				"popover-foreground",
			];
			return Object.fromEntries(keys.map((k) => [k, style.getPropertyValue(`--${k}`).trim()]));
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			unsubscribeFromApi();
			listeners.clear();
		},
	};
}
```

**`ShellOrchestrator.dispose()`** cascades: if `themeService` exists, call `themeService.dispose()` (which calls `source.dispose()`). This guarantees the `api.theme.onChanged` subscription is released on unmount, avoiding leaks when `ShellProvider`'s effect re-runs.

### 14.3 React hook

**File:** `apps/web/src/lib/hooks/use-theme.ts`

```typescript
import { useStore } from "./use-store.js";
import type { ThemeService } from "@anaconda-agentic-desktop/core";

/** Returns 'dark' | 'light', re-renders on change. */
export function useTheme(service: ThemeService) {
	return useStore(service);
}
```

### 14.4 Wire into SDK factory

Extend `CoreServices` with `themeService`. `sdk.theme` returns it directly (already implements `SdkTheme`).

The orchestrator constructor receives a `ThemeSource` (created via `createThemeSource(useLocalApi())` at boot) and wraps it in `new ThemeService(source)`.

**Tests (`apps/web/src/features/theme/theme-source.browser.test.tsx`, browser env, 5 cases):**

1. `peek` returns current theme (matches `LocalApi.theme.get()`)
2. `subscribe` fires initial value immediately, then on `api.theme.onChanged` events
3. `getTokens` returns non-empty object with expected keys after `@anaconda/shadcn-theme` loads
4. Unsubscribe (from `subscribe`) removes listener
5. `dispose()` unsubscribes from `api.theme.onChanged` (verified via spy) and stops applying updates to remaining subscribers

**Acceptance criteria:**

- [ ] Observable contract obeyed (initial value emitted on subscribe)
- [ ] No duplication of `.dark` toggling — `ThemeSync` remains the sole class-toggler
- [ ] `dispose()` releases the `LocalApi` subscription (no leak on re-mount)
- [ ] `useTheme` hook re-renders components on theme change
- [ ] All 5 tests pass

---

## Slice 15: SdkFs (Sandboxed Filesystem)

**Goal:** Implement `sdk.fs` — plugin-scoped filesystem access with path traversal prevention.

**Dependencies:** Slice 9.

### 15.1 SdkFs class

**File:** `packages/core/src/services/sdk-fs.ts`

```typescript
import type { SdkFs as SdkFsInterface } from '@anaconda-agentic-desktop/sdk';
import type { IpcBridge } from './ipc-router.js';

export class SdkFs implements SdkFsInterface {
  constructor(
    private pluginId: string,
    private ipcBridge: IpcBridge,
  );

  /** String-only guard: rejects `..` segments and absolute paths.
   *  Full path resolution + userData-directory containment happens in the main process. */
  private assertSafeRelative(relativePath: string): void;

  readFile(relativePath: string): Promise<string>;
  writeFile(relativePath: string, content: string): Promise<void>;
  exists(relativePath: string): Promise<boolean>;
  mkdir(relativePath: string): Promise<void>;
  readdir(relativePath: string): Promise<string[]>;
  remove(relativePath: string): Promise<void>;
}
```

**Behavior:**

- Runs in the renderer where `node:path` is unavailable, so validation is string-only:
  - Reject if `relativePath` is empty, starts with `/`, matches `^[a-zA-Z]:[\\/]` (Windows absolute), or begins with `\\` / `//` (UNC).
  - Reject if any `/`- or `\`-separated segment equals `..`.
  - Throw `Error('Path traversal not allowed: ${relativePath}')` on any failure.
- Forward the raw relative path + `pluginId` to the main process via `ipcBridge.invoke('plugin-fs:${op}', { pluginId, path: relativePath, ... })`.
- **Defense in depth:** the main process (Slice 15.2) re-validates and resolves against `path.join(app.getPath('userData'), 'plugins', pluginId, 'data')` before touching the filesystem. Renderer-side guard is a fast fail; main-process guard is authoritative.
- Absolute paths passed as `rel` → throw.
- All filesystem operations delegated to main process via `ipcBridge.invoke('plugin-fs:${op}', pluginId, resolvedPath, ...)`.

### 15.2 Main-process IPC contracts + handlers

**File:** `packages/contracts/src/features/plugin-fs.ts` (new)

Add IPC contracts following the existing pattern (`packages/contracts/src/contract.ts`):

```typescript
import { z } from "zod";
import { defineMethod } from "../contract.js";

export const pluginFsMethods = {
	"plugin-fs:read": defineMethod(z.object({ pluginId: z.string(), path: z.string() }), z.string()),
	"plugin-fs:write": defineMethod(
		z.object({ pluginId: z.string(), path: z.string(), content: z.string() }),
		z.void(),
	),
	"plugin-fs:exists": defineMethod(
		z.object({ pluginId: z.string(), path: z.string() }),
		z.boolean(),
	),
	"plugin-fs:mkdir": defineMethod(z.object({ pluginId: z.string(), path: z.string() }), z.void()),
	"plugin-fs:readdir": defineMethod(
		z.object({ pluginId: z.string(), path: z.string() }),
		z.array(z.string()),
	),
	"plugin-fs:remove": defineMethod(z.object({ pluginId: z.string(), path: z.string() }), z.void()),
};
```

Register in `packages/contracts/src/registry.ts`:

```typescript
export const ipcMethods = mergeChannelMaps(
	shellMethods,
	themeMethods,
	todoMethods,
	pluginFsMethods,
);
```

Export from `packages/contracts/src/index.ts`: add `export * from './features/plugin-fs.js';`

**Handler:** `apps/desktop/src/main/features/plugin-fs/handlers.ts` — implements the six methods using Node `fs/promises`, with **path re-validation in the main process** (defense in depth — don't trust renderer's `resolve()`). Register the handlers in `apps/desktop/src/main/Application.ts` alongside existing feature handlers.

**Base directory resolution (main process):** each plugin's sandbox is `path.join(app.getPath('userData'), 'plugins', pluginId, 'data')`. The main handler validates that the resolved absolute path stays within that directory.

### 15.3 Wire into SDK factory

Extend `CoreServices` with a `createSdkFs(pluginId)` factory (Fs is per-plugin, unlike other singletons):

```typescript
// In CoreServices:
createSdkFs: (pluginId: string) => SdkFs;

// In createSdk:
const fs = services.createSdkFs(pluginId);
// sdk.fs = fs
```

The orchestrator supplies this factory: `(pluginId) => new SdkFs(pluginId, ipcBridge)`. No `baseDir` is passed — the main process owns the userData-relative resolution.

**Tests:**

1. `assertSafeRelative` with valid relative path (`'foo/bar.txt'`) — does not throw
2. `assertSafeRelative` with `../` traversal — throws
3. `assertSafeRelative` with absolute path (`/etc/passwd`, `C:\\Windows`, `\\\\server\\share`) — throws
4. `readFile` — delegates to IPC with `{ pluginId, path: relativePath }`
5. `writeFile` — delegates to IPC with `{ pluginId, path, content }`
6. Main-process handler (unit test) — resolves against userData plugin dir, rejects paths that escape after normalization

**Acceptance criteria:**

- [ ] Path traversal blocked in renderer (string guard) AND main process (path.resolve containment check)
- [ ] All 6 tests pass
- [ ] IPC contracts follow existing conventions

---

## Slice 16: Shell Layout (Sidebar + Contribution Zones + Root Layout)

**Goal:** The primary frontend composition slice. Renders plugin navigation, contribution zones, and wires the orchestrator into the React app root.

**Dependencies:** Slices 6, 11, 12, 13.

### 16.1 Install required shadcn/ui components

```bash
pnpm dlx shadcn@latest add badge separator tooltip
```

These land in `apps/web/src/lib/components/ui/`.

### 16.2 Plugin Nav Sidebar

**File:** `apps/web/src/lib/components/plugin-nav.tsx`

**Contract:** the parent component (`ShellProvider`, Slice 16.5) passes only navigation-capable plugins — those whose manifest declares at least one `type: 'navigation'` intent. Headless / backend-only plugins (tools-only, capabilities-only, contributions-only) are filtered out upstream and never reach this component. `PluginNav` itself does not re-filter; it renders every item in `plugins`.

```tsx
import type { LucideIcon } from "lucide-react";
import * as Icons from "lucide-react";
import { cn } from "@/utils";
import { Badge } from "@/components/ui/badge";

interface PluginNavItem {
	id: string;
	name: string;
	icon?: string; // Lucide icon name from manifest
	group?: string;
	brandAccentColor?: string;
}

interface Props {
	plugins: PluginNavItem[];
	activePluginId: string | null;
	badges: Record<string, number>;
	onNavigate: (pluginId: string) => void;
}

function iconFor(name?: string): LucideIcon {
	if (!name) return Icons.Package;
	// Lucide exports icons in PascalCase — manifest uses kebab or lowercase
	const key = name.replace(/(^|-)(.)/g, (_, __, ch) => ch.toUpperCase());
	return (Icons as Record<string, LucideIcon>)[key] ?? Icons.Package;
}

export function PluginNav({ plugins, activePluginId, badges, onNavigate }: Props) {
	// Group plugins by group field; ungrouped first
	const groups = new Map<string, PluginNavItem[]>();
	for (const p of plugins) {
		const key = p.group ?? "";
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key)!.push(p);
	}

	return (
		<nav className="flex w-56 flex-col gap-1 border-r border-border bg-sidebar p-2">
			{Array.from(groups.entries()).map(([groupName, groupPlugins]) => (
				<div key={groupName} className="flex flex-col gap-0.5">
					{groupName && (
						<span className="px-2 pt-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
							{groupName}
						</span>
					)}
					{groupPlugins.map((plugin) => {
						const Icon = iconFor(plugin.icon);
						const active = plugin.id === activePluginId;
						const badge = badges[plugin.id];
						return (
							<button
								key={plugin.id}
								onClick={() => onNavigate(plugin.id)}
								className={cn(
									"flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
									"hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
									active && "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
								)}
							>
								<Icon className="h-4 w-4 shrink-0" />
								<span className="flex-1 text-left truncate">{plugin.name}</span>
								{badge ? (
									<Badge variant="secondary" className="ml-auto">
										{badge}
									</Badge>
								) : null}
							</button>
						);
					})}
				</div>
			))}
		</nav>
	);
}
```

### 16.3 ContributionZone host

**File:** `apps/web/src/lib/components/contribution-zone.tsx`

Each contribution is a `component` (from `sdk.contribute(...)`). Plugins register a React component reference. Rendered inside `PluginErrorBoundary`. On error, `services.contributionRegistry.strike(pluginId)` is called via the `onStrike` prop.

```tsx
import { createElement, type ComponentType } from "react";
import type { Contribution, Zone } from "@anaconda-agentic-desktop/core";
import { PluginErrorBoundary } from "./plugin-error-boundary";

interface Props {
	zone: Zone;
	contributions: Contribution[];
	onStrike: (pluginId: string) => void;
	className?: string;
}

export function ContributionZone({ zone, contributions, onStrike, className }: Props) {
	return (
		<div className={className} data-zone={zone}>
			{contributions.map((c) => (
				<PluginErrorBoundary
					key={`${c.pluginId}:${c.label}`}
					pluginId={c.pluginId}
					pluginName={c.label}
					onError={() => onStrike(c.pluginId)}
				>
					{createElement(c.component as ComponentType<{ pluginId: string }>, {
						pluginId: c.pluginId,
					})}
				</PluginErrorBoundary>
			))}
		</div>
	);
}
```

**Note:** `sdk.contribute({ component, ... })` — `component` is typed as `unknown` in the SDK. For React plugins, plugins pass a `React.ComponentType`. The renderer casts it. Non-React frameworks would need their own zone host.

### 16.4 Contribution Zone hook

**File:** `apps/web/src/lib/hooks/use-contributions.ts`

Reactively read contributions for a zone. Uses `ContributionRegistry.onChange` (declared in Slice 6) to trigger re-renders when plugins register/unregister or strikes accumulate.

```typescript
import { useSyncExternalStore } from "react";
import type { ContributionRegistry, Zone, Contribution } from "@anaconda-agentic-desktop/core";

export function useContributions(registry: ContributionRegistry, zone: Zone): Contribution[] {
	return useSyncExternalStore(
		(onChange) => registry.onChange(onChange),
		() => registry.getForZone(zone),
		() => registry.getForZone(zone),
	);
}
```

### 16.5 Shell integration into App.tsx

**Existing:** `apps/web/src/App.tsx` currently renders `<ThemeSync /><Outlet />`. This slice extends it to boot the orchestrator and wrap the router `<Outlet />` in the plugin-system shell (sidebar + status bar + main canvas + toasts + command palette).

Add a **`ShellProvider`** component that:

1. Boots the orchestrator on mount using `useLocalApi()` and a bundled plugin registry.
2. Exposes the orchestrator + its services via React context.
3. Bridges TanStack Router navigation with `IntentDispatcher.setNavigationHandler`.

**File:** `apps/web/src/features/plugin-system/ShellProvider.tsx`

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import {
	ShellOrchestrator,
	BundledPluginSource,
	CanvasManager,
	type CoreServices,
	type PluginManifest,
} from "@anaconda-agentic-desktop/core";
import { useLocalApi } from "@/platform/LocalApiProvider";
import { createThemeSource } from "@/features/theme/theme-source";
import { BUNDLED_PLUGINS } from "./bundled-plugins"; // build-time map: id → { manifest, module }

interface ShellContextValue {
	orchestrator: ShellOrchestrator;
	services: CoreServices;
	plugins: PluginManifest[];
	badges: Record<string, number>;
	registerPluginRoot: (el: HTMLDivElement | null) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
	const ctx = useContext(ShellContext);
	if (!ctx) throw new Error("useShell must be used within ShellProvider");
	return ctx;
}

export function ShellProvider({ children }: { children: ReactNode }) {
	const api = useLocalApi();
	const router = useRouter();
	const [pluginRoot, setPluginRoot] = useState<HTMLDivElement | null>(null);
	const [state, setState] = useState<{
		orchestrator: ShellOrchestrator;
		services: CoreServices;
		plugins: PluginManifest[];
		badges: Record<string, number>;
	} | null>(null);

	useEffect(() => {
		if (!pluginRoot) return;

		// Plugin IPC bridge: raw window.desktopApi (Electron) or no-op (browser).
		// Deliberately NOT LocalApi — LocalApi is the app's high-level typed facade;
		// plugin-scoped IPC needs a generic invoke that the shell doesn't type-narrow.
		const bridge = globalThis.window?.desktopApi
			? {
					invoke: (channel: string, ...args: unknown[]) =>
						globalThis.window.desktopApi.invoke(channel as never, ...(args as [never])),
				}
			: {
					invoke: async () => {
						throw new Error("Plugin IPC unavailable in browser mode");
					},
				};

		const orch = new ShellOrchestrator({
			shellVersion: "0.1.0",
			devMode: import.meta.env.DEV,
			ipcBridge: bridge,
			themeSource: createThemeSource(api),
		});

		const canvasManager = new CanvasManager({
			root: pluginRoot,
			onMount: (id, container) => orch.mount(id, container),
			onError: (id) => orch.getServices().contributionRegistry.strike(id),
		});
		orch.attachCanvasManager(canvasManager); // Method declared in Slice 11, implemented in Slice 12.3

		// Wire navigation intents → router navigation
		orch.getServices().intentDispatcher.setNavigationHandler((pluginId) => {
			void router.navigate({ to: "/plugins/$pluginId", params: { pluginId } });
		});

		let unsubBadges: (() => void) | null = null;

		orch.boot([new BundledPluginSource(BUNDLED_PLUGINS)]).then((result) => {
			// Only plugins with at least one navigation intent are shown in the sidebar.
			// Headless / backend-only plugins (tools + capabilities only, no `type: 'navigation'` intent)
			// are still registered and their tools/capabilities/contributions work — they just have
			// no entry in the plugin nav. Their `icon` / `group` manifest fields are ignored.
			const plugins = result.registered
				.map((id) => BUNDLED_PLUGINS[id]?.manifest)
				.filter(
					(m): m is PluginManifest =>
						Boolean(m) && Boolean(m!.intents?.some((i) => i.type === "navigation")),
				);

			setState({ orchestrator: orch, services: orch.getServices(), plugins, badges: {} });

			unsubBadges = orch.getServices().notificationService.onBadgeChange((pluginId, count) => {
				setState((s) => (s ? { ...s, badges: { ...s.badges, [pluginId]: count } } : s));
			});
		});

		return () => {
			unsubBadges?.();
			orch.dispose();
			setState(null);
		};
	}, [api, pluginRoot, router]);

	// React to URL changes: /plugins/:pluginId → canvasManager.show(pluginId)
	useEffect(() => {
		if (!state) return;
		const canvasManager = state.orchestrator.getCanvasManager();
		if (!canvasManager) return;
		return router.subscribe("onResolved", ({ toLocation }) => {
			const match = toLocation.pathname.match(/^\/plugins\/([^/]+)/);
			if (match) canvasManager.show(match[1]);
		});
	}, [router, state]);

	if (!state) {
		return (
			<div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
				Loading plugins…
			</div>
		);
	}

	return (
		<ShellContext.Provider value={{ ...state, registerPluginRoot: setPluginRoot }}>
			{children}
		</ShellContext.Provider>
	);
}
```

**File:** `apps/web/src/App.tsx` (updated)

```tsx
import { Outlet } from "@tanstack/react-router";
import { ThemeSync } from "@/features/theme/ThemeSync";
import { ShellProvider } from "@/features/plugin-system/ShellProvider";
import { ShellLayout } from "@/features/plugin-system/ShellLayout";

export function App() {
	return (
		<>
			<ThemeSync />
			<ShellProvider>
				<ShellLayout>
					<Outlet />
				</ShellLayout>
			</ShellProvider>
		</>
	);
}
```

**File:** `apps/web/src/features/plugin-system/ShellLayout.tsx`

```tsx
import { useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PluginNav } from "@/components/plugin-nav";
import { ContributionZone } from "@/components/contribution-zone";
import { ToastNotifications } from "@/components/toast-notifications";
import { CommandPalette } from "@/components/command-palette";
import { useContributions } from "@/lib/hooks/use-contributions";
import { useShell } from "./ShellProvider";

export function ShellLayout({ children }: { children: ReactNode }) {
	const { services, plugins, badges, registerPluginRoot } = useShell();
	const params = useParams({ strict: false }) as { pluginId?: string };
	const activePluginId = params.pluginId ?? null;
	const leftContribs = useContributions(services.contributionRegistry, "statusBar.left");
	const rightContribs = useContributions(services.contributionRegistry, "statusBar.right");
	const strike = (id: string) => services.contributionRegistry.strike(id);

	return (
		<div className="flex h-screen bg-background text-foreground">
			<PluginNav
				plugins={plugins}
				activePluginId={activePluginId}
				badges={badges}
				onNavigate={(id) => services.intentDispatcher.navigate(id, "view")}
			/>
			<div className="flex flex-1 flex-col">
				<header className="flex h-10 items-center justify-between border-b border-border bg-background px-3">
					<ContributionZone
						zone="statusBar.left"
						contributions={leftContribs}
						onStrike={strike}
						className="flex items-center gap-2"
					/>
					<ContributionZone
						zone="statusBar.right"
						contributions={rightContribs}
						onStrike={strike}
						className="flex items-center gap-2"
					/>
				</header>
				<main ref={registerPluginRoot} className="relative flex-1 overflow-auto">
					{/* CanvasManager appends plugin containers here.
              Non-plugin routes (e.g., /) render via <Outlet /> alongside. */}
					{children}
				</main>
			</div>
			<ToastNotifications service={services.notificationService} />
			<CommandPalette registry={services.commandRegistry} />
		</div>
	);
}
```

### 16.6 Plugin route (TanStack file-based)

**File:** `apps/web/src/routes/plugins.$pluginId.tsx`

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/plugins/$pluginId")({
	component: () => null, // CanvasManager owns the DOM for the plugin; this route just parameterizes navigation
});
```

Regenerate `routeTree.gen.ts` by running `pnpm dev:web` — the `tanstackRouter` Vite plugin auto-regenerates it. (Commit the regenerated file.)

**Tests (`apps/web/src/components/*.browser.test.tsx`, Vitest browser mode + `@testing-library/react`):**

1. `PluginNav` renders icons + names + groups from manifest data
2. Clicking a nav item calls `onNavigate` with correct id
3. Active plugin has `bg-sidebar-accent` class
4. Badges display when count > 0
5. `ContributionZone` renders each contribution wrapped in error boundary
6. On contribution error, `onStrike` is called
7. **`ShellProvider` filters out headless plugins**: given a mix of manifests where one has `intents: [{ name: 'view', type: 'navigation', ... }]` and one has only action intents (or no intents), only the navigation-capable manifest is passed to `PluginNav`.

**Acceptance criteria:**

- [ ] All UI uses `@anaconda/shadcn-theme` tokens (no hardcoded colors)
- [ ] Dark mode toggle switches all colors via `.dark` on `<html>`
- [ ] Sidebar shows icons, names, groups, badges only for plugins with a navigation intent
- [ ] Headless / backend-only plugins are registered and functional but do NOT appear in the sidebar
- [ ] Contribution zones render + isolate errors
- [ ] All 7 tests pass

---

## Slice 17: Command Palette UI

**Goal:** Cmd+K / Ctrl+K command palette (React).

**Dependencies:** Slice 7 (CommandRegistry), Slice 9 (SDK Factory has commands wired).

### 17.1 Install shadcn/ui components

```bash
pnpm dlx shadcn@latest add dialog command
```

`command` provides the `Command`, `CommandInput`, `CommandList`, `CommandItem`, `CommandGroup`, `CommandEmpty` primitives (built on `cmdk`), which handle fuzzy filtering + keyboard navigation out of the box.

### 17.2 Component

**File:** `apps/web/src/lib/components/command-palette.tsx`

```tsx
import { useEffect, useState } from "react";
import type { CommandRegistry, Command as PluginCommand } from "@anaconda-agentic-desktop/core";
import {
	CommandDialog,
	CommandInput,
	CommandList,
	CommandEmpty,
	CommandGroup,
	CommandItem,
} from "@/components/ui/command";

interface Props {
	registry: CommandRegistry;
}

export function CommandPalette({ registry }: Props) {
	const [open, setOpen] = useState(false);
	const [commands, setCommands] = useState<PluginCommand[]>([]);

	// Global keyboard shortcut
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "k") {
				e.preventDefault();
				setOpen((prev) => !prev);
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, []);

	// Refresh command list when the palette opens (registry may have changed)
	useEffect(() => {
		if (open) setCommands(registry.all());
	}, [open, registry]);

	// Group commands by pluginId
	const groups = new Map<string, PluginCommand[]>();
	for (const cmd of commands) {
		if (!groups.has(cmd.pluginId)) groups.set(cmd.pluginId, []);
		groups.get(cmd.pluginId)!.push(cmd);
	}

	const execute = async (fullId: string) => {
		setOpen(false);
		await registry.execute(fullId);
	};

	return (
		<CommandDialog open={open} onOpenChange={setOpen}>
			<CommandInput placeholder="Search commands..." />
			<CommandList>
				<CommandEmpty>No commands found.</CommandEmpty>
				{Array.from(groups.entries()).map(([pluginId, cmds]) => (
					<CommandGroup key={pluginId} heading={pluginId}>
						{cmds.map((cmd) => (
							<CommandItem key={cmd.id} value={cmd.label} onSelect={() => execute(cmd.id)}>
								{cmd.label}
							</CommandItem>
						))}
					</CommandGroup>
				))}
			</CommandList>
		</CommandDialog>
	);
}
```

The shadcn `Command` primitives (built on `cmdk`) handle fuzzy filtering, keyboard navigation (↑/↓/Enter), and Esc-to-close automatically. Uses theme tokens throughout: `bg-popover`, `text-popover-foreground`, `hover:bg-accent`, `border-border` (all applied by shadcn's default styles for these primitives).

**Tests (`command-palette.browser.test.tsx`, Vitest browser mode, 5 cases):**

1. Cmd+K opens dialog
2. Typing filters commands (via cmdk's built-in filtering)
3. Enter executes highlighted command (via cmdk's `onSelect`)
4. Esc closes dialog
5. Commands grouped by plugin (each group has a heading)

**Acceptance criteria:**

- [ ] Keyboard shortcut works (both Cmd on Mac, Ctrl on Windows/Linux)
- [ ] Filtering + selection + execution work
- [ ] All 5 tests pass

---

## Slice 18: WebMCP External Relay (embed.js + CSP)

**Goal:** Load the `@mcp-b/webmcp-local-relay` embed.js and configure CSP so external AI agents (Kilo CLI, Claude Desktop, Cursor) can discover and invoke tools.

**Dependencies:** Slice 4.

### 18.1 embed.js script tag

**File:** `apps/web/index.html`

```html
<script
	src="https://cdn.jsdelivr.net/npm/@mcp-b/webmcp-local-relay@latest/dist/browser/embed.js"
	data-relay-host="127.0.0.1"
	defer
></script>
```

`defer` ensures it loads after DOM is ready — by then, the polyfill is installed and plugins have called `register()`.

### 18.2 CSP update

**File:** `apps/desktop/src/main/platform/ElectronSecurity.ts`

Extend the Content Security Policy:

- `script-src`: add `https://cdn.jsdelivr.net`
- `connect-src`: add `ws://127.0.0.1:*`, `http://127.0.0.1:*`, `https://cdn.jsdelivr.net`

Keep production CSP strict — no `'unsafe-eval'`.

### 18.3 Ordering guarantee

Verify in `apps/web/src/main.tsx` (or the router root) that the boot order is:

1. `installModelContext()` (from Slice 4) runs synchronously at module init.
2. Orchestrator boots plugins → tools registered.
3. embed.js loads via `defer` → reads tools from `navigator.modelContextTesting.listTools()`.

### 18.4 Integration test

**File:** `packages/core/src/services/webmcp-relay.integration.test.ts` (browser env — uses `@vitest/browser-playwright`; add to `packages/core/vitest.config.ts` browser project if needed)

Simulates embed.js reading from the polyfill:

1. Install polyfill, register tools via ToolRegistry
2. `navigator.modelContextTesting.listTools()` returns all tools (sync)
3. `navigator.modelContextTesting.executeTool(name, inputJson)` executes handler
4. `registerToolsChangedCallback(fn)` fires on tool add/remove
5. `document.modelContext.getTools()` returns same list (async path)

**Acceptance criteria:**

- [ ] embed.js script tag present, deferred
- [ ] CSP allows required origins
- [ ] Testing shim available for embed.js
- [ ] Integration test passes

---

## Slice 19: MCP Apps (Rich Visual Tool Responses)

**Goal:** Enrich tool responses with authenticated URLs to rich visual React components.

**Dependencies:** Slice 4.

**Theme:** the `/apps/shell` route must import `@anaconda/shadcn-theme` styles so app components use the same design tokens.

### 19.1 AppTokenManager

**File:** `packages/core/src/services/mcp-apps/token-manager.ts`

```typescript
export class AppTokenManager {
	private readonly TTL_MS = 5 * 60 * 1000;

	generate(pluginId: string, toolName: string): string;
	validate(token: string): { pluginId: string; toolName: string } | null;
	cleanup(): void;
}
```

Uses `crypto.randomUUID()`. In-memory map with expiry.

### 19.2 McpAppsResponseSerializer

**File:** `packages/core/src/services/mcp-apps/response-serializer.ts`

```typescript
export interface McpAppsContent { type: 'text' | 'app'; text?: string; url?: string; }
export interface McpAppsResponse { content: McpAppsContent[]; }

export class McpAppsResponseSerializer {
  constructor(
    private toolRegistry: ToolRegistry,
    private tokenManager: AppTokenManager,
    private baseUrl: string,
  );

  serialize(pluginId: string, toolName: string, result: unknown): McpAppsResponse;
}
```

**Behavior:**

- Always emits `{ type: 'text', text: JSON.stringify(result) }` first.
- If `toolRegistry.getApp(pluginId, toolName)` is non-null, generate token and append `{ type: 'app', url }`.
- URL: `${baseUrl}/apps/shell?token=${token}&component=/assets/${pluginId}/${toolName}.js&props=${encodeURIComponent(JSON.stringify(result))}`

### 19.3 `/apps/shell` route

**File:** `apps/web/src/routes/apps.shell.tsx` (TanStack Router file-based route — path `/apps/shell`)

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType } from "react";
import { PluginErrorBoundary } from "@/components/plugin-error-boundary";
import { useLocalApi } from "@/platform/LocalApiProvider";

export const Route = createFileRoute("/apps/shell")({
	component: AppsShell,
	validateSearch: (search: Record<string, unknown>) => ({
		token: (search.token as string) ?? "",
		component: (search.component as string) ?? "",
		props: (search.props as string) ?? "",
	}),
});

function AppsShell() {
	const { token, component: componentUrl, props: propsJson } = Route.useSearch();
	const [validated, setValidated] = useState<boolean | null>(null);
	const [Component, setComponent] = useState<ComponentType<any> | null>(null);

	useEffect(() => {
		if (!token || !componentUrl) return;
		// Validate token via raw bridge (LocalApi doesn't expose plugin-scoped channels)
		globalThis.window?.desktopApi
			?.invoke("mcp-apps:validate-token" as never, { token } as never)
			.then(async (result: any) => {
				if (!result?.ok || !result.value) {
					setValidated(false);
					return;
				}
				setValidated(true);
				const mod = await import(/* @vite-ignore */ componentUrl);
				setComponent(() => mod.default);
			});
	}, [token, componentUrl]);

	if (validated === false)
		return <div className="p-6 text-destructive">Invalid or expired token.</div>;
	if (!Component || !propsJson) return <div className="p-6 text-muted-foreground">Loading…</div>;

	const props = JSON.parse(decodeURIComponent(propsJson));

	return (
		<PluginErrorBoundary pluginId="mcp-app" pluginName="App">
			<Component {...props} />
		</PluginErrorBoundary>
	);
}
```

Regenerate `routeTree.gen.ts` by running `pnpm dev:web` — the `tanstackRouter` Vite plugin auto-regenerates it.

**IPC contract** in `packages/contracts/src/features/mcp-apps.ts` (new):

```typescript
import { z } from "zod";
import { defineMethod } from "../contract.js";

export const mcpAppsMethods = {
	"mcp-apps:validate-token": defineMethod(
		z.object({ token: z.string() }),
		z.object({ pluginId: z.string(), toolName: z.string() }).nullable(),
	),
};
```

Register in `packages/contracts/src/registry.ts` and export from `packages/contracts/src/index.ts`. Main-process handler in `apps/desktop/src/main/features/mcp-apps/handlers.ts` — calls `appTokenManager.validate(token)`.

### 19.4 Wire into ToolRegistry export path

Update the ToolRegistry's modelContext bridge: when a tool has an `app`, replace the raw `execute` wrapper with one that returns the serialized MCP Apps response.

**Tests:**

TokenManager (4 cases):

1. `generate` + `validate` — returns correct info
2. Expired token — `validate` returns `null`
3. Unknown token — `validate` returns `null`
4. `cleanup` removes expired entries

Serializer (4 cases):

1. Tool without `app` — response has only text
2. Tool with `app` — text + app content
3. App URL contains correct token / component / encoded props
4. Text content is `JSON.stringify(result)`

**Acceptance criteria:**

- [ ] Tokens time-limited and single-use
- [ ] Response always includes text
- [ ] App URL correctly formatted
- [ ] `/apps/shell` route validates tokens and renders
- [ ] All 8 tests pass

---

## Slice 20: Demo Plugin + End-to-End Integration Tests

**Goal:** Working demo plugin exercising the full system. Comprehensive integration test.

**Dependencies:** All slices 1–19.

### 20.1 Demo plugin

**Directory:** `plugins/demo-plugin/`

```
plugins/demo-plugin/
├── manifest.json
├── package.json
└── src/
    ├── index.tsx
    └── DemoWidget.tsx
```

**`manifest.json`:**

```json
{
	"id": "demo",
	"name": "Demo Plugin",
	"version": "1.0.0",
	"entry": "src/index.tsx",
	"capabilities": ["demoService"],
	"intents": [
		{ "name": "view", "type": "navigation", "params": {} },
		{ "name": "greet", "type": "action", "params": { "name": "string" }, "risk": "read" }
	],
	"icon": "sparkles",
	"group": "home"
}
```

**`src/index.tsx`:**

```tsx
import { z } from "@anaconda-agentic-desktop/sdk";
import { createRoot, type Root } from "react-dom/client";
import { StrictMode } from "react";
import { DemoWidget } from "./DemoWidget";
import type { SDK } from "@anaconda-agentic-desktop/sdk";

let root: Root | null = null;

export function register(sdk: SDK) {
	const greetingsState = sdk.state.register("greetings", [] as string[]);

	sdk.tools.register({
		name: "greet",
		description: "Generate a greeting for a person",
		input: z.object({
			name: z.string().describe("Name of the person to greet"),
			style: z.enum(["formal", "casual"]).optional(),
		}),
		handler: async ({ name, style = "casual" }) => {
			const greeting = style === "formal" ? `Good day, ${name}.` : `Hey ${name}!`;
			const current = (sdk.state.peek("demo.greetings") as string[]) ?? [];
			greetingsState.set([...current, greeting]);
			return { greeting, timestamp: Date.now() };
		},
	});

	sdk.plugins.expose("demoService", {
		getGreetings: () => sdk.state.peek("demo.greetings"),
	});

	sdk.contribute("dashboard.widget", {
		component: DemoWidget, // React component reference
		label: "Demo Widget",
		size: "small",
		priority: 50,
	});

	sdk.commands.register({
		id: "sayHi",
		label: "Demo: Say Hi",
		handler: () =>
			sdk.notifications.show({ title: "Hi!", message: "From demo plugin", type: "info" }),
	});

	sdk.onDispose(() => {
		root?.unmount();
		root = null;
	});
}

export function mount(sdk: SDK, container: HTMLElement) {
	root = createRoot(container);
	root.render(
		<StrictMode>
			<DemoWidget pluginId={sdk.pluginId} sdk={sdk} />
		</StrictMode>,
	);
}
```

**`src/DemoWidget.tsx`:**

```tsx
import { useState } from "react";
import type { SDK } from "@anaconda-agentic-desktop/sdk";

interface Props {
	pluginId: string;
	sdk?: SDK;
}

export function DemoWidget({ sdk }: Props) {
	const [greeting, setGreeting] = useState<string | null>(null);

	const sayHi = async () => {
		if (!sdk) return;
		const result = await sdk.tools.invoke("demo", "greet", { name: "World" });
		if (result.ok) setGreeting((result.value as { greeting: string }).greeting);
	};

	// Uses only Tailwind token classes from @anaconda/shadcn-theme (no @/ alias needed).
	// Plugins should not depend on apps/web internals; if a shared UI package is later
	// introduced (e.g., @anaconda-agentic-desktop/ui), plugins can import primitives from it.
	return (
		<div className="flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground">
			<h2 className="text-lg font-semibold">Demo Plugin</h2>
			<p className="text-sm text-muted-foreground">Hello from the demo plugin!</p>
			<button
				onClick={sayHi}
				className="rounded-md border border-border bg-background px-3 py-1 text-sm hover:bg-accent hover:text-accent-foreground"
			>
				Greet
			</button>
			{greeting && <p className="text-sm text-primary">{greeting}</p>}
		</div>
	);
}
```

**`package.json`:**

```json
{
	"name": "@anaconda-agentic-desktop/plugin-demo",
	"version": "1.0.0",
	"private": true,
	"type": "module",
	"main": "./src/index.tsx",
	"dependencies": {
		"@anaconda-agentic-desktop/sdk": "workspace:*",
		"react": "^19.2.8",
		"react-dom": "^19.2.8",
		"zod": "catalog:"
	},
	"devDependencies": {
		"@types/react": "^19.2.17",
		"@types/react-dom": "^19.2.3",
		"typescript": "catalog:"
	}
}
```

**Bundling note:** since plugins are consumed via `BundledPluginSource` at build time (statically imported by the shell), `react` and `@anaconda-agentic-desktop/sdk` are deduped by pnpm's workspace linker + Vite's `dedupe` config. Do not `pnpm install react` locally in the plugin — rely on workspace hoisting.

### 20.2 Headless plugin variant (backend-only)

To validate that headless plugins register + expose tools without appearing in the sidebar, add a second minimal plugin:

**Directory:** `plugins/tools-only/`

**`manifest.json`:**

```json
{
	"id": "tools-only",
	"name": "Tools-Only Plugin",
	"version": "1.0.0",
	"entry": "src/index.ts"
}
```

No `icon`, no `group`, no `intents`. Nothing that would make it appear in the sidebar.

**`src/index.ts`:**

```typescript
import { z } from "@anaconda-agentic-desktop/sdk";
import type { SDK } from "@anaconda-agentic-desktop/sdk";

export function register(sdk: SDK) {
	sdk.tools.register({
		name: "echo",
		description: "Echo the input string",
		input: z.object({ message: z.string() }),
		handler: async ({ message }) => ({ echoed: message }),
	});
}
// No mount() — headless plugin.
```

Add both plugins to `BUNDLED_PLUGINS`. The integration test in the next section asserts:

- `tools-only` appears in `result.registered`
- `tools-only_echo` is invocable via `document.modelContext`
- `tools-only` does NOT appear in the `plugins` array passed to `PluginNav` (verified by `ShellProvider` test)

### 20.3 Update `pnpm-workspace.yaml`

Add `plugins/*` to the existing workspace globs (currently `apps/*`, `packages/*`):

```yaml
packages:
  - apps/*
  - packages/*
  - plugins/*
```

### 20.4 Integration test

**File:** `packages/core/src/integration.browser.test.ts` (Vitest browser mode)

```typescript
test("full boot + tool invocation + AI discovery", async () => {
	installModelContext();
	const orchestrator = new ShellOrchestrator({
		shellVersion: "0.1.0",
		devMode: false,
		ipcBridge: mockBridge,
	});
	const result = await orchestrator.boot([
		new BundledPluginSource({ demo: { manifest, module: demoModule } }),
	]);

	expect(result.registered).toContain("demo");

	// 1. Tool invocation via SDK
	const otherSdk = orchestrator.getSdk("demo")!; // In real flow, another plugin's SDK
	const invokeResult = await otherSdk.tools.invoke("demo", "greet", { name: "Alice" });
	expect(invokeResult.ok).toBe(true);
	expect((invokeResult as any).value.greeting).toContain("Alice");

	// 2. State updated
	const greetings = otherSdk.state.peek("demo.greetings");
	expect(greetings).toEqual(["Hey Alice!"]);

	// 3. Capability accessible
	const cap = otherSdk.plugins.get("demo");
	expect(cap?.demoService.getGreetings()).toEqual(["Hey Alice!"]);

	// 4. Tool visible on modelContext
	const tools = await document.modelContext.getTools();
	expect(tools.map((t: any) => t.name)).toContain("demo_greet");

	// 5. Tool callable via modelContext (MCP format)
	const mcpResult = await document.modelContext.executeTool(
		{ name: "demo_greet" },
		JSON.stringify({ name: "Bob" }),
	);
	expect(mcpResult).toBeTruthy();
	expect(JSON.parse(mcpResult!).greeting).toContain("Bob");

	// 6. Testing shim (embed.js perspective)
	const shimTools = navigator.modelContextTesting!.listTools();
	expect(shimTools.map((t) => t.name)).toContain("demo_greet");

	// 7. Contribution registered
	const zoneContribs = orchestrator
		.getServices()
		.contributionRegistry.getForZone("dashboard.widget");
	expect(zoneContribs.some((c) => c.pluginId === "demo")).toBe(true);

	// 8. Headless plugin (tools-only) is registered and its tools are accessible
	expect(result.registered).toContain("tools-only");
	const echoResult = await document.modelContext.executeTool(
		{ name: "tools-only_echo" },
		JSON.stringify({ message: "hi" }),
	);
	expect(JSON.parse(echoResult!).echoed).toBe("hi");

	// 9. Cleanup
	orchestrator.destroyPlugin("demo");
	const toolsAfter = await document.modelContext.getTools();
	expect(toolsAfter.map((t: any) => t.name)).not.toContain("demo_greet");
});
```

### 20.5 E2E test (Playwright)

**File:** `apps/desktop/e2e/plugin-system.spec.ts`

- Launch app
- Verify demo plugin appears in sidebar (icon + name visible)
- Verify `tools-only` plugin does **not** appear in sidebar (no matching nav item)
- Click demo plugin nav → main content shows demo UI
- Open command palette (Cmd+K) → "Demo: Say Hi" visible → execute → toast appears
- Click demo plugin nav → main content shows demo UI
- Open command palette (Cmd+K) → "Demo: Say Hi" visible → execute → toast appears

**Acceptance criteria:**

- [ ] Demo plugin boots successfully
- [ ] All 9 integration test assertions pass
- [ ] E2E test passes
- [ ] Cleanup on destroy leaves no traces

---

## Dependency Graph

```
Wave 1:
  Slice 1 (Foundation)
     │
     ▼
Wave 2 (all parallel — up to 8 concurrent):
  Slice 2 (EventBus)     Slice 3 (StateBroker)     Slice 4 (ToolRegistry + Polyfill)
  Slice 5 (Capability)   Slice 6 (Contribution)    Slice 7 (Intent + Command)
  Slice 8 (IpcRouter)    Slice 10 (Loader + Version)
     │                       │
     ▼ (needs 2–8)            ▼ (needs 1)
Wave 3:
  Slice 9 (SDK Factory) ────► Slice 11 (Orchestrator, needs 9 + 10)
     │
     ▼ (Slices 12–19 need 11 or their specific service)
Wave 4 (up to 6 parallel):
  Slice 12 (Canvas + ErrorBoundary, needs 11)
  Slice 13 (Notifications + Toast, needs 9)
  Slice 14 (ThemeService, needs 9)
  Slice 15 (SdkFs, needs 9)
  Slice 17 (Command Palette, needs 7 + 9)
  Slice 18 (WebMCP Relay, needs 4)
  Slice 19 (MCP Apps, needs 4)
     │
     ▼ (needs 12, 13, 6, 11)
Wave 5:
  Slice 16 (Shell Layout — sidebar, zones, root layout wiring)
     │
     ▼ (needs everything)
Wave 6:
  Slice 20 (Demo Plugin + E2E Integration)
```

**Maximum theoretical parallelism per wave:**

- Wave 1: 1 agent
- Wave 2: 8 agents in parallel
- Wave 3: 2 agents sequentially (Slice 9 → Slice 11)
- Wave 4: 6 agents in parallel
- Wave 5: 1 agent
- Wave 6: 1 agent

**Total critical path:** 6 waves. With ideal parallelism, ~6 sequential steps.

---

## Notes for Implementing Agents

1. **Zod 4:** Use `z.toJSONSchema(schema)` (built-in). Zod 4 implements Standard Schema (`~standard.jsonSchema`), so `@mcp-b/webmcp-polyfill` accepts Zod schemas as `inputSchema` directly.

2. **WebMCP polyfill:** Do NOT hand-roll. Use `@mcp-b/webmcp-polyfill` + `@mcp-b/webmcp-types`. See Slice 4.

3. **Testing:**
   - Vitest with two projects: `unit` (node env, `*.test.ts`) and `browser` (Vitest browser mode via `@vitest/browser-playwright` + Chromium, `*.browser.test.ts` / `.tsx`).
   - Replicate the config pattern from `apps/web/vitest.config.ts` in `packages/core/vitest.config.ts`.
   - Non-DOM tests use Node env (default).
   - DOM tests (Slices 3.3, 4, 11, 12, 13, 14, 16, 17, 18, 19, 20) use Vitest browser mode.
   - Call `cleanupModelContext()` in `afterEach` for tests that install the polyfill.
   - `apps/web` already has `@testing-library/react` + `@testing-library/dom` in devDependencies.

4. **Module format:** ESM everywhere. `.js` extensions on relative imports in `.ts` files (Node ESM requirement). `.tsx` files use bundler resolution and can omit extensions.

5. **Path aliases:** New packages (`packages/core`, `packages/sdk`) use relative imports. The `apps/web` package uses `@/` → `src/` (configured in `vite.config.ts` and `tsconfig.json`). Cross-package imports use full package names (`@anaconda-agentic-desktop/contracts`, `@anaconda-agentic-desktop/core`, `@anaconda-agentic-desktop/sdk`).

6. **Runtime deps for `@anaconda-agentic-desktop/core`:** `zod` (catalog), `@mcp-b/webmcp-polyfill`, `@mcp-b/webmcp-types`, `@anaconda-agentic-desktop/sdk` (workspace). Do NOT depend on `react` — Core is UI-framework-agnostic. React components live in `apps/web/src/` where React is available.

7. **React 19:** Use `useSyncExternalStore` for subscribing to observable stores. Function components + hooks only. Slice 12 uses `react-error-boundary` (no manual class boundaries needed). `react-use` is available for utility hooks.

8. **Router:** TanStack Router (file-based). Routes live in `apps/web/src/routes/*.tsx`. `routeTree.gen.ts` is auto-generated by the `tanstackRouter` Vite plugin — regenerate by running `pnpm dev:web` and commit the result. Uses hash history (see `apps/web/src/router.tsx`). Navigate imperatively with `router.navigate({ to, params })` or subscribe to route changes with `router.subscribe('onResolved', ...)`.

9. **LocalApi vs desktopApi:**
   - `LocalApi` (`packages/contracts/src/local-api.ts`, accessed via `useLocalApi()`) is the **high-level typed facade** for the app's features (theme, todos, shell). Use it for feature integration (Slice 14 ThemeService).
   - `window.desktopApi` (the raw Electron bridge, only present in Electron) is what the plugin-scoped IPC Router (Slice 8) uses. `LocalApi` does not expose a generic invoke, so plugin channels (e.g., `plugin-fs:*`, `mcp-apps:*`) go through `desktopApi.invoke()` directly.
   - The browser adapter (`createBrowserLocalApi`) provides in-memory fallbacks for LocalApi features. Plugin-scoped IPC has no browser fallback — plugins that require main-process capabilities won't work in browser mode.

10. **Error philosophy:** Result envelopes for expected failures. Throws for programmer errors. React error boundaries catch render-phase errors only — async errors must be handled in the plugin's own code.

11. **SDK factory extension pattern:** Slice 9 initially installs throw-stubs for `sdk.notifications`, `sdk.theme`, and `sdk.fs` because their services don't exist yet. Each service slice (13, 14, 15) MUST replace its throw-stub in `packages/core/src/sdk/create-sdk.ts` with real wiring AND extend `CoreServices` in `packages/core/src/services/types.ts` with the new service. Do NOT leave throw-stubs behind after their owning slice ships. (In other words: stubs are a temporary handoff between Wave 3 and Wave 4, not a permanent state.)

12. **Existing IPC:** The workspace uses `defineMethod` / `defineEvent` / `mergeChannelMaps` in `packages/contracts/src/`. Slice 15 (SdkFs) and Slice 19 (MCP Apps token validation) add new contracts following this pattern. Register new methods in `packages/contracts/src/registry.ts` and export from `packages/contracts/src/index.ts`.

13. **UI theme:** All React components use `@anaconda/shadcn-theme` tokens (`bg-primary`, `text-muted-foreground`, `border-border`, etc.). Use `cn()` from `@/lib/utils`. Install shadcn/ui components via `pnpm dlx shadcn@latest add <name>` (run inside `apps/web/`) — do not hand-write primitives. Icons from `lucide-react`. shadcn style is `base-nova` (uses `@base-ui/react` primitives, not Radix).

14. **Existing `ThemeSync`:** `apps/web/src/features/theme/ThemeSync.tsx` already toggles `<html class="dark">` via `api.theme.onChanged`. Slice 14's `ThemeSource` layers an observable on top — it must NOT duplicate the class toggle.

15. **Plugin component contract:** Plugins pass React `ComponentType` values to `sdk.contribute({ component, ... })` and can mount their own React roots in `mount(sdk, container)` via `createRoot(container).render(...)`. Plugins are responsible for unmounting their roots — register the unmount in `sdk.onDispose(() => root.unmount())`.

16. **Shared React & SDK across plugins:** Plugins must NOT bundle their own copies of `react`, `react-dom`, or `@anaconda-agentic-desktop/sdk`. Configure the plugin's Vite build (if any) with these as `external`, and rely on workspace hoisting via pnpm + Vite's `dedupe: ['react', 'react-dom']` (already set in `apps/web/vitest.config.ts`). Bundled plugins (statically imported by Core) share by workspace linking; dynamic plugins would use import maps.

17. **Package naming:** `@anaconda-agentic-desktop/core`, `@anaconda-agentic-desktop/sdk`, `@anaconda-agentic-desktop/plugin-<name>`. Matches existing `@anaconda-agentic-desktop/{desktop,web,contracts}`. Root workspace is `anaconda-agentic-desktop`.

18. **Semver:** For Slice 10's version check, implement a minimal parser (`major.minor.patch` tuple compare) rather than pulling in `semver` — keep dependencies lean.

19. **Lint/format:** The workspace uses **oxlint + oxfmt** (not ESLint/Prettier). Run `pnpm lint`, `pnpm lint:fix`, `pnpm format`, `pnpm format:check` at the repo root. Do not add `.eslintrc` or `.prettierrc` files.

20. **TypeScript:** Version `7.0.2` (workspace catalog). If you encounter unfamiliar type errors, TS 7 is stricter about some patterns than TS 5; consult TS 7 release notes. `strict: true` and `verbatimModuleSyntax: true` are inherited from `tsconfig.base.json`.
