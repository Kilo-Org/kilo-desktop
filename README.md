# Kilo Desktop

Kilo Desktop is built with Electron, React, and Electron Forge.

Docs:

- [Add a feature across every layer](docs/add-a-feature.md) — walkthrough of one vertical
  slice, from the shared contract to SQLite and back to the UI
- [Releases, signing, and CI reference](docs/releases.md) — channels, artifacts,
  environments, credentials
- [Notebook integration](plugins/notebook/docs/README.md) — embedding nteract's notebook UI with a
  bundled `runtimed` fallback that preserves the user's running singleton

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
`ANACONDA_PACKAGES_TOKEN` secret.

```bash
corepack enable
pnpm config set "//npm.pkg.github.com/:_authToken" <token-with-read:packages>
pnpm install --frozen-lockfile
pnpm start
```

`pnpm start` / `pnpm dev` run the web Vite server and Electron together. Electron proxies
the renderer through `kilo-desktop-dev://app/#/` using
`KILO_WEB_DEV_SERVER_URL`. Use `pnpm dev:web` for the React app alone (in-memory
`LocalApi`, no Electron).

On first launch after the Kilo rename, Desktop atomically moves a matching pre-rename
profile into the canonical `Kilo Desktop Dev`, `Kilo Desktop Preview`, or `Kilo Desktop`
directory when that target does not already exist. Existing canonical profiles are never
overwritten or merged. Chat reads also recognize the pre-rename ownership key so existing
sessions remain visible; newly created sessions write only `kilo-desktop` metadata.

Browser-mode web tests drive real Chromium, so install the browser once before
`pnpm test`:

```bash
pnpm --filter @kilo-desktop/web exec playwright install chromium
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
pnpm --filter @kilo-desktop/plugin-todos db:generate
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
│   └── workflows/              # CI, build, scheduled Preview, and Stable release
├── pnpm-workspace.yaml         # Workspace globs, dependency catalog, pnpm settings
└── tsconfig.base.json          # Compiler options every package extends
```

`pnpm-workspace.yaml` declares only `apps/*` and `packages/*`, so there are exactly three
packages:

| Package                   | Path                 | Role                                                   |
| ------------------------- | -------------------- | ------------------------------------------------------ |
| `@kilo-desktop/contracts` | `packages/contracts` | Shared schemas and types — the only shared code        |
| `@kilo-desktop/web`       | `apps/web`           | Renderer; builds and runs on its own                   |
| `@kilo-desktop/desktop`   | `apps/desktop`       | Electron shell, SQLite, Forge packaging and publishing |

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
- `nodeLinker: hoisted` exists for Electron and Forge; packaging deploys a frozen
  production dependency tree instead of relying on symlinks (`pnpm deploy` no longer needs
  `injectWorkspacePackages`).
- Internal workspace deps always use the `workspace:*` protocol, so renderer and plugin
  imports resolve the live workspace source through a symlink. `link:` is reserved for the
  `overrides` section of `pnpm-workspace.yaml`. Plugins keep UI as a peer dependency at
  runtime to preserve the shared singleton design.
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
  and from `kilo-desktop://app/#/`.
- Forge’s Vite plugin builds only main and preload (`renderer: []`). Electron owns no
  renderer build; it serves or proxies whatever the web app produced.
- The entire handshake is one artifact and one variable: `apps/web/dist` in production,
  `KILO_WEB_DEV_SERVER_URL` in development.

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
[Spotlight](https://spotlightjs.com). In dev the Electron **main** process adds
`spotlightIntegration`, which forwards events to a local Spotlight sidecar (renderer
events route through the main process, so they show up too).

Run the standalone Spotlight app, then start the desktop app:

```bash
npx @spotlightjs/spotlight   # sidecar + UI on http://localhost:8969
pn dev                        # in another terminal
```

The SDK forwards to the default sidecar at `http://localhost:8969/stream`. Optionally
wire Spotlight into an MCP-capable editor (Claude/Cursor) with
`npx -y @spotlightjs/spotlight mcp`.

Notes:

- Spotlight is gated on `!app.isPackaged`, so none of the dev-only config runs in
  packaged builds, and no `@spotlightjs/*` package ships in the app bundle.
- In dev the SDK is initialized without a DSN and with `defaultIntegrations: false`
  (the native minidump reporter requires a DSN); only `spotlightIntegration` is
  active, so local events go to Spotlight and nowhere else.

## Log verbosity

Main-process logs (electron-log, console + file transports) default to `info`.
Levels are `error`, `warn`, `info`, `verbose`, `debug`, `silly` — anything below
the configured level is dropped. Two ways to change it, env var wins:

```bash
KILO_LOG_LEVEL=debug pnpm dev   # one-off, e.g. to see notebook sidecar debug logs
```

or set `"logLevel": "debug"` in `preferences.json` inside the app's userData
directory (e.g. `~/Library/Application Support/Kilo Desktop Preview/` on macOS) to
persist it across launches.

## Electron architecture and security

The renderer is sandboxed and has no Node.js access. The preload exposes only the
schema-validated `window.desktopApi` surface, and the main process re-validates every
payload against the same contracts before handling it.

Production navigation uses `kilo-desktop://app/#/`; development uses
`kilo-desktop-dev://app/#/`. OS deep links use the same scheme with a dedicated
host: `kilo-desktop://model-catalog/{modelId}` opens the Local Model Catalog on
that Anaconda model UUID (`kilo-desktop-dev://` in development). The custom
protocol serves the independently built web `dist` — staged into
`.vite/renderer/main_window` during packaging — or proxies the web Vite server
in development, with a strict Content Security Policy.

Forge creates an ASAR, includes `.vite`, migrations, package metadata, and required
production dependencies, and unpacks `better-sqlite3`. The fuses plugin disables
RunAsNode, `NODE_OPTIONS`, and CLI inspector arguments while enabling cookie encryption,
ASAR integrity validation, and loading only from ASAR.

## Releases and distribution

`RELEASE_TRACK` accepts only publishable values. Local `pnpm start` / `pnpm dev` is
unpackaged development - not a track - and is never published. Packaged builds default
to `preview`.

| Channel   | What it is                         | Who uses it                | How it ships                              |
| --------- | ---------------------------------- | -------------------------- | ----------------------------------------- |
| `preview` | Continuously consumable prerelease | Engineers / internal users | Scheduled cadence or manual `Release` run |
| `stable`  | Stable customer release            | Customers                  | `vX.Y.Z` tag or manual `Release` run      |

Development is isolated, while Preview and Stable share one packaged identity:

| Environment       | App name     |
| ----------------- | ------------ |
| Local development | Kilo Dev     |
| `preview`         | Kilo Preview |
| `stable`          | Kilo Beta    |

Preview and Stable replace one another rather than install side by side. Sharing identity lets the
About settings update-track switcher (behind the `update-track-switcher` feature flag) move an
installed app between tracks.

Forge uses only official makers (DMG/ZIP on macOS, Squirrel on Windows, DEB on Linux)
and publishes Preview to the `preview` update namespace and Stable to `latest`. Automatic update
checks run only in packaged macOS and Windows builds that were given an update host for the
selected track (`UPDATE_PUBLISH_URL_PREVIEW` / `UPDATE_PUBLISH_URL_STABLE`, falling back to
`UPDATE_PUBLISH_URL` for the build's own track).
Preview builds stamp a UTC timestamp onto the next patch (`0.1.2-preview-260818-14305`)
so every publication is a newer version. Stable uses the tag or dispatch version, then records that
version across the release-coupled desktop, web, and contracts packages and lockfile on `main`.
Forge makers read that stamped version, so macOS DMG/ZIP/`RELEASES.json`, Windows nupkg,
and Linux DEB all publish a unique Preview version.

See [docs/releases.md](docs/releases.md) for the full reference: the distribution matrix,
build-time variables, GitHub Environments, workflows, signing credentials, and publish
validation rules.

## Not yet implemented

- Plugin system runtime
- Kilo chat integration
- Authentication
- Telemetry and analytics
- Data migration from legacy Desktop
