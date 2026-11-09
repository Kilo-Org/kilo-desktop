<!-- Editing this file: keep it HIGH level — one line per package/plugin
describing what it IS, not a feature list. Feature detail belongs in the
plugin's own docs and code comments, not here. -->

# CONTEXT.md — Kilo Desktop

## What is this project?

An Electron desktop app (React renderer) built as plugins on a product-agnostic kernel. The design and the build-up plan live in [docs/plugin-architecture.md](./docs/plugin-architecture.md): the app boots from `packages/kernel` and every feature is a plugin (listed in `packages/bundled-plugins`). The host (`apps/*`) only provides `kernel/*` primitives. How to write a plugin: [docs/plugins](./docs/plugins/README.md) (with [examples/hello-plugin](./examples/hello-plugin) and the `write-plugin` skill).

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
├── pane-layout/  @kilo-desktop/pane-layout  Pane layout model shared by the workbench and its windows
└── vite-plugin-externalize-deps/            Vite plugin that keeps native/runtime deps out of the main bundle

e2e/              @kilo-desktop/e2e          Playwright/Electron e2e (plugin-aware)
examples/
└── hello-plugin/ @kilo-desktop/example-hello example.hello: the example plugin for authors — workspace-built and tested, never bundled
plugins/          Bundled plugins — self-contained workspace packages
├── shell/        @kilo-desktop/plugin-shell kilo.shell: window frame, router, settings host, command palette, app menu, appearance (kernel plugin)
├── flags/        @kilo-desktop/plugin-flags kilo.flags: LaunchDarkly feature flags as a domain object and `flag:` context keys (kernel plugin)
├── telemetry/    @kilo-desktop/plugin-telemetry kilo.telemetry: consented PostHog analytics for declared events, Privacy settings (kernel plugin)
├── updates/      @kilo-desktop/plugin-updates kilo.updates: About settings, release notes, the restart-to-update notice and the third-party notices (kernel plugin)
├── developer/    @kilo-desktop/plugin-developer kilo.developer: the Developer settings category and Diagnostics (kernel plugin)
├── agent/        @kilo-desktop/plugin-agent kilo.agent: Kilo CLI packaging, server lifecycle and configuration, Kilo chats, agent tool gateway and External AI apps (kernel plugin)
├── account/      @kilo-desktop/plugin-account kilo.account: the signed-in Kilo account, terms, sign-in and Account settings (kernel plugin)
├── workspaces/   @kilo-desktop/plugin-workspaces kilo.workspaces: workspaces, path authorisation and file watching (kernel plugin)
├── sessions/     @kilo-desktop/plugin-sessions kilo.sessions: Work Sessions and their Kilo chats (kernel plugin)
├── workbench/    @kilo-desktop/plugin-workbench kilo.workbench: the session list, launcher and open session's workbench (kernel plugin)
├── chat/         @kilo-desktop/plugin-chat kilo.chat: the agent pane — a session's chat transcript and composer over react-opencode (kernel plugin)
├── terminal/     @kilo-desktop/plugin-terminal kilo.terminal: terminal panes, shells run in main and shown in an embedded frame (kernel plugin)
├── git/          @kilo-desktop/plugin-git kilo.git: git for workspace folders — status, branches, worktrees, the Changes pane, pull requests and repository actions (kernel plugin)
├── files/        @kilo-desktop/plugin-files kilo.files: the Files pane (explorer and editor), file opener, `@` file mentions and links, the `open` tool (kernel plugin)
├── browser/      @kilo-desktop/plugin-browser kilo.browser: Browser panes on the host's embedded browser, URL and HTML-file openers, web links, the `open` tool (kernel plugin)
├── environments/ @kilo-desktop/plugin-environments kilo.environments: conda environments and packages through the bundled conda bridge — settings page, agent tools, plugin-owned environments (kernel plugin)
├── notebook/     @kilo-desktop/plugin-notebook kilo.notebook: nteract notebooks in panes over the runtimed daemon, `*.ipynb` opener, notebook agent tools and Kilo plugin (kernel plugin)
├── local-inference/ @kilo-desktop/plugin-local-inference kilo.local-inference: the Local Model Server — GGUF models through a managed llama.cpp router, published to Kilo as a provider and to the composer as a model source (kernel plugin)
├── kilo-marketplace/ @kilo-desktop/plugin-kilo-marketplace kilo.marketplace: Kilo's Marketplace of agents, skills and MCP servers — the Agent Behavior settings page (kernel plugin)
├── workspace-board/ @kilo-desktop/plugin-workspace-board kilo.workspace-board: the workspace board — sessions organised into named columns, a detachable sessions view of the workbench (kernel plugin)
└── anaconda-account/ @kilo-desktop/plugin-anaconda-account kilo.anaconda-account: the Anaconda account — browser sign-in, the Anaconda API key in the shared Anaconda keyring, the Account settings row (kernel plugin)
```

## Key architectural decisions

The design is [docs/plugin-architecture.md](./docs/plugin-architecture.md); in short:

- **Kernel and plugins.** `packages/kernel` runs one main kernel (Electron main) and one kernel per window, joined by one transport. It knows nothing about the product: it hosts the extension registry (extension points and their implementations), the domain registry (named objects with state, methods and events, provided in one process and used from any), commands, `when` conditions, lifecycle and services.
- **Plugins talk through the kernel.** A plugin's `plugin.json` (v1 manifest) declares what it provides and uses; another plugin is reached only through the kernel, and its `./contracts` export (types, domain and point definitions) is the one allowed import. `pnpm lint` runs `scripts/check-boundaries.mjs`.
- **The host provides primitives, not features.** `apps/desktop/src/main/kernel` and `apps/web/src/kernel` boot the kernels and provide `kernel/*` primitives (windows, storage and kv, files, notifications, protocols, embedded hosts, shell, updater…) behind manifest permissions. Plugins never import Electron or app code.
- **Registration.** Bundled plugins are listed once in `packages/bundled-plugins` and mapped to their entries in `apps/desktop/src/main/kernel/plugins.ts` and `apps/web/src/kernel/plugins.ts`.
- **Storage.** Each plugin owns its data under its own storage directory (kv stores, files); nothing shares a database. Plugins that replaced origin code import origin's saved data once (decision 37).

### Dependency ownership (host vs plugin)

**Tier 1 — Shared runtime set (host-owned singletons):** `react` / `react-dom`, `@kilo-desktop/kernel`, `@kilo-desktop/ui`, `@tanstack/react-query`, `zod` — two copies would break hooks, context or schema identity. Plugins declare them as `peerDependencies`. `@tanstack/react-router` is owned by kilo.shell; others navigate through its `kilo.shell/navigation` domain object. The Tailwind pipeline and theme token mappings belong to the renderer (`apps/web/src/globals.css` scans `packages/ui`, `packages/kernel` and `plugins/`).

**Tier 2 — Per-plugin runtime deps:** one plugin's implementation details, normal workspace deps.

**Tier 3 — Dev/test tooling:** per-plugin `devDependencies` (vitest, playwright, typescript, `@kilo-desktop/e2e`).

## Terminology

| Term                | Meaning                                                                                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kernel**          | `packages/kernel`: the product-agnostic plugin runtime (registries, lifecycle, commands, transport, React root).                                                                                                                                            |
| **Plugin**          | A package in `plugins/` with a v1 `plugin.json`, a `main` and/or `web` entry, and a `./contracts` export.                                                                                                                                                   |
| **Host**            | The apps that boot the kernels and provide `kernel/*` primitives (`apps/desktop`, `apps/web`).                                                                                                                                                              |
| **Extension point** | A typed slot a plugin declares (`<plugin>/<point>`) for other plugins to implement — additive, exclusive or a decision chain.                                                                                                                               |
| **Domain object**   | A named object (`<plugin>/<name>`) with state, methods and events, provided in one process and usable from any.                                                                                                                                             |
| **Work Session**    | A unit of work in a workspace (`kilo.sessions/work-session`, `WorkSession` in code), listed in the session list; owns its panes and layout and has zero or more chats.                                                                                      |
| **Chat Session**    | A session's conversation with the agent, backed by a Kilo session (`kilo.agent/conversation`). Use "chat" for the conversation, "session" for the container.                                                                                                |
| **Pane**            | A view in a Work Session's layout (agent, terminal, browser, files, changes, notebook…), contributed through `kilo.sessions/pane-kind`.                                                                                                                     |
| **Workbench**       | Each window's view of the Work Sessions (`kilo.workbench/workbench`): workspace focus, open session or sessions view, opening panes. Moving within the home view is the workbench's; leaving it (Settings, deep-linked pages) is kilo.shell's `Navigation`. |

## Conventions

- **TypeScript 7**, strict, `verbatimModuleSyntax: true`
- **ESM** everywhere (`"type": "module"`)
- **Zod 4** for schemas (workspace catalog `^4.4.3`)
- **React 19** — function components + hooks only
- **TanStack Router** (file-based, hash history) + **TanStack Query**
- **shadcn/ui** (`base-nova` style, `lucide-react` icons, `@base-ui/react` primitives) — primitives are owned source: keep them close to stock and edit them directly, marking each deviation with a `// local:` comment (`rg "local:" packages/ui/src/components` lists them). Convention: default child icons are `size-3.5` (stock `size-4`). Upgrade with `npx shadcn@latest add <name> --dry-run --diff -c packages/ui` and merge by hand; re-point stock's `cn` import to `@kilo-desktop/ui/lib/utils`. `packages/ui` is stock primitives plus a few composites shared across plugin boundaries (e.g. `SummaryCard`, `ColorSwatchPicker`); consistency comes from using stock parts without visual call-site overrides, not from new wrappers. A look repeated within one plugin is a local component in that plugin.
- **App themes** own the design tokens: palettes live in `APP_THEMES` (`packages/ui/src/themes/app-themes.ts`) and are injected as CSS custom properties; `apps/web/src/globals.css` maps them to Tailwind v4 utilities
- **Vitest** — `*.test.ts` (node unit), `*.integration.test.ts` (serial node), `*.browser.test.tsx` (Chromium component), `*.app.test.tsx` (full app tree)
- **Playwright e2e** — packaged Electron via `@anaconda/playwright-utils` in the root `e2e/` package; every plugin ships at least one `@smoke` spec
- **Coverage** — 80% lines/branches/functions/statements (`pnpm coverage`)
- **oxlint + oxfmt** (not ESLint/Prettier)
- **peerDependencies** for react, react-dom, zod in publishable packages
- Tests boot real kernels: `@kilo-desktop/kernel/testing` (`createTestKernelPair`, `createTestHost`), `@kilo-desktop/kernel/testing/plugin-host` (`createPluginHost` → `renderSlot`, `invoke`) and host plugins' `./testing` fixtures (e.g. `renderShell`)
- CI boots the bundled set with each plugin removed and builds every bundled plugin outside the monorepo (`pnpm check:plugin-isolation`): declare every import in the plugin's package.json
- Interactive elements use stable `data-qa-id` attributes (queried by Vitest browser + Playwright)
- Ids are qualified by their plugin: `<plugin-id>/<name>` for points, domain objects and commands
- Expected failures throw `KernelError` (its code and message survive the process boundary; other errors are scrubbed)

See [docs/TESTING.md](./docs/TESTING.md) for the full tier taxonomy and how to run each suite.

## What NOT to do

- Don't add product features to the host (`apps/*`)
- Don't import another plugin's source (only its `./contracts`) or anything from `apps/*`
- Don't copy shadcn/design-system components into plugins — import from `@kilo-desktop/ui`
- Don't share storage across plugins
- Don't use React Context for cross-plugin communication — use domain objects and extension points
- Don't use ESLint/Prettier (use oxlint/oxfmt)
