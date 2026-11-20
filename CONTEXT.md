<!-- Editing this file: keep it HIGH level — one line per package/plugin
describing what it IS, not a feature list. Feature detail belongs in the
plugin's own docs and code comments, not here. -->

# CONTEXT.md — Kilo Desktop

## What is this project?

An Electron desktop app (React renderer) built as plugins on a product-agnostic kernel. The design lives in [docs/plugin-architecture.md](./docs/plugin-architecture.md): the app boots from `packages/kernel` and every feature is a plugin (listed in `packages/bundled-plugins`), built from the same blocks — plugins, domain objects, object types, extension points and their contributions, commands, context keys and services. The host (`apps/*`) only provides `kernel/*` primitives. Every plugin, extension point, domain object, object type and context key is listed in the generated [docs/plugins/schema.md](./docs/plugins/schema.md). Design a feature in those blocks first ([Designing a feature](./docs/plugin-architecture.md#designing-a-feature), the `design-feature` skill), then build it: [docs/plugins](./docs/plugins/README.md) (with [examples/hello-plugin](./examples/hello-plugin) and the `write-plugin` skill).

## Architecture

```
apps/
├── desktop/   @kilo-desktop/desktop   Electron main + preload: the kernel host and its platform services
└── web/       @kilo-desktop/web       Renderer entry: boots a window kernel (in Electron or a standalone browser)

packages/
├── kernel/       @kilo-desktop/kernel       Plugin kernel: extension + domain registries, lifecycle, commands, services, React root
├── bundled-plugins/ @kilo-desktop/bundled-plugins The one list of plugins that ship, shared by main and renderer
├── ui/           @kilo-desktop/ui           Anaconda Design System primitives (shadcn) — shell-owned, ONE set shared by apps and plugins; never vendor copies
├── git-client/   @kilo-desktop/git-client   Node-only git client over the system git binary (resolved via `which` — no embedded binary); typed operations and error normalization ported from GitHub Desktop
├── pane-layout/  @kilo-desktop/pane-layout  Pane layout model shared by kilo.work-sessions and its windows
├── oxlint-plugin/ @kilo-desktop/oxlint-plugin Kilo Desktop's own oxlint rules that keep renderer code compilable by React Compiler
└── vite-plugin-externalize-deps/            Vite plugin that keeps native/runtime deps out of the main bundle

e2e/              @kilo-desktop/e2e          Playwright/Electron e2e (plugin-aware; kernel, kilo.core, kilo.shell, kilo.developer, kilo.work-sessions, kilo.chat, kilo.git, kilo.files, kilo.terminal, kilo.browser, kilo.notebook, kilo.marketplace, kilo.local-inference, kilo.environments, kilo.anaconda and kilo.workspace-board specs)
examples/
├── hello-plugin/ @kilo-desktop/example-hello example.hello: the example plugin for authors — workspace-built and tested, never bundled
└── right-panel-plugin/ @kilo-desktop/example-right-panel example.right-panel: example panels in the shell's right sidebar rail — never bundled
plugins/          Bundled plugins, in layers: kernel → kilo.core → kilo.shell → kilo.work-sessions → kilo.chat → features
├── anaconda/     @kilo-desktop/plugin-anaconda kilo.anaconda: the Anaconda account — browser sign-in, the Anaconda API key in the shared Anaconda keyring, its Account settings row — and Anaconda's model catalog for the Local Model Server
├── browser/      @kilo-desktop/plugin-browser kilo.browser: Browser panes — web pages, and a workspace's HTML files, in an embedded guest driven through the host's browser
├── chat/         @kilo-desktop/plugin-chat  kilo.chat: the chat pane — a work session's chats with the agent, drawn from kilo.core
├── core/         @kilo-desktop/plugin-core  kilo.core: the Kilo CLI server and everything it knows (data only, no UI)
├── core-v2/      @kilo-desktop/plugin-core-v2 kilo.core for the Kilo Code v2 server line: same id and contracts, chosen by KILO_SERVER_LINE (ADR-003)
├── developer/    @kilo-desktop/plugin-developer kilo.developer: Settings → Developer → Diagnostics, behind the `developer` flag
├── environments/ @kilo-desktop/plugin-environments kilo.environments: conda environments and packages through the bundled conda bridge, for the person and the agent
├── files/        @kilo-desktop/plugin-files kilo.files: the Files pane — browse, edit and mention the files in a work session's workspace folders
├── git/          @kilo-desktop/plugin-git   kilo.git: git for workspace folders — work sessions' isolation (`kilo.work-sessions/vcs`), the Changes pane, branches, repository actions, pull requests and cloning a repository into a new workspace
├── local-inference/ @kilo-desktop/plugin-local-inference kilo.local-inference: the Local Model Server — GGUF models on this device through a managed llama.cpp router, offered to Kilo as an AI provider and to the composer's model picker
├── marketplace/  @kilo-desktop/plugin-marketplace kilo.marketplace: Kilo's Marketplace of agents, skills and MCP servers — the Agent Behavior settings section
├── notebook/     @kilo-desktop/plugin-notebook kilo.notebook: Notebook panes — nteract notebooks over the runtimed daemon, the `*.ipynb` opener, notebook agent tools and Kilo plugin
├── shell/        @kilo-desktop/plugin-shell kilo.shell: the window and everything the user sees of kilo.core
├── terminal/     @kilo-desktop/plugin-terminal kilo.terminal: terminal panes — interactive shells (node-pty) in a work session's folder, drawn in an embedded frame
├── work-sessions/ @kilo-desktop/plugin-work-sessions kilo.work-sessions: workspaces, work sessions and their panes, and everything the user sees of them
└── workspace-board/ @kilo-desktop/plugin-workspace-board kilo.workspace-board: the workspace board — work sessions organised into named columns, a detachable work sessions view of kilo.work-sessions
```

## Key architectural decisions

The design is [docs/plugin-architecture.md](./docs/plugin-architecture.md); in short:

- **Plugins are product areas, in layers.** Dependencies only point down (kernel → `kilo.core` → `kilo.shell` → `kilo.work-sessions` → `kilo.chat` → features); where a lower layer needs something from a higher one, it declares an extension point. Declare an extension point only where something outside its owner contributes.
- **Kernel and plugins.** `packages/kernel` runs one main kernel (Electron main) and one kernel per window, joined by one transport. It knows nothing about the product: it hosts the extension registry (extension points and their implementations), the domain object registry (named objects with state, methods and events, provided in one process and used from any), object types, commands, `when` conditions, lifecycle and services.
- **Identity, flags and telemetry are kernel vocabulary.** `kernel/identity`, `kernel/flags` (and `kernel/flag:<id>` context keys) and `kernel/telemetry` name these concepts; vendors (the Kilo account, LaunchDarkly, PostHog) plug in from above through `kernel/identity-provider`, `kernel/linked-account`, `kernel/flag-source` and `kernel/telemetry-sink`. Plugins declare flags and events as `kernel/flag` and `kernel/telemetry-event` contributions.
- **Plugins talk through the kernel.** A plugin's `plugin.json` (v1 manifest) declares what it provides and uses; another plugin is reached only through the kernel, and its `./contracts` export (types, domain object, extension point and object type definitions) is the one allowed import. `pnpm lint` runs `scripts/check-boundaries.mjs`.
- **The host provides primitives, not features.** `apps/desktop/src/main/kernel` and `apps/web/src/kernel` boot the kernels and provide `kernel/*` primitives (windows, storage and kv, files, notifications, protocols, embedded hosts, OS open/reveal, updater…) behind manifest permissions. Plugins never import Electron or app code.
- **Registration.** Bundled plugins are listed once in `packages/bundled-plugins` and mapped to their entries in `apps/desktop/src/main/kernel/plugins.ts` and `apps/web/src/kernel/plugins.ts`.
- **Storage.** Each plugin owns its data under its own storage directory (kv stores, files); nothing shares a database. A plugin that replaced older code imports its saved data once (decision 37).

### Dependency ownership (host vs plugin)

**Tier 1 — Shared runtime set (host-owned singletons):** `react` / `react-dom`, `@kilo-desktop/kernel`, `@kilo-desktop/ui`, `@tanstack/react-query`, `zod` — two copies would break hooks, context or schema identity. Plugins declare them as `peerDependencies`. The Tailwind pipeline and theme token mappings belong to the renderer (`apps/web/src/globals.css` scans `packages/ui` and `packages/kernel`; plugin sources are added as plugins return).

**Tier 2 — Per-plugin runtime deps:** one plugin's implementation details, normal workspace deps.

**Tier 3 — Dev/test tooling:** per-plugin `devDependencies` (vitest, playwright, typescript, `@kilo-desktop/e2e`).

## Terminology

| Term                | Meaning                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kernel**          | `packages/kernel`: the product-agnostic plugin runtime (registries, lifecycle, commands, transport, React root).                                               |
| **Plugin**          | A package in `plugins/` with a v1 `plugin.json`, a `main` and/or `web` entry, and a `./contracts` export.                                                      |
| **Host**            | The apps that boot the kernels and provide `kernel/*` primitives (`apps/desktop`, `apps/web`).                                                                 |
| **Extension point** | A typed slot a plugin declares (`<plugin>/<point>`) for other plugins to implement — additive, exclusive or a decision chain.                                  |
| **Domain object**   | A named object (`<plugin>/<name>`) with state, methods and events, provided in one process and usable from any. Collections are plural and declare a `lookup`. |
| **Object type**     | The `type` of an `ObjectRef` (`{type, id}`), declared by the plugin that owns the concept and resolved by its collection.                                      |
| **Contribution**    | One entry in an extension point: metadata in `plugin.json`, plus an implementation bound in code when the extension point takes one.                           |
| **Context key**     | A named boolean condition for `when` clauses, declared by the plugin that owns the concept (`kernel/flag:<id>` for flags).                                     |
| **Work session**    | The unit in the sidebar: a workspace directory (or worktree) with panes; it can hold many chats. A **chat** is one Kilo session with the agent.                |

## Conventions

- **TypeScript 7**, strict, `verbatimModuleSyntax: true`
- **ESM** everywhere (`"type": "module"`)
- **Zod 4** for schemas (workspace catalog `^4.4.3`)
- **React 19** — function components + hooks only, every one compiled by React Compiler (Oxc, `react({ compiler: true })`). `pnpm lint` enforces it: oxlint's `react/*` compiler rules, the local `@kilo-desktop/oxlint-plugin` (`kilo/no-manual-memo` bans `useMemo`/`useCallback`/`"use no memo"`, `kilo/no-hookless-use-function`, `kilo/no-component-in-factory`) and `scripts/check-react-compiler.mjs` for syntax the compiler cannot lower. Write plain values; for identity use `useStableCallback`/`useStableValue` (`@kilo-desktop/ui/hooks/use-stable`) and `useLatestRef`; extension points take components, never hooks. The only `"use no memo"` wraps TanStack Virtual, allowlisted per file in `.oxlintrc.json`
- **TanStack Router** (file-based, hash history) + **TanStack Query**
- **shadcn/ui** (`base-nova` style, `lucide-react` icons, `@base-ui/react` primitives) — primitives are owned source: keep them close to stock and edit them directly, marking each deviation with a `// local:` comment (`rg "local:" packages/ui/src/components` lists them). Convention: default child icons are `size-3.5` (stock `size-4`). Upgrade with `npx shadcn@latest add <name> --dry-run --diff -c packages/ui` and merge by hand; re-point stock's `cn` import to `@kilo-desktop/ui/lib/utils`. `packages/ui` is stock primitives plus a few composites shared across plugin boundaries (e.g. `SummaryCard`, `ColorSwatchPicker`, `CopyButton`); consistency comes from using stock parts without visual call-site overrides, not from new wrappers. A look repeated within one plugin is a local component in that plugin.
- **App themes** own the design tokens: palettes live in `APP_THEMES` (`packages/ui/src/themes/app-themes.ts`) and are injected as CSS custom properties; `apps/web/src/globals.css` maps them to Tailwind v4 utilities
- **Vitest** — `*.test.ts` (node unit), `*.integration.test.ts` (serial node), `*.browser.test.tsx` (Chromium component), `*.app.test.tsx` (full app tree)
- **Playwright e2e** — packaged Electron via `@anaconda/playwright-utils` in the root `e2e/` package; every plugin ships at least one `@smoke` spec
- **Coverage** — 80% lines/branches/functions/statements (`pnpm coverage`)
- **oxlint + oxfmt** (not ESLint/Prettier)
- **peerDependencies** for react, react-dom, zod in publishable packages
- Tests boot real kernels: `@kilo-desktop/kernel/testing` (`createTestKernelPair`, `createTestHost`), `@kilo-desktop/kernel/testing/plugin-host` (`createPluginHost` → `renderSlot`, `invoke`) and host plugins' `./testing` fixtures
- CI boots the bundled set with each plugin removed and builds every bundled plugin outside the monorepo (`pnpm check:plugin-isolation`): declare every import in the plugin's package.json
- Interactive elements use stable `data-qa-id` attributes (queried by Vitest browser + Playwright)
- Ids are qualified by their plugin: `<plugin-id>/<name>` for extension points, domain objects, object types, context keys and commands
- After changing a `plugin.json` or a contract definition run `pnpm docs:schema` (`pnpm lint` checks `docs/plugins/schema.md` is current)
- Expected failures throw `KernelError` (its code and message survive the process boundary; other errors are scrubbed)

See [docs/TESTING.md](./docs/TESTING.md) for the full tier taxonomy and how to run each suite.

## What NOT to do

- Don't add product features to the host (`apps/*`)
- Don't import another plugin's source (only its `./contracts`) or anything from `apps/*`
- Don't copy shadcn/design-system components into plugins — import from `@kilo-desktop/ui`
- Don't share storage across plugins
- Don't use React Context for cross-plugin communication — use domain objects and extension points
- Don't use ESLint/Prettier (use oxlint/oxfmt)
