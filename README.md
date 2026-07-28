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
| Package manager | pnpm 11, hoisted linker                 | Forge receives a frozen production dependency deployment during packaging                 |
| Testing         | Vitest 5 + Testing Library + Playwright | Unit tests, real-browser React tests, and packaged Electron smoke tests                   |
| Git hooks       | Husky + lint-staged                     | Linting and formatting run before commit                                                  |

## Getting started

Use Node 22.12 or newer and the pnpm version declared in `package.json`.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm start
```

`pnpm start` / `pnpm dev` run the web Vite server and Electron together. Electron proxies
the renderer through `anaconda-agentic-desktop-dev://app/#/` using
`ANACONDA_WEB_DEV_SERVER_URL`. Use `pnpm dev:web` for the React app alone (in-memory
`LocalApi`, no Electron).

The pinned Forge alpha publishes its POSIX CLI file without an executable mode, so the
root postinstall script normalizes that mode after pnpm links the hoisted dependency.

## Commands

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
| `pnpm test`           | Run package tests recursively                                          |
| `pnpm test:web`       | Web unit + browser tests                                               |
| `pnpm test:desktop`   | Desktop unit tests                                                     |
| `pnpm test:contracts` | Contracts registry tests                                               |
| `pnpm test:e2e`       | Package the app and exercise the hardened executable through typed IPC |

## Structure

```text
/
├── apps/
│   ├── desktop/                # Electron main, preload, Forge, SQLite, E2E
│   │   ├── config/
│   │   ├── drizzle/
│   │   ├── e2e/
│   │   ├── resources/
│   │   └── src/{main,preload}/
│   └── web/                    # Standalone React/Vite application
│       └── src/
│           ├── components/
│           ├── features/
│           ├── platform/       # LocalApi + Electron/browser adapters
│           └── routes/
├── packages/
│   └── contracts/              # Shared Zod schemas and typed IPC contracts
├── .github/workflows/build.yml
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

Package names: `@anaconda-agentic-desktop/desktop`, `@anaconda-agentic-desktop/web`,
`@anaconda-agentic-desktop/contracts`.

## Electron architecture and security

The renderer is sandboxed and has no Node.js access. The preload exposes only the
schema-validated `window.desktopApi` surface. React code depends on `LocalApi` and never
imports Electron or IPC channel names (except the Electron adapter).

Production navigation uses `anaconda-agentic-desktop://app/#/`; development uses
`anaconda-agentic-desktop-dev://app/#/`. The custom protocol serves the independently
built web `dist` (or proxies the web Vite server in development) with a strict Content
Security Policy.

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

## Release configuration

Artifacts are published under:

```text
anaconda-agentic-desktop/<channel>/<platform>/<arch>/<artifact>
```

| Variable                                                          | Meaning                                                                                               |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `RELEASE_CHANNEL`                                                 | Release channel compiled into the app; defaults to `canary`                                           |
| `UPDATE_PUBLISH_URL`                                              | Public HTTPS S3/CDN base URL compiled into packaged builds                                            |
| `UPDATE_S3_BUCKET`                                                | Bucket required by `electron-forge publish`                                                           |
| `AWS_REGION`                                                      | S3 region                                                                                             |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | Standard AWS publisher credentials                                                                    |
| `UPDATE_REMOTE_RELEASES`                                          | Set to `true` on Windows when an existing Squirrel feed is available and delta creation should use it |

`electron-forge publish --dry-run` runs the complete package/make lifecycle and records
publisher metadata without uploading. The shared release module and its tests ensure
the S3 key and runtime feed URL use the same channel/platform/architecture path.

## Signing and CI

Unsigned local and manual `make` runs remain supported. Tagged builds publish and run a
credential preflight.

macOS packaging signs when `APPLE_SIGNING_IDENTITY` is set and notarizes when
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` are also present.
Production macOS publishing requires all four.

Windows Squirrel signs when `WINDOWS_CERTIFICATE_FILE` and
`WINDOWS_CERTIFICATE_PASSWORD` are present. CI creates the file from
`WINDOWS_CERTIFICATE_BASE64`; production Windows publishing requires both certificate
settings.

The Linux CI job installs `fakeroot` and RPM tooling. Manual workflow runs call
`pnpm run make`; `v*` tags call `pnpm run publish`. Each platform uploads its official maker
artifacts from `apps/desktop/out/make/`.

## Not yet implemented

- Plugin system runtime
- Kilo chat integration
- Authentication
- Telemetry and analytics
- Data migration from legacy Desktop
