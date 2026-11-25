# Architecture

How Kilo Desktop is put together: the tech stack, the repository layout, and how the
Electron shell is hardened. Every feature is a plugin on a product-agnostic kernel:

- [CONTEXT.md](../CONTEXT.md) lists every package and plugin.
- [plugin-architecture.md](plugin-architecture.md) is the kernel and plugin design, and how
  to design a feature in its building blocks.
- [plugins/schema.md](plugins/schema.md) is the generated catalog of every plugin, extension
  point, domain object, object type and context key.
- [plugins/](plugins/README.md) is the guide to writing a plugin, with an
  [example plugin](../examples/hello-plugin) and [llms.txt](../llms.txt) for coding
  agents.

## Tech stack

| Layer           | Choice                                  | Notes                                                                                 |
| --------------- | --------------------------------------- | ------------------------------------------------------------------------------------- |
| Shell           | Electron 45 + Electron Forge 8          | Forge owns main/preload builds, packaging, makers, and S3 publishing                  |
| Plugins         | `packages/kernel`                       | Every feature is a plugin on a product-agnostic kernel (main + one kernel per window) |
| Renderer        | React 19 + TanStack Router              | Standalone Vite app under `apps/web`, loaded through the custom application protocol  |
| Styling         | Tailwind CSS 4 + shadcn Nova/Base UI    | In-app theme tokens (`packages/ui/src/themes`) and Inter                              |
| State           | Kernel domain objects + TanStack Query  | Plugins publish state and methods as typed domain objects shared across processes     |
| Validation      | Zod 4                                   | Domain-object and command contracts are Zod schemas in each plugin's `./contracts`    |
| Package manager | pnpm, hoisted linker                    | Workspace catalog pins shared versions; Forge receives a frozen production deployment |
| Testing         | Vitest 5 + Testing Library + Playwright | Unit tests, real-browser React tests, and packaged Electron smoke tests               |
| Git hooks       | Husky + lint-staged                     | Lint + format staged files on commit; lint, format and tsrs typecheck on push         |

## Repository layout

```text
/
├── apps/
│   ├── desktop/                # Electron main + preload: kernel host, platform services, Forge
│   └── web/                    # Renderer entry: boots a window kernel with the bundled plugins
├── packages/
│   ├── kernel/                 # Plugin kernel: registries, lifecycle, commands, React root
│   ├── bundled-plugins/        # The one list of plugins that ship
│   ├── ui/                     # Design-system primitives shared by every plugin
│   ├── git-client/             # Node-only git client
│   └── pane-layout/            # Pane layout model
├── plugins/                    # Bundled plugins (kilo.core, kilo.shell, kilo.chat, …)
├── examples/                   # Example plugins for authors (never bundled)
├── e2e/                        # Playwright/Electron e2e
├── pnpm-workspace.yaml         # Workspace globs, dependency catalog, pnpm settings
└── tsconfig.base.json          # Compiler options every package extends
```

- The host (`apps/*`) provides only `kernel/*` primitives (windows, storage, notifications,
  protocols…). Product features live in plugins, which reach each other through the kernel
  and import only another plugin's `./contracts`. `pnpm lint` checks these boundaries.
  CI also boots the bundled set with each plugin removed, and runs
  `pnpm check:plugin-isolation --build all` to build every bundled plugin outside the
  monorepo (a plain local run checks every plugin's manifest and imports but builds only
  `workspace-board` and the example plugins).
- A plugin that persists data owns its storage (its kv namespaces or files under its own
  storage directory). Nothing shares a database.
- `apps/desktop` gets the renderer as a built artifact: its `prepare:web` script runs the
  web build and asserts `apps/web/dist/index.html` exists. That script is hooked into
  `prepackage`, `premake`, and `prepublish`, and `config/stage-web-renderer.ts` copies the
  output into the packaged app.
- Shared dependency versions live in the pnpm catalog and are referenced as `catalog:`.
- `nodeLinker: hoisted` exists for Electron and Forge; packaging deploys a frozen
  production dependency tree instead of relying on symlinks (`pnpm deploy` no longer needs
  `injectWorkspacePackages`).
- Internal workspace deps always use the `workspace:*` protocol, consumed as TypeScript
  source. `link:` is reserved for the `overrides` section of `pnpm-workspace.yaml`.
- There are no TypeScript project references. Each package owns a `tsconfig.json` that
  extends `tsconfig.base.json` with `noEmit`, and `pnpm check` type-checks them
  independently.

## Running the web app standalone

```bash
pnpm dev:web   # http://127.0.0.1:5173, strict port
```

Without the preload bridge, the page boots the main kernel in-process next to the window
kernel; plugins whose main entry needs Node are skipped. `pnpm test:web` follows the same
split with two Vitest projects: `unit` runs `src/**/*.test.ts` in Node, and `browser` runs
`src/**/*.browser.test.tsx` and `src/**/*.app.test.tsx` in real headless Chromium via
Playwright. See
[TESTING.md](TESTING.md) for every test tier.

## Electron architecture and security

The renderer is sandboxed and has no Node.js access. The preload exposes only the kernel
bridge (`kernelBridge`); every request crosses one kernel transport in main, which checks
the sender and validates payloads against the target's declared contract.

Production navigation uses `kilo-desktop://app/#/`; development uses
`kilo-desktop-dev://app/#/`. OS deep links use the same scheme with a dedicated host (for
example, `kilo-desktop://models/install?model={modelId}` opens the Local Model Catalog). The
custom protocol serves the independently built web `dist` — staged into
`.vite/renderer/main_window` during packaging — or proxies the web Vite server in
development, with a strict Content Security Policy.

Forge creates an ASAR, includes `.vite`, package metadata, and required production
dependencies, and unpacks native modules (`better-sqlite3`, `node-pty`, keytar, …). The
fuses plugin disables RunAsNode, `NODE_OPTIONS`, and CLI inspector arguments while
enabling cookie encryption, ASAR integrity validation, and loading only from ASAR.
