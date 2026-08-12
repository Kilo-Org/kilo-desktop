# Anaconda Agentic Desktop

Next-generation Anaconda Desktop built with Electron, React, and Electron Forge.

## Background

This repository implements the architecture described in
[Anaconda Desktop — Next-Gen Architecture](https://docs.google.com/document/d/1vx3IZwUsHUfjDWnI7Fhh05gLiRLBIV4WM4PxznHWpTY).

Docs:

- [Add a feature across every layer](docs/add-a-feature.md) — walkthrough of one vertical
  slice, from the shared contract to SQLite and back to the UI
- [Releases, signing, and CI reference](docs/releases.md) — channels, artifacts,
  environments, credentials

## Tech stack

| Layer           | Choice                                  | Notes                                                                                     |
| --------------- | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| Shell           | Electron 43 + Electron Forge 8 alpha    | Forge owns main/preload builds, packaging, makers, and S3 publishing                      |
| Renderer        | React 19 + TanStack Router              | Standalone Vite app under `apps/web`, loaded through the custom application protocol      |
| Styling         | Tailwind CSS 4 + shadcn Nova/Base UI    | Uses the Anaconda theme and Inter                                                         |
| State           | TanStack React Query                    | Query factories call a web-owned `LocalApi`; Electron or in-browser adapters implement it |
| Persistence     | better-sqlite3 13 + Drizzle ORM         | SQL migrations live in the desktop package                                                |
| Validation      | Zod 4                                   | Shared schemas in `packages/contracts` define the IPC boundary                            |
| Package manager | pnpm 11, hoisted linker                 | Workspace catalog pins shared versions; Forge receives a frozen production deployment     |
| Testing         | Vitest 5 + Testing Library + Playwright | Unit tests, real-browser React tests, and packaged Electron smoke tests                   |
| Git hooks       | Husky + lint-staged                     | Linting and formatting run before commit                                                  |

## Getting started

Use Node 24 or newer (`.nvmrc` pins the version CI uses) and the pnpm version declared
in `packageManager`.

The web app depends on `@anaconda/shadcn-theme`, and `pnpm-workspace.yaml` maps the
`@anaconda` scope to GitHub Packages, so install needs a token with `read:packages`. pnpm
ignores env-expanded credentials in a project-level `.npmrc`, so store the token in user
config. CI uses `actions/setup-node` with `NODE_AUTH_TOKEN` from the
`GH_DESIGN_SYSTEM_TOKEN` secret.

```bash
corepack enable
pnpm config set "//npm.pkg.github.com/:_authToken" <token-with-read:packages>
pnpm install --frozen-lockfile
pnpm start
```

`pnpm start` / `pnpm dev` run the web Vite server and Electron together. Electron proxies
the renderer through `anaconda-agentic-desktop-dev://app/#/` using
`ANACONDA_WEB_DEV_SERVER_URL`. Use `pnpm dev:web` for the React app alone (in-memory
`LocalApi`, no Electron).

Browser-mode web tests drive real Chromium, so install the browser once before
`pnpm test`:

```bash
pnpm --filter @anaconda-agentic-desktop/web exec playwright install chromium
```

The pinned Forge alpha publishes its POSIX CLI file without an executable mode, so the
root postinstall script normalizes that mode after pnpm links the hoisted dependency.

## Commands

Every command runs from the repository root; each one fans out to the relevant workspace
package with `pnpm --filter` or `pnpm -r`.

| Command               | Purpose                                                                |
| --------------------- | ---------------------------------------------------------------------- |
| `pnpm start`          | Start web + Electron (`dev:desktop`)                                   |
| `pnpm dev:web`        | Start the standalone React/Vite app                                    |
| `pnpm dev:desktop`    | Start web and Electron with the custom development protocol            |
| `pnpm run package`    | Build web, then package Electron into `apps/desktop/out/`              |
| `pnpm run make`       | Package the app and create the current platform’s distributables       |
| `pnpm run publish`    | Run release preflight, then make and upload with Forge’s S3 publisher  |
| `pnpm check`          | Type-check contracts, web, desktop, and E2E projects                   |
| `pnpm lint`           | Run oxlint                                                             |
| `pnpm format:check`   | Verify formatting                                                      |
| `pnpm test`           | Run package tests recursively (does not include E2E)                   |
| `pnpm test:web`       | Web unit + browser tests                                               |
| `pnpm test:desktop`   | Desktop unit tests                                                     |
| `pnpm test:contracts` | Contracts registry tests                                               |
| `pnpm test:e2e`       | Package the app and exercise the hardened executable through typed IPC |

Schema changes live with the feature/plugin that owns the database (Decision
#20 — each feature owns its own SQLite file and drizzle migrations). Generate
migrations from that package, e.g. the todos plugin:

```bash
pnpm --filter @anaconda-agentic-desktop/plugin-todos db:generate
```

## Monorepo layout

```text
/
├── apps/
│   ├── desktop/                # Electron main, preload, Forge, SQLite, E2E
│   │   ├── config/             # Release, signing, renderer staging, publish preflight
│   │   ├── drizzle/            # Generated SQL migrations and journal
│   │   ├── e2e/                # Playwright specs against the packaged binary
│   │   ├── resources/
│   │   └── src/{main,preload}/
│   └── web/                    # Standalone React/Vite application
│       └── src/
│           ├── components/     # shadcn Nova / Base UI primitives
│           ├── features/       # todos, theme (query factories + UI)
│           ├── lib/query/      # QueryClient factory
│           ├── platform/       # LocalApi + Electron/browser adapters
│           └── routes/         # TanStack Router file routes
├── packages/
│   └── contracts/              # Shared Zod schemas, typed IPC contracts, LocalApi
├── plugins/                    # Placeholder for the future plugin system
├── .github/
│   ├── actions/                # Shared CI setup (node, macOS/Windows codesign)
│   └── workflows/              # CI, build, and canary/staging/prod publish
├── pnpm-workspace.yaml         # Workspace globs, dependency catalog, pnpm settings
└── tsconfig.base.json          # Compiler options every package extends
```

`pnpm-workspace.yaml` declares only `apps/*` and `packages/*`, so there are exactly three
packages:

| Package                               | Path                 | Role                                                   |
| ------------------------------------- | -------------------- | ------------------------------------------------------ |
| `@anaconda-agentic-desktop/contracts` | `packages/contracts` | Shared schemas and types — the only shared code        |
| `@anaconda-agentic-desktop/web`       | `apps/web`           | Renderer; builds and runs on its own                   |
| `@anaconda-agentic-desktop/desktop`   | `apps/desktop`       | Electron shell, SQLite, Forge packaging and publishing |

Dependencies only ever point one way:

```text
web ─────────┐
             ├──→ contracts        (workspace:*, imported as source)
desktop ─────┘

desktop ──→ apps/web/dist          (build artifact, not a package dependency)
```

- Neither app imports the other. `apps/desktop` never imports React code, and `apps/web`
  never imports Electron or Node APIs.
- `apps/desktop` gets the renderer as a built artifact: its `prepare:web` script runs the
  web build and asserts `apps/web/dist/index.html` exists. That script is hooked into
  `prepackage`, `premake`, and `prepublish`, and `config/stage-web-renderer.ts` copies the
  output into the packaged app.
- Shared dependency versions live in the pnpm catalog (`typescript`, `vite`, `vitest`,
  `zod`) and are referenced as `catalog:` so both apps can never drift apart.
- `nodeLinker: hoisted` and `injectWorkspacePackages: true` exist for Electron and Forge;
  packaging deploys a frozen production dependency tree instead of relying on symlinks.
- There are no TypeScript project references. Each package owns a `tsconfig.json` that
  extends `tsconfig.base.json` with `noEmit`, and `pnpm check` type-checks them
  independently. Path aliases are per package (`@/*` → `apps/web/src`, `$config/*` →
  `apps/desktop/config`) and mirrored in the matching Vite and Vitest configs.

## Shared code

`packages/contracts` is the only shared package, and it is consumed as TypeScript source:
`exports` points at `./src/index.ts`, there is no build step and no `dist`, so each
consumer compiles it with its own bundler (Vite for web, the main and preload Vite builds
for desktop).

It exports:

| Export                                               | Purpose                                                 |
| ---------------------------------------------------- | ------------------------------------------------------- |
| `defineMethod`, `defineEvent`                        | Build a channel contract from Zod input/output schemas  |
| `ipcMethods`, `ipcEvents`, `mergeChannelMaps`        | Registries of every channel the app exposes             |
| `IpcResult`, `ipcResultSchema`, `ipcErrorCodes`      | The success/error envelope crossing the bridge          |
| `DesktopApi`, `IpcHandlers`, channel/payload helpers | Types for the preload surface and main-process handlers |
| `LocalApi`, `LocalApiError`                          | The host-facing facade the React app depends on         |
| `todo*`, `theme*`, `shell*` schemas                  | Per-feature payload shapes                              |

Belongs in contracts: anything both sides must agree on. Does not belong: React
components, Electron or Node imports, and the Drizzle table schema — persistence details
stay in `apps/desktop`.

[docs/add-a-feature.md](docs/add-a-feature.md) walks through adding a channel and following
it out to every layer.

## Web and Electron decoupling

`apps/web` is a normal Vite SPA with no compile-time or runtime dependency on Electron.
The rules that keep it that way:

- React and query code depends on the `LocalApi` interface only. `window.desktopApi` and
  IPC transport details appear nowhere outside `src/platform`.
- `apps/web/src/platform/createLocalApi.ts` selects the implementation by bridge presence
  (`globalThis.window?.desktopApi`), not by URL or protocol sniffing.
  `platform/electronLocalApi.ts` forwards through the preload bridge and unwraps
  `IpcResult`; `platform/browserLocalApi.ts` implements the same interface in memory.
- The web build uses `base: "./"` and hash history, so one `dist` works from a dev server
  and from `anaconda-agentic-desktop://app/#/`.
- Forge’s Vite plugin builds only main and preload (`renderer: []`). Electron owns no
  renderer build; it serves or proxies whatever the web app produced.
- The entire handshake is one artifact and one variable: `apps/web/dist` in production,
  `ANACONDA_WEB_DEV_SERVER_URL` in development.

The payoff: the UI is developed and tested in a plain browser, a different host (hosted
web, another shell) only needs one new `LocalApi` adapter, and changing an IPC channel is
a `packages/contracts` edit that fails `pnpm check` on both sides at once.

## Running the web app standalone

```bash
pnpm dev:web   # http://127.0.0.1:5173, strict port
```

Without the preload bridge, `createLocalApi()` returns the in-memory browser adapter:
todos live in an array with generated ids, theme follows `prefers-color-scheme`,
`shell.openExternal` becomes `window.open`, and `shell.copyText` becomes the async
clipboard API. No Electron process, no SQLite file, no IPC.

| Works standalone                                     | Requires `pnpm start` or `pnpm test:e2e`                          |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| Routing, layout, components, Tailwind/shadcn theming | SQLite persistence across reloads                                 |
| Query and mutation wiring against `LocalApi`         | Real IPC validation, error codes, and main-process business logic |
| Fast HMR with no Electron restart                    | Window behavior, protocol/CSP handling, updater, packaging        |

`pnpm test:web` follows the same split with two Vitest projects: `unit` runs
`src/**/*.test.ts` in Node, and `browser` runs `src/**/*.browser.test.tsx` in real
headless Chromium via Playwright. Both exercise the browser adapter, so the whole web
suite runs without building or launching Electron.

## Local Sentry via Spotlight

Local development **never** reports to the shared remote Sentry project: `initSentry()`
passes no DSN in dev, and `apps/desktop/.env.development` intentionally omits
`VITE_SENTRY_DSN`. To inspect errors, traces, and logs locally, use
[Spotlight](https://spotlightjs.com) — the SDK is configured with `spotlight: true`
in dev (both the Electron main process and the renderer), so it forwards events to a
local Spotlight sidecar.

Run the standalone Spotlight app, then start the desktop app:

```bash
npx @spotlightjs/spotlight   # sidecar + UI on http://localhost:8969
pn dev                        # in another terminal
```

The SDK forwards to the default sidecar at `http://localhost:8969/stream`. Optionally
wire Spotlight into an MCP-capable editor (Claude/Cursor) with
`npx -y @spotlightjs/spotlight mcp`. Spotlight is dev-only: the `spotlight`,
`sampleRate: 1.0`, and `enableLogs` flags are stripped from packaged builds, and no
`@spotlightjs/*` package ships in the app bundle.

## Electron architecture and security

The renderer is sandboxed and has no Node.js access. The preload exposes only the
schema-validated `window.desktopApi` surface, and the main process re-validates every
payload against the same contracts before handling it.

Production navigation uses `anaconda-agentic-desktop://app/#/`; development uses
`anaconda-agentic-desktop-dev://app/#/`. The custom protocol serves the independently
built web `dist` — staged into `.vite/renderer/main_window` during packaging — or proxies
the web Vite server in development, with a strict Content Security Policy.

Forge creates an ASAR, includes `.vite`, migrations, package metadata, and required
production dependencies, and unpacks `better-sqlite3`. The fuses plugin disables
RunAsNode, `NODE_OPTIONS`, and CLI inspector arguments while enabling cookie encryption,
ASAR integrity validation, and loading only from ASAR.

## Releases and distribution

`RELEASE_CHANNEL` accepts only publishable values. Local `pnpm start` / `pnpm dev` is
unpackaged development — not a channel — and is never published. Packaged builds default
to `canary`.

| Channel   | What it is                                | Who uses it                | How it ships                      |
| --------- | ----------------------------------------- | -------------------------- | --------------------------------- |
| `canary`  | Latest packaged build off `main`          | Engineers                  | Auto-publish on push to `main`    |
| `staging` | Release candidate for internal validation | QA / internal stakeholders | Manual `Staging Publish` workflow |
| `prod`    | Stable customer release                   | Customers                  | Manual `Prod Publish` workflow    |

App identities are environment-specific so builds can be installed side by side:

| Environment       | App name                         |
| ----------------- | -------------------------------- |
| Local development | Anaconda Agentic Desktop Dev     |
| `canary`          | Anaconda Agentic Desktop Canary  |
| `staging`         | Anaconda Agentic Desktop Staging |
| `prod`            | Anaconda Agentic Desktop         |

Forge uses only official makers (DMG/ZIP on macOS, Squirrel on Windows, DEB on Linux)
and publishes to `anaconda-agentic-desktop/<channel>/<platform>/<arch>/`. Automatic update
checks run only in packaged macOS and Windows builds that were given `UPDATE_PUBLISH_URL`.

See [docs/releases.md](docs/releases.md) for the full reference: the distribution matrix,
build-time variables, GitHub Environments, workflows, signing credentials, and publish
validation rules.

## Not yet implemented

- Plugin system runtime
- Kilo chat integration
- Authentication
- Telemetry and analytics
- Data migration from legacy Desktop
