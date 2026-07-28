# Anaconda Agentic Desktop

Next-generation Anaconda Desktop built with Electron, React, and Electron Forge.

## Background

This repository implements the architecture described in
[Anaconda Desktop — Next-Gen Architecture](https://docs.google.com/document/d/1vx3IZwUsHUfjDWnI7Fhh05gLiRLBIV4WM4PxznHWpTY).

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

Use Node 22.12 or newer (`.nvmrc` pins the version CI uses) and the pnpm version declared
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

Schema changes use the desktop package directly:

```bash
pnpm --filter @anaconda-agentic-desktop/desktop db:generate
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

## Distribution matrix

Forge uses only official makers:

| Platform | Maker output                                   | Update behavior                                                       |
| -------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| macOS    | DMG, ZIP, and `RELEASES.json`                  | `update-electron-app` consumes the ZIP manifest                       |
| Windows  | Squirrel Setup EXE, full NUPKG, and `RELEASES` | `update-electron-app` uses the Squirrel feed                          |
| Linux    | DEB and RPM                                    | Updates are provided by the package repository or manual installation |

Automatic Electron update checks run only in packaged Windows and macOS builds. They
are disabled when `UPDATE_PUBLISH_URL` was not supplied at build time and never start on
Linux. Squirrel install, update, and uninstall launches are handled before normal
application startup.

## Release channels

`RELEASE_CHANNEL` accepts only publishable values: `canary`, `staging`, and `prod`.
Local `pnpm start` / `pnpm dev` is unpackaged development — not a channel — and is not
published. Packaged builds default to `canary` when `RELEASE_CHANNEL` is unset.

| Channel   | What it is                                | Who uses it                | How it ships                      |
| --------- | ----------------------------------------- | -------------------------- | --------------------------------- |
| `canary`  | Latest packaged build off `main`          | Engineers                  | Auto-publish on push to `main`    |
| `staging` | Release candidate for internal validation | QA / internal stakeholders | Manual `Staging Publish` workflow |
| `prod`    | Stable customer release                   | Customers                  | Manual `Prod Publish` workflow    |

## Release configuration

Artifacts are published under:

```text
anaconda-agentic-desktop/<channel>/<platform>/<arch>/<artifact>
```

Publishable channels are `canary`, `staging`, and `prod`. The Forge compile-time contract
uses:

| Variable                 | Meaning                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `RELEASE_CHANNEL`        | Channel compiled into the app; defaults to `canary`                                     |
| `UPDATE_PUBLISH_URL`     | Public HTTPS S3/CDN base URL compiled into packaged builds                              |
| `UPDATE_S3_BUCKET`       | Bucket required by `electron-forge publish`                                             |
| `AWS_REGION`             | S3 region (defaults to `us-east-1` in CI when unset)                                    |
| `UPDATE_REMOTE_RELEASES` | Set to `true` on Windows when an existing Squirrel feed is available for delta creation |

CI publish jobs assume GitHub Environments named `canary`, `staging`, and `prod`, each with
repository/environment variables:

| Environment variable | Meaning                                       |
| -------------------- | --------------------------------------------- |
| `UPDATE_PUBLISH_URL` | Public HTTPS update base URL for that channel |
| `UPDATE_S3_BUCKET`   | S3 bucket for Forge publish                   |
| `AWS_ROLE_ARN`       | IAM role assumed via GitHub OIDC              |
| `AWS_REGION`         | Optional; defaults to `us-east-1`             |

`electron-forge publish --dry-run` runs the complete package/make lifecycle and records
publisher metadata without uploading. The shared release module and its tests ensure
the S3 key and runtime feed URL use the same channel/platform/architecture path.

## Signing and CI

Workflows:

| Workflow          | Trigger                      | Behavior                                                                   |
| ----------------- | ---------------------------- | -------------------------------------------------------------------------- |
| `CI`              | Push/PR on `main`            | Lint, format check, `pnpm check`, and package tests (no E2E)               |
| `Build`           | Manual (`workflow_dispatch`) | `pnpm run make` only; uses `canary` env for optional signing; GH artifacts |
| `Canary Publish`  | Push to `main`               | Publishes to the `canary` environment                                      |
| `Staging Publish` | Manual                       | Publishes to the `staging` environment                                     |
| `Prod Publish`    | Manual                       | Publishes to the `prod` environment                                        |

Signing secrets and update vars live on the GitHub Environments above. `Build` attaches
the `canary` environment so the same optional codesign material is available for manual
makes; it does not publish to S3.

CI reuses the same GitHub secret names as Anaconda Desktop (Agent Studio):

| Secret                         | Usage                                                                  |
| ------------------------------ | ---------------------------------------------------------------------- |
| `OSX_BUILD_CERTIFICATE_BASE64` | macOS Developer ID `.p12` (base64); imported into a temporary keychain |
| `OSX_P12_PASSWORD`             | Password for the macOS signing certificate                             |
| `OSX_NOTARIZATION_KEY`         | App Store Connect API `.p8` key material                               |
| `OSX_NOTARIZATION_KEY_ID`      | App Store Connect API key ID                                           |
| `OSX_NOTARIZATION_KEY_ISSUER`  | App Store Connect API issuer ID                                        |
| `AZURE_CLIENT_ID`              | Azure OIDC app for Windows signing                                     |
| `AZURE_TENANT_ID`              | Azure tenant                                                           |
| `AZURE_SUBSCRIPTION_ID`        | Azure subscription                                                     |
| `AZURE_KEY_VAULT_URI`          | Key Vault URI for `AzureSignTool`                                      |
| `AZURE_CERT_NAME`              | Certificate name in Key Vault                                          |

Forge still accepts local/optional fallbacks:

- macOS: `APPLE_SIGNING_IDENTITY` plus either App Store Connect API key env
  (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`) or Apple ID
  (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`)
- Windows: `WINDOWS_CERTIFICATE_FILE` + `WINDOWS_CERTIFICATE_PASSWORD` when Azure
  Key Vault signing is not configured

Staging and prod publishes require signing credentials for macOS and Windows. Canary may
publish unsigned. Unsigned local `make` runs remain supported. The Linux CI job installs
`fakeroot` and RPM tooling and uploads maker artifacts from `apps/desktop/out/make/`.

## Not yet implemented

- Plugin system runtime
- Kilo chat integration
- Authentication
- Telemetry and analytics
- Data migration from legacy Desktop
